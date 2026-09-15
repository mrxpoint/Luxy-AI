/**
 * Telegram channel monitor (BLUEPRINT.md §6.5).
 *
 * Uses a SEPARATE bot token (NARRATIVE_TELEGRAM_BOT_TOKEN) so getUpdates
 * long-polling here never conflicts with the main grammY bot's polling.
 * Channels the monitor bot is admin of arrive as channel_post updates.
 */
import { config } from '../../config/index.js';
import { getJson } from '../../utils/http.js';
import { logger } from '../../utils/logger.js';

const log = logger.child({ module: 'tg-monitor' });

export interface ChannelPost {
  channel: string;
  text: string;
  messageId: number;
  date: number;
}

export function telegramMonitorConfigured(): boolean {
  return config.NARRATIVE_TELEGRAM_BOT_TOKEN.length > 0;
}

let offset = 0;

/** One long-poll pass over getUpdates; returns channel posts seen. */
export async function pollChannelPosts(): Promise<ChannelPost[]> {
  if (!telegramMonitorConfigured()) return [];
  try {
    const data = await getJson<{
      ok?: boolean;
      result?: Array<{
        update_id: number;
        channel_post?: { message_id: number; text?: string; date: number; chat?: { username?: string; title?: string } };
      }>;
    }>(
      `https://api.telegram.org/bot${config.NARRATIVE_TELEGRAM_BOT_TOKEN}/getUpdates?allowed_updates=%5B%22channel_post%22%5D&timeout=0&offset=${offset}`,
      {},
      20_000,
    );
    const updates = data.result ?? [];
    const posts: ChannelPost[] = [];
    for (const u of updates) {
      offset = Math.max(offset, u.update_id + 1);
      const cp = u.channel_post;
      if (!cp?.text) continue;
      posts.push({
        channel: cp.chat?.username ? `@${cp.chat.username}` : (cp.chat?.title ?? 'unknown'),
        text: cp.text,
        messageId: cp.message_id,
        date: cp.date,
      });
    }
    return posts;
  } catch (err) {
    log.warn({ err }, 'telegram channel poll failed');
    return [];
  }
}
