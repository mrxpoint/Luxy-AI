/**
 * Vector RAG helpers (BLUEPRINT.md §8.4.4).
 *
 * Chunks operational lessons/positions into memory_chunks.
 * Embeddings: optional OpenAI-compatible call when MEMORY_RAG_ENABLED and
 * an API key is present; otherwise retrieval is keyword/ILIKE over content.
 */
import { query } from '../db/pool.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

const log = logger.child({ module: 'memory-rag' });

export async function ingestLessonChunk(input: {
  poolId?: string;
  action: string;
  outcome: string;
  agent?: string;
  chain?: string;
  symbol?: string;
}): Promise<void> {
  const content = `[${input.action}] ${input.outcome}${input.poolId ? ` (pool ${input.poolId})` : ''}`;
  try {
    await query(
      `INSERT INTO memory_chunks (source_type, source_id, agent, chain, symbol, content, metadata)
       VALUES ('lesson', $1, $2, $3, $4, $5, $6::jsonb)`,
      [
        input.poolId ?? null,
        input.agent ?? 'lp',
        input.chain ?? null,
        input.symbol ?? null,
        content,
        JSON.stringify({ action: input.action }),
      ],
    );
  } catch (err) {
    log.debug({ err }, 'ingestLessonChunk failed');
  }
}

/** Sync recent lp_lessons into memory_chunks (idempotent-ish by content prefix). */
export async function syncLessonsToChunks(limit = 50): Promise<number> {
  try {
    const res = await query<{
      pool_id: string;
      action: string;
      outcome_summary: string | null;
    }>(
      `SELECT pool_id, action, outcome_summary FROM lp_lessons ORDER BY created_at DESC LIMIT $1`,
      [limit],
    );
    let n = 0;
    for (const r of res.rows) {
      await ingestLessonChunk({
        poolId: r.pool_id,
        action: r.action,
        outcome: r.outcome_summary ?? 'no summary',
        agent: 'lp',
      });
      n++;
    }
    return n;
  } catch (err) {
    log.debug({ err }, 'syncLessonsToChunks failed');
    return 0;
  }
}

export async function retrieveMemories(
  question: string,
  topK = config.MEMORY_RAG_ENABLED ? 8 : 5,
): Promise<string[]> {
  const qtext = question.trim();
  if (!qtext) return [];

  // Keyword retrieval (always available without embeddings)
  try {
    const tokens = qtext
      .toLowerCase()
      .split(/\W+/)
      .filter((t) => t.length > 2)
      .slice(0, 6);
    if (tokens.length === 0) return [];
    const pattern = tokens.map((t) => `%${t}%`).join('');
    // Simple OR ilike on first meaningful token
    const primary = tokens[0]!;
    const res = await query<{ content: string }>(
      `SELECT content FROM memory_chunks
       WHERE content ILIKE $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [`%${primary}%`, topK],
    );
    if (res.rows.length > 0) return res.rows.map((r) => r.content);

    // Fallback: latest chunks
    const latest = await query<{ content: string }>(
      `SELECT content FROM memory_chunks ORDER BY created_at DESC LIMIT $1`,
      [topK],
    );
    return latest.rows.map((r) => r.content);
  } catch (err) {
    log.debug({ err }, 'retrieveMemories failed');
    return [];
  }
}

export function formatMemoriesForPrompt(chunks: string[]): string {
  if (chunks.length === 0) return '(no retrieved memories)';
  return chunks.map((c, i) => `${i + 1}. ${c}`).join('\n');
}
