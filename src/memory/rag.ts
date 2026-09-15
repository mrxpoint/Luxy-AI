/**
 * RAG helpers (BLUEPRINT.md §8.4.4).
 *
 * - Always: keyword / ILIKE retrieval over memory_chunks
 * - When MEMORY_RAG_ENABLED + embedding API: store & rank by cosine similarity
 *   using OpenAI-compatible /embeddings (OpenAI, OpenRouter, local)
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
    const ins = await query<{ id: number }>(
      `INSERT INTO memory_chunks (source_type, source_id, agent, chain, symbol, content, metadata)
       VALUES ('lesson', $1, $2, $3, $4, $5, $6::jsonb)
       RETURNING id`,
      [
        input.poolId ?? null,
        input.agent ?? 'lp',
        input.chain ?? null,
        input.symbol ?? null,
        content,
        JSON.stringify({ action: input.action }),
      ],
    );
    const id = ins.rows[0]?.id;
    if (id && config.MEMORY_RAG_ENABLED) {
      await embedAndStore(id, content).catch((err) =>
        log.debug({ err }, 'embed on ingest failed'),
      );
    }
  } catch (err) {
    log.debug({ err }, 'ingestLessonChunk failed');
  }
}

export async function ingestNoteChunk(input: {
  content: string;
  agent?: string;
  symbol?: string;
  sourceType?: string;
  sourceId?: string;
}): Promise<void> {
  try {
    const ins = await query<{ id: number }>(
      `INSERT INTO memory_chunks (source_type, source_id, agent, symbol, content, metadata)
       VALUES ($1, $2, $3, $4, $5, '{}'::jsonb) RETURNING id`,
      [
        input.sourceType ?? 'note',
        input.sourceId ?? null,
        input.agent ?? 'luxy',
        input.symbol ?? null,
        input.content,
      ],
    );
    const id = ins.rows[0]?.id;
    if (id && config.MEMORY_RAG_ENABLED) {
      await embedAndStore(id, input.content).catch(() => undefined);
    }
  } catch (err) {
    log.debug({ err }, 'ingestNoteChunk failed');
  }
}

/** Sync recent lp_lessons into memory_chunks. */
export async function syncLessonsToChunks(limit = 50): Promise<number> {
  try {
    const res = await query<{
      pool_id: string;
      action: string;
      outcome_summary: string | null;
      chain: string | null;
    }>(
      `SELECT pool_id, action, outcome_summary, chain FROM lp_lessons ORDER BY created_at DESC LIMIT $1`,
      [limit],
    );
    let n = 0;
    for (const r of res.rows) {
      await ingestLessonChunk({
        poolId: r.pool_id,
        action: r.action,
        outcome: r.outcome_summary ?? 'no summary',
        agent: 'lp',
        chain: r.chain ?? undefined,
      });
      n++;
    }
    return n;
  } catch (err) {
    log.debug({ err }, 'syncLessonsToChunks failed');
    return 0;
  }
}

export async function retrieveMemories(question: string, topK = 8): Promise<string[]> {
  const qtext = question.trim();
  if (!qtext) return [];

  if (config.MEMORY_RAG_ENABLED) {
    try {
      const embedded = await retrieveByEmbedding(qtext, topK);
      if (embedded.length > 0) return embedded;
    } catch (err) {
      log.debug({ err }, 'embedding retrieve failed — keyword fallback');
    }
  }

  return retrieveByKeyword(qtext, topK);
}

async function retrieveByKeyword(qtext: string, topK: number): Promise<string[]> {
  try {
    const tokens = qtext
      .toLowerCase()
      .split(/\W+/)
      .filter((t) => t.length > 2)
      .slice(0, 6);
    if (tokens.length === 0) return [];
    const primary = tokens[0]!;
    const res = await query<{ content: string }>(
      `SELECT content FROM memory_chunks
       WHERE content ILIKE $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [`%${primary}%`, topK],
    );
    if (res.rows.length > 0) return res.rows.map((r) => r.content);

    const latest = await query<{ content: string }>(
      `SELECT content FROM memory_chunks ORDER BY created_at DESC LIMIT $1`,
      [topK],
    );
    return latest.rows.map((r) => r.content);
  } catch (err) {
    log.debug({ err }, 'retrieveByKeyword failed');
    return [];
  }
}

async function retrieveByEmbedding(qtext: string, topK: number): Promise<string[]> {
  const qVec = await embedText(qtext);
  if (!qVec) return [];

  const res = await query<{ content: string; embedding: unknown }>(
    `SELECT c.content, e.embedding
     FROM memory_embeddings e
     JOIN memory_chunks c ON c.id = e.chunk_id
     ORDER BY e.created_at DESC
     LIMIT 200`,
  );
  if (res.rows.length === 0) return [];

  const scored = res.rows
    .map((r) => ({
      content: r.content,
      score: cosine(qVec, parseVec(r.embedding)),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return scored.filter((s) => s.score > 0.2).map((s) => s.content);
}

function parseVec(v: unknown): number[] {
  if (Array.isArray(v)) return v as number[];
  if (typeof v === 'string') {
    try {
      return JSON.parse(v) as number[];
    } catch {
      return [];
    }
  }
  return [];
}

function cosine(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d === 0 ? 0 : dot / d;
}

async function embedAndStore(chunkId: number, text: string): Promise<void> {
  const vec = await embedText(text);
  if (!vec) return;
  await query(
    `INSERT INTO memory_embeddings (chunk_id, embedding, model)
     VALUES ($1, $2::jsonb, $3)
     ON CONFLICT (chunk_id) DO UPDATE SET embedding = EXCLUDED.embedding, model = EXCLUDED.model`,
    [chunkId, JSON.stringify(vec), config.MEMORY_EMBED_MODEL],
  );
}

async function embedText(text: string): Promise<number[] | null> {
  const key = config.MEMORY_EMBED_API_KEY || config.SUBAGENT_LLM_API_KEY || config.LUXY_LLM_API_KEY;
  if (!key) return null;
  const base = (config.MEMORY_EMBED_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  try {
    const res = await fetch(`${base}/embeddings`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.MEMORY_EMBED_MODEL,
        input: text.slice(0, 8000),
      }),
    });
    if (!res.ok) {
      log.debug({ status: res.status }, 'embed API error');
      return null;
    }
    const data = (await res.json()) as { data?: Array<{ embedding: number[] }> };
    return data.data?.[0]?.embedding ?? null;
  } catch (err) {
    log.debug({ err }, 'embedText failed');
    return null;
  }
}

export function formatMemoriesForPrompt(chunks: string[]): string {
  if (chunks.length === 0) return '(no retrieved memories)';
  return chunks.map((c, i) => `${i + 1}. ${c}`).join('\n');
}
