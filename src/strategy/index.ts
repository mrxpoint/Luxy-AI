/**
 * Strategy self-tuning (BLUEPRINT.md §5.3).
 *
 * Lifecycle: Luxy analyzes recent closed positions per agent → proposes an
 * updated params JSONB → stored as a `pending` row in strategy_config →
 * the user approves/rejects via Telegram (/proposals /approve /reject) or
 * the Web UI. Approval flips the previous active version off and activates
 * the new one; old versions are retained for audit.
 *
 * Proposals NEVER gate execution: agents read the latest `active` +
 * `approved` row only.
 */
import { query } from '../db/pool.js';
import { audit } from '../db/audit.js';
import { notify } from '../redis/queues.js';
import { subagentLLM, tryChat } from '../llm/adapter.js';
import { logger } from '../utils/logger.js';
import type { AgentName, StrategyProposal } from '../types/index.js';

const log = logger.child({ module: 'strategy' });

export interface ActiveStrategy {
  id: number;
  agent: AgentName;
  version: number;
  params: Record<string, unknown>;
}

/** Latest approved+active params for an agent (agents read via this only). */
export async function getActiveStrategy(agent: AgentName): Promise<ActiveStrategy | null> {
  try {
    const res = await query<{
      id: number;
      agent: AgentName;
      version: number;
      params: Record<string, unknown>;
    }>(
      `SELECT id, agent, version, params FROM strategy_config
       WHERE agent = $1 AND active = TRUE AND status = 'approved'
       ORDER BY version DESC LIMIT 1`,
      [agent],
    );
    return res.rows[0] ?? null;
  } catch {
    return null;
  }
}

export interface ProposalDraft {
  agent: AgentName;
  params: Record<string, unknown>;
  rationale: string;
}

/**
 * Analyze recent closed-position outcomes and (when an LLM is available)
 * draft a conservative parameter adjustment. Deterministic fallback covers
 * dry-run without keys: thresholds nudge toward the observed PnL gradient,
 * capped at 20% change per step (same bound as HiveMind evolveThresholds).
 */
export async function draftProposal(agent: AgentName): Promise<ProposalDraft | null> {
  let stats: { trades: number; winRate: number; avgPnlPct: number } | null = null;
  try {
    const res = await query<{ n: number; wins: number; avg_pnl: number }>(
      `SELECT COUNT(*)::int AS n,
              COALESCE(AVG((pnl_pct > 0)::int), 0)::float AS wins,
              COALESCE(AVG(pnl_pct), 0)::float AS avg_pnl
       FROM positions
       WHERE agent = $1 AND status = 'closed' AND closed_at >= NOW() - INTERVAL '7 days'`,
      [agent],
    );
    const row = res.rows[0];
    if (row && row.n >= 5) {
      stats = { trades: row.n, winRate: row.wins, avgPnlPct: row.avg_pnl };
    }
  } catch (err) {
    log.debug({ err }, 'position stats unavailable for strategy draft');
    return null;
  }
  if (!stats) return null;

  const current = await getActiveStrategy(agent);
  const baseParams: Record<string, unknown> = current?.params ?? { note: 'defaults' };

  // Ask the sub-agent LLM for a proposal; fall back to the deterministic nudge.
  try {
    const adapter = subagentLLM();
    const res = await tryChat(
      adapter,
      [
        {
          role: 'user',
          content: `You manage trading strategy parameters for the "${agent}" agent.

CURRENT PARAMS (JSON):
${JSON.stringify(baseParams, null, 2)}

RECENT PERFORMANCE (last 7 days): trades=${stats.trades}, win_rate=${(stats.winRate * 100).toFixed(0)}%, avg_pnl=${(stats.avgPnlPct * 100).toFixed(2)}%

Propose a CONSERVATIVE parameter adjustment. Rules:
- Change at most 2 parameters.
- Every numeric change is capped at ±20% of its current value.
- If performance is healthy (win_rate >= 55% and avg_pnl > 0), prefer no change.

Respond with a single JSON object, no markdown:
{"params": {<full updated param set>}, "rationale": "<2-3 sentences>"}`,
        },
      ],
      'You are the Luxy strategy tuning sub-agent. Output JSON only.',
    );
    if (res) {
      const cleaned = res.text.replace(/```json|```/g, '').trim();
      const start = cleaned.indexOf('{');
      const end = cleaned.lastIndexOf('}');
      if (start >= 0 && end > start) {
        const parsed = JSON.parse(cleaned.slice(start, end + 1)) as {
          params?: Record<string, unknown>;
          rationale?: string;
        };
        if (parsed.params && typeof parsed.params === 'object') {
          return {
            agent,
            params: parsed.params,
            rationale: parsed.rationale ?? 'LLM-proposed adjustment',
          };
        }
      }
    }
  } catch (err) {
    log.debug({ err }, 'LLM strategy draft failed — using deterministic nudge');
  }

  // Deterministic nudge: shift threshold-style keys against the win rate.
  const nudged: Record<string, unknown> = { ...baseParams };
  const factor = stats.winRate < 0.4 ? 0.9 : stats.winRate > 0.65 ? 1.1 : 1;
  for (const [k, v] of Object.entries(nudged)) {
    if (typeof v === 'number' && /threshold|minScore|score_min/i.test(k)) {
      nudged[k] = Math.round(v * factor * 1e6) / 1e6;
    }
  }
  return {
    agent,
    params: nudged,
    rationale: `deterministic nudge: win_rate=${(stats.winRate * 100).toFixed(0)}% over ${stats.trades} trades → threshold factor ${factor}`,
  };
}

