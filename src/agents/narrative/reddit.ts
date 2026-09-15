/**
 * Reddit scraper via OAuth2 (BLUEPRINT.md §6.5).
 * Monitored subreddits: CryptoCurrency, SolanaMemeCoins, solana,
 * CryptoMoonShots, defi — hot.json every 20 minutes.
 */
import { config } from '../../config/index.js';
import { postJson, getJson } from '../../utils/http.js';
import { cacheSet, cacheGet } from '../../redis/connection.js';
import { logger } from '../../utils/logger.js';

const log = logger.child({ module: 'reddit' });

export const MONITORED_SUBS = [
  'CryptoCurrency',
  'SolanaMemeCoins',
  'solana',
  'CryptoMoonShots',
  'defi',
] as const;

export interface RedditPost {
  id: string;
  subreddit: string;
  title: string;
  score: number;
  numComments: number;
  createdUtc: number;
  permalink: string;
}

const TOKEN_KEY = 'reddit:token';

async function getAppToken(): Promise<string | null> {
  if (!config.REDDIT_CLIENT_ID || !config.REDDIT_CLIENT_SECRET) return null;
  const cached = await cacheGet<{ token: string; exp: number }>(TOKEN_KEY);
  if (cached && cached.exp > Date.now()) return cached.token;

  try {
    const basic = Buffer.from(`${config.REDDIT_CLIENT_ID}:${config.REDDIT_CLIENT_SECRET}`).toString('base64');
    const res = await postJson<{ access_token: string; expires_in: number }>(
      'https://www.reddit.com/api/v1/access_token',
      'grant_type=client_credentials',
      {
        authorization: `Basic ${basic}`,
        'content-type': 'application/x-www-form-urlencoded',
        'user-agent': config.REDDIT_USER_AGENT,
      },
    );
    await cacheSet(TOKEN_KEY, { token: res.access_token, exp: Date.now() + (res.expires_in - 60) * 1000 }, 3600);
    return res.access_token;
  } catch (err) {
    log.warn({ err }, 'reddit oauth failed');
    return null;
  }
}

export function redditConfigured(): boolean {
  return config.REDDIT_CLIENT_ID.length > 0 && config.REDDIT_CLIENT_SECRET.length > 0;
}

/** Fetch hot posts from all monitored subs. Empty array when unconfigured. */
export async function fetchHotPosts(perSub = 25): Promise<RedditPost[]> {
  if (!redditConfigured()) return [];
  const token = await getAppToken();
  if (!token) return [];

  const out: RedditPost[] = [];
  for (const sub of MONITORED_SUBS) {
    try {
      const data = await getJson<{
        data?: { children?: Array<{ data: Record<string, unknown> }> };
      }>(`https://oauth.reddit.com/r/${sub}/hot.json?limit=${perSub}`, {
        authorization: `Bearer ${token}`,
        'user-agent': config.REDDIT_USER_AGENT,
      });
      for (const child of data.data?.children ?? []) {
        const d = child.data;
        out.push({
          id: String(d.id ?? ''),
          subreddit: sub,
          title: String(d.title ?? ''),
          score: Number(d.score ?? 0),
          numComments: Number(d.num_comments ?? 0),
          createdUtc: Number(d.created_utc ?? 0),
          permalink: String(d.permalink ?? ''),
        });
      }
    } catch (err) {
      log.warn({ err, sub }, 'failed to fetch subreddit hot posts');
    }
  }
  return out;
}

/** Naive token-mention tally used before the LLM hype pass. */
export function tallyMentions(posts: RedditPost[]): Map<string, { count: number; sources: Set<string> }> {
  const map = new Map<string, { count: number; sources: Set<string> }>();
  const ticker = /\$([A-Z]{2,10})\b|\b(BONK|WIF|SOL|JUP|PYTH|BOME|POPCAT|MEW|TRUMP|FARTCOIN)\b/g;
  for (const p of posts) {
    const matches = p.title.toUpperCase().match(ticker) ?? [];
    for (const m of matches) {
      const sym = m.replace('$', '').toUpperCase();
      const e = map.get(sym) ?? { count: 0, sources: new Set<string>() };
      e.count++;
      e.sources.add(p.subreddit);
      map.set(sym, e);
    }
  }
  return map;
}
