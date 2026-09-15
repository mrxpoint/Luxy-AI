/**
 * Conversation memory (BLUEPRINT.md §8.4.2).
 *
 * Multi-turn chat for Telegram / Web. Stores sessions + messages in Postgres.
 * When tables are missing (pre-migrate), operations no-op safely.
 */
import { query } from '../db/pool.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

const log = logger.child({ module: 'memory-conversation' });

export type ChatRole = 'user' | 'assistant' | 'system' | 'tool';
export type ChatChannel = 'telegram' | 'web' | 'api';

export interface ChatMessage {
  id: number;
  session_id: number;
  role: ChatRole;
  content: string;
  created_at: string;
}

export async function getOrCreateSession(
  channel: ChatChannel,
  userRef: string,
  agentScope = 'luxy',
): Promise<number | null> {
  try {
    const existing = await query<{ id: number }>(
      `SELECT id FROM chat_sessions
       WHERE channel = $1 AND user_ref = $2 AND agent_scope = $3
       ORDER BY last_active_at DESC LIMIT 1`,
      [channel, userRef, agentScope],
    );
    if (existing.rows[0]) {
      await query(`UPDATE chat_sessions SET last_active_at = NOW() WHERE id = $1`, [
        existing.rows[0].id,
      ]);
      return existing.rows[0].id;
    }
    const ins = await query<{ id: number }>(
      `INSERT INTO chat_sessions (channel, user_ref, agent_scope)
       VALUES ($1, $2, $3) RETURNING id`,
      [channel, userRef, agentScope],
    );
    return ins.rows[0]?.id ?? null;
  } catch (err) {
    log.debug({ err }, 'getOrCreateSession failed (schema missing?)');
    return null;
  }
}

export async function startNewSession(
  channel: ChatChannel,
  userRef: string,
  agentScope = 'luxy',
): Promise<number | null> {
  try {
    const ins = await query<{ id: number }>(
      `INSERT INTO chat_sessions (channel, user_ref, agent_scope)
       VALUES ($1, $2, $3) RETURNING id`,
      [channel, userRef, agentScope],
    );
    return ins.rows[0]?.id ?? null;
  } catch (err) {
    log.debug({ err }, 'startNewSession failed');
    return null;
  }
}

export async function appendMessage(
  sessionId: number,
  role: ChatRole,
  content: string,
): Promise<void> {
  try {
    await query(
      `INSERT INTO chat_messages (session_id, role, content) VALUES ($1, $2, $3)`,
      [sessionId, role, content],
    );
    await query(`UPDATE chat_sessions SET last_active_at = NOW() WHERE id = $1`, [sessionId]);
  } catch (err) {
    log.debug({ err }, 'appendMessage failed');
  }
}

export async function loadRecentMessages(
  sessionId: number,
  limit = config.MEMORY_CHAT_MAX_MESSAGES,
): Promise<Array<{ role: ChatRole; content: string }>> {
  try {
    const res = await query<{ role: ChatRole; content: string }>(
      `SELECT role, content FROM chat_messages
       WHERE session_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [sessionId, limit],
    );
    return res.rows.reverse();
  } catch (err) {
    log.debug({ err }, 'loadRecentMessages failed');
    return [];
  }
}