/** Persist a proposal as a pending version (does not activate anything). */
export async function submitProposal(draft: ProposalDraft): Promise<number | null> {
  try {
    const next = await query<{ v: number }>(
      `SELECT COALESCE(MAX(version), 0) + 1 AS v FROM strategy_config WHERE agent = $1`,
      [draft.agent],
    );
    const version = next.rows[0]?.v ?? 1;
    const res = await query<{ id: number }>(
      `INSERT INTO strategy_config (agent, version, params, created_by, active, status, rationale)
       VALUES ($1, $2, $3, 'luxy', FALSE, 'pending', $4)
       RETURNING id`,
      [draft.agent, version, JSON.stringify(draft.params), draft.rationale],
    );
    const id = res.rows[0]?.id ?? null;
    if (id !== null) {
      await audit('luxy', 'strategy_proposed', { agent: draft.agent, version, id, rationale: draft.rationale });
      await notify(
        `[STRATEGY] New proposal for ${draft.agent} v${version} — approve via /approve ${id} or the web UI`,
        'strategy',
      );
    }
    return id;
  } catch (err) {
    log.warn({ err }, 'failed to submit strategy proposal');
    return null;
  }
}

export async function listProposals(): Promise<StrategyProposal[]> {
  try {
    const res = await query<{
      id: number;
      agent: AgentName;
      version: number;
      params: Record<string, unknown>;
      rationale: string | null;
      created_by: string;
      created_at: string;
    }>(
      `SELECT id, agent, version, params, rationale, created_by, created_at
       FROM strategy_config WHERE status = 'pending'
       ORDER BY created_at DESC LIMIT 20`,
    );
    return res.rows.map((r) => ({
      id: r.id,
      agent: r.agent,
      version: r.version,
      params: r.params,
      rationale: r.rationale ?? '',
      createdBy: r.created_by === 'user' ? ('user' as const) : ('luxy' as const),
      createdAt: r.created_at,
    }));
  } catch {
    return [];
  }
}

export async function approveProposal(id: number, actor: 'user' | 'luxy' = 'user'): Promise<string> {
  const res = await query<{ agent: AgentName; version: number; status: string }>(
    `SELECT agent, version, status FROM strategy_config WHERE id = $1`,
    [id],
  );
  const row = res.rows[0];
  if (!row) return `proposal #${id} not found`;
  if (row.status !== 'pending') return `proposal #${id} is not pending (status=${row.status})`;

  await query(`UPDATE strategy_config SET active = FALSE WHERE agent = $1 AND active = TRUE`, [row.agent]);
  await query(`UPDATE strategy_config SET active = TRUE, status = 'approved' WHERE id = $1`, [id]);
  await audit(actor, 'strategy_approved', { id, agent: row.agent, version: row.version });
  await notify(`[STRATEGY] Approved ${row.agent} v${row.version} — now active`, 'strategy');
  return `approved ${row.agent} v${row.version}`;
}

export async function rejectProposal(id: number, actor: 'user' | 'luxy' = 'user'): Promise<string> {
  const res = await query<{ agent: AgentName; version: number; status: string }>(
    `SELECT agent, version, status FROM strategy_config WHERE id = $1`,
    [id],
  );
  const row = res.rows[0];
  if (!row) return `proposal #${id} not found`;
  if (row.status !== 'pending') return `proposal #${id} is not pending (status=${row.status})`;

  await query(`UPDATE strategy_config SET status = 'rejected', active = FALSE WHERE id = $1`, [id]);
  await audit(actor, 'strategy_rejected', { id, agent: row.agent, version: row.version });
  return `rejected ${row.agent} v${row.version}`;
}

/** Periodic tuning pass invoked by the Luxy agent process. */
export async function tuneOnce(): Promise<void> {
  const agents: AgentName[] = ['meme', 'perps', 'lp'];
  for (const agent of agents) {
    const pending = await listProposals();
    if (pending.some((p) => p.agent === agent)) continue; // one open proposal per agent
    const draft = await draftProposal(agent);
    if (!draft) continue;
    const id = await submitProposal(draft);
    log.info({ agent, id }, 'strategy proposal submitted');
  }
}
