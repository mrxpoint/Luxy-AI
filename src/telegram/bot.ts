/**
 * grammY Telegram bot (BLUEPRINT.md §10.2).
 * Commands: /start /status /positions /signals /pause /resume /chat
 *           /proposals /approve /reject (strategy self-tuning, §5.3)
 * /pause uses an inline keyboard confirmation; /chat forwards to the Luxy agent.
 */
import { Bot, InlineKeyboard } from 'grammy';
import { config } from '../config/index.js';
import { query } from '../db/pool.js';
import { audit } from '../db/audit.js';
import { isPaused, setPaused } from '../redis/connection.js';
import { luxyLLM, tryChat } from '../llm/adapter.js';
import { buildChatSystemPrompt } from '../llm/prompts/luxy-system.js';
import { listProposals, approveProposal, rejectProposal } from '../strategy/index.js';
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
        '/proposals — list pending strategy proposals',
        '/approve <id> — activate a proposal',
        '/reject <id> — discard a proposal',
        '/chat <msg> — talk to Luxy',
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
    const open = await query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM positions WHERE status='open'`);
    const res = await tryChat(
      luxyLLM(),
      [{ role: 'user', content: msg }],
      buildChatSystemPrompt(`open_positions=${open.rows[0]?.n ?? 0}; dry_run=${config.DRY_RUN}`),
    );
    await ctx.reply(res?.text?.slice(0, 4000) ?? 'Luxy is unavailable right now (LLM not configured or failed).');
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
