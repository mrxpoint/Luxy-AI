/**
 * grammY Telegram bot (BLUEPRINT.md §10.2).
 * Commands: /start /status /positions /signals /pause /resume /chat /newchat /engine
 *           /proposals /approve /reject (strategy self-tuning, §5.3)
 * /pause uses an inline keyboard confirmation; /chat uses conversation memory.
 */
import { Bot, InlineKeyboard } from 'grammy';
import { config } from '../config/index.js';
import { query } from '../db/pool.js';
import { audit } from '../db/audit.js';
import { isPaused, setPaused } from '../redis/connection.js';
import { luxyLLM, tryChat } from '../llm/adapter.js';
import { buildChatSystemPrompt } from '../llm/prompts/luxy-system.js';
import { listProposals, approveProposal, rejectProposal } from '../strategy/index.js';
import {
  getOrCreateSession,
  startNewSession,
  appendMessage,
  loadRecentMessages,
} from '../memory/index.js';
import { engineEnabled, engineMode, engineBackend } from '../engine/index.js';
import { retrieveMemories, formatMemoriesForPrompt, syncLessonsToChunks } from '../memory/index.js';
import { enqueueBacktest } from '../redis/queues.js';
import { runBacktestJob } from '../backtest/runner.js';
import { logger } from '../utils/logger.js';

const log = logger.child({ module: 'telegram-bot' });

let bot: Bot | null = null;

export function botConfigured(): boolean {
  return config.TELEGRAM_BOT_TOKEN.length > 0;
}

function authorized(ctx: { chat?: { id?: number } }): boolean {
  if (!config.TELEGRAM_CHAT_ID) return true; // open in dev
  return String(ctx.chat?.id ?? '') === config.TELEGRAM_CHAT_ID;
}

export async function startBot(): Promise<Bot | null> {
  if (!botConfigured()) {
    log.warn('TELEGRAM_BOT_TOKEN not set — bot disabled (notifications still queue fine)');
    return null;
  }
  bot = new Bot(config.TELEGRAM_BOT_TOKEN);

  bot.command('start', (ctx) =>
    ctx.reply(
      [
        '⚡ *Luxy AI* — autonomous trading agent',
        '',
        '/status — portfolio, PnL, pause state',
        '/positions — open positions',
        '/signals — last 5 signals',
        '/pause — halt all new execution',
        '/resume — resume execution',
        '/engine — LuxyEngine backend + mode',
        '/memory <q> — search lesson memory',
        '/backtest <SYMBOL> [days] — research backtest',
        '/candles <SYMBOL> [interval] [days]',
        '/proposals — list pending strategy proposals',
        '/approve <id> — activate a proposal',
        '/reject <id> — discard a proposal',
        '/chat <msg> — talk to Luxy (multi-turn memory)',
        '/newchat — start a fresh chat session',
      ].join('\n'),
      { parse_mode: 'Markdown' },
    ),
  );

  bot.command('status', async (ctx) => {
    if (!authorized(ctx)) return;
    const paused = await isPaused();
    const open = await query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM positions WHERE status='open'`);
    const pnl = await query<{ pnl: number }>(
      `SELECT COALESCE(SUM(pnl_usd),0)::float AS pnl FROM positions
       WHERE status='closed' AND closed_at >= date_trunc('day', NOW())`,
    );
    const todayPnl = pnl.rows[0]?.pnl ?? 0;
    await ctx.reply(
      [
        `Mode: ${config.DRY_RUN ? 'DRY-RUN 🧪' : 'LIVE ⚠️'}`,
        `Executor: ${paused ? 'PAUSED ⏸' : 'running ▶'}`,
        `Open positions: ${open.rows[0]?.n ?? 0}`,
        `Today PnL: ${todayPnl >= 0 ? '+' : ''}$${todayPnl.toFixed(2)}`,
      ].join('\n'),
    );
  });

  bot.command('positions', async (ctx) => {
    if (!authorized(ctx)) return;
    const res = await query<{
      agent: string;
      chain: string;
      token: string | null;
      size_usd: number;
      opened_at: string;
    }>(
      `SELECT agent, chain, token, size_usd, opened_at FROM positions
       WHERE status='open' ORDER BY opened_at DESC LIMIT 10`,
    );
    if (res.rowCount === 0) return void ctx.reply('No open positions.');
    const lines = res.rows.map(
      (r) => `${r.agent}/${r.chain} — ${(r.token ?? '').slice(0, 8)}… — $${Number(r.size_usd).toFixed(2)}`,
    );
    await ctx.reply(lines.join('\n'));
  });

  bot.command('signals', async (ctx) => {
    if (!authorized(ctx)) return;
    const res = await query<{ symbol: string | null; score: number; llm_verdict: string | null; created_at: string }>(
      `SELECT symbol, score, llm_verdict, created_at FROM signals ORDER BY created_at DESC LIMIT 5`,
    );
    if (res.rowCount === 0) return void ctx.reply('No signals yet.');
    const lines = res.rows.map(
      (r) => `[${r.llm_verdict ?? '—'}] ${r.symbol ?? 'token'} score=${Number(r.score).toFixed(2)}`,
    );
    await ctx.reply(lines.join('\n'));
  });

  bot.command('pause', async (ctx) => {
    if (!authorized(ctx)) return;
    const kb = new InlineKeyboard().text('Confirm pause', 'confirm_pause').text('Cancel', 'cancel_pause');
    await ctx.reply('Pause ALL new trade execution?', { reply_markup: kb });
  });

  bot.callbackQuery('confirm_pause', async (ctx) => {
    await setPaused(true);
    await audit('user', 'pause', { via: 'telegram' });
    await ctx.answerCallbackQuery();
    await ctx.editMessageText('⏸ Executor paused — no new entries will execute.');
  });
  bot.callbackQuery('cancel_pause', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText('Paused cancelled.');
  });

  bot.command('resume', async (ctx) => {
    if (!authorized(ctx)) return;
    await setPaused(false);
    await audit('user', 'resume', { via: 'telegram' });
    await ctx.reply('▶ Executor resumed.');
  });

  bot.command('chat', async (ctx) => {
    if (!authorized(ctx)) return;
    const msg = ctx.message?.text?.replace(/^\/chat\s*/, '').trim();
    if (!msg) return void ctx.reply('Usage: /chat <message>');
    const userRef = String(ctx.chat?.id ?? 'unknown');
    const sessionId = await getOrCreateSession('telegram', userRef);
    if (sessionId) await appendMessage(sessionId, 'user', msg);

    const history =
      sessionId != null
        ? await loadRecentMessages(sessionId, config.MEMORY_CHAT_MAX_MESSAGES)
        : [];
    const open = await query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM positions WHERE status='open'`);
    // history already includes the user message we just appended
    const chatMessages =
      history.length > 0
        ? history.map((m) => ({
            role: m.role as 'user' | 'assistant' | 'system',
            content: m.content,
          }))
        : [{ role: 'user' as const, content: msg }];

    const res = await tryChat(
      luxyLLM(),
      chatMessages,
      buildChatSystemPrompt(
        `open_positions=${open.rows[0]?.n ?? 0}; dry_run=${config.DRY_RUN}; engine=${engineEnabled() ? `${engineBackend()}/${engineMode()}` : 'off'}`,
      ),
    );
    const reply = res?.text?.slice(0, 4000) ?? 'Luxy is unavailable right now (LLM not configured or failed).';
    if (sessionId && res?.text) await appendMessage(sessionId, 'assistant', reply);
    await ctx.reply(reply);
  });

  bot.command('newchat', async (ctx) => {
    if (!authorized(ctx)) return;
    const userRef = String(ctx.chat?.id ?? 'unknown');
    const id = await startNewSession('telegram', userRef);
    await ctx.reply(id ? `New chat session #${id} started.` : 'Could not start session (DB?).');
  });

  bot.command('engine', async (ctx) => {
    if (!authorized(ctx)) return;
    await ctx.reply(
      [
        `LuxyEngine: ${engineEnabled() ? 'ON' : 'OFF'}`,
        `backend: ${engineBackend()}`,
        `mode: ${engineMode()}`,
        `model_version: ${config.LUXY_ENGINE_MODEL_VERSION}`,
        '',
        'Set LUXY_ENGINE_ENABLED / BACKEND / MODE in .env and restart agent.',
      ].join('\n'),
    );
  });

  bot.command('memory', async (ctx) => {
    if (!authorized(ctx)) return;
    const q = ctx.message?.text?.replace(/^\/memory\s*/, '').trim();
    if (!q) return void ctx.reply('Usage: /memory <query>');
    await syncLessonsToChunks(30);
    const chunks = await retrieveMemories(q);
    await ctx.reply(formatMemoriesForPrompt(chunks).slice(0, 3500));
  });

  bot.command('backtest', async (ctx) => {
    if (!authorized(ctx)) return;
    const raw = ctx.message?.text?.replace(/^\/backtest\s*/, '').trim() ?? '';
    // /backtest BTC 30  or /backtest hyperliquid BTC 1h 30
    const parts = raw.split(/\s+/).filter(Boolean);
    if (parts.length === 0) {
      return void ctx.reply(
        'Usage:\n/backtest <SYMBOL> [days]\n/backtest hyperliquid <SYMBOL> <interval> <days>\n/backtest replay [days]',
      );
    }
    let venue: 'hyperliquid' | 'replay_signals' = 'hyperliquid';
    let symbol = 'BTC';
    let interval = '1h';
    let days = 30;
    if (parts[0] === 'replay') {
      venue = 'replay_signals';
      days = Number(parts[1]) || 30;
      symbol = 'signals';
    } else if (parts[0] === 'hyperliquid' || parts[0] === 'birdeye') {
      venue = 'hyperliquid';
      symbol = (parts[1] ?? 'BTC').toUpperCase();
      interval = parts[2] ?? '1h';
      days = Number(parts[3]) || 30;
    } else {
      symbol = parts[0]!.toUpperCase();
      days = Number(parts[1]) || 30;
    }
    const userRef = String(ctx.chat?.id ?? 'tg');
    await ctx.reply(`Queuing backtest ${venue} ${symbol} ${interval} ${days}d…`);
    try {
      const jobId = await enqueueBacktest({
        source: 'telegram',
        userRef,
        venue,
        symbolOrMarket: symbol,
        interval,
        days,
        engine: 'local-ts',
      });
      // Also run inline so user gets result without requiring separate worker
      const result = await runBacktestJob(jobId, {
        source: 'telegram',
        userRef,
        venue,
        symbolOrMarket: symbol,
        interval,
        days,
        engine: 'local-ts',
      });
      if (result.status === 'done' && result.metrics) {
        const m = result.metrics;
        await ctx.reply(
          [
            `Backtest ${jobId}`,
            `win_rate ${(m.win_rate * 100).toFixed(1)}%`,
            `sharpe ${m.sharpe.toFixed(2)}`,
            `max_dd ${(m.max_drawdown * 100).toFixed(1)}%`,
            `n_trades ${m.n_trades}`,
            `candles ${result.chartPoints ?? '—'} source=${result.source ?? '—'}`,
          ].join('\n'),
        );
      } else {
        await ctx.reply(`Backtest failed: ${result.error ?? 'unknown'}`);
      }
    } catch (err) {
      await ctx.reply(`Backtest error: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  bot.command('candles', async (ctx) => {
    if (!authorized(ctx)) return;
    const raw = ctx.message?.text?.replace(/^\/candles\s*/, '').trim() ?? '';
    const parts = raw.split(/\s+/).filter(Boolean);
    if (parts.length < 1) {
      return void ctx.reply('Usage: /candles <SYMBOL> [interval] [days]\nExample: /candles BTC 1h 30');
    }
    const { fetchHistorical } = await import('../market/historical.js');
    const symbol = parts[0]!.toUpperCase();
    const interval = parts[1] ?? '1h';
    const days = Number(parts[2]) || 30;
    const hist = await fetchHistorical({
      venue: 'hyperliquid',
      symbolOrMarket: symbol,
      interval,
      days,
    });
    await ctx.reply(
      `candles ${symbol} ${interval}: ${hist.series.length} bars (source=${hist.source})${hist.note ? '\n' + hist.note : ''}`,
    );
  });

  // ---- Strategy self-tuning approvals (BLUEPRINT §5.3) ----
  bot.command('proposals', async (ctx) => {
    if (!authorized(ctx)) return;
    const proposals = await listProposals();
    if (proposals.length === 0) return void ctx.reply('No pending strategy proposals.');
    const lines = proposals.map(
      (p) =>
        `#${p.id} ${p.agent} v${p.version} (by ${p.createdBy})\n  ${p.rationale.slice(0, 160)}`,
    );
    await ctx.reply(lines.join('\n\n'));
  });

  bot.command('approve', async (ctx) => {
    if (!authorized(ctx)) return;
    const id = Number(ctx.message?.text?.replace(/^\/approve\s*/, '').trim());
    if (!Number.isInteger(id)) return void ctx.reply('Usage: /approve <proposal-id>');
    const result = await approveProposal(id, 'user');
    await ctx.reply(`✓ ${result}`);
  });

  bot.command('reject', async (ctx) => {
    if (!authorized(ctx)) return;
    const id = Number(ctx.message?.text?.replace(/^\/reject\s*/, '').trim());
    if (!Number.isInteger(id)) return void ctx.reply('Usage: /reject <proposal-id>');
    const result = await rejectProposal(id, 'user');
    await ctx.reply(`✗ ${result}`);
  });

  bot.catch((err) => log.error({ err }, 'telegram bot error'));

  await bot.start({ onStart: () => log.info('telegram bot polling started') });
  return bot;
}

export async function stopBot(): Promise<void> {
  await bot?.stop();
  bot = null;
}

/** Send a message directly (used by the notifications worker). */
export async function sendTelegram(text: string): Promise<void> {
  if (!botConfigured()) return;
  if (config.TELEGRAM_CHAT_ID) {
    await bot?.api.sendMessage(config.TELEGRAM_CHAT_ID, text);
  }
}
