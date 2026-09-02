/**
 * Environment configuration with Zod validation.
 *
 * Every process imports this singleton — a misconfigured environment fails
 * fast at startup instead of mid-trade (BLUEPRINT.md §1.2 principle 5).
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

const booleanish = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1' || v === 'yes');

const num = (def: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : Number(v)))
    .pipe(z.number().finite());

const envSchema = z.object({
  // Runtime mode
  DRY_RUN: booleanish,
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  PAPER_PORTFOLIO_USD: num(2500),

  // LLM Tier 1 — Luxy core
  LUXY_LLM_PROVIDER: z.enum(['anthropic', 'openai', 'openrouter', 'local']).default('anthropic'),
  LUXY_LLM_API_KEY: z.string().default(''),
  LUXY_LLM_MODEL: z.string().default('claude-sonnet-5'),
  LUXY_LLM_BASE_URL: z.string().default('http://localhost:8000/v1'),

  // LLM Tier 2 — sub-agents
  SUBAGENT_LLM_PROVIDER: z.enum(['anthropic', 'openai', 'openrouter', 'local']).default('openrouter'),
  SUBAGENT_LLM_API_KEY: z.string().default(''),
  SUBAGENT_LLM_MODEL: z.string().default('deepseek/deepseek-chat-v3-0324'),

  // E2B
  E2B_API_KEY: z.string().default(''),

  // Data layer
  DATABASE_URL: z
    .string()
    .default('postgresql://luxy:luxy_dev_password@localhost:5432/luxydb'),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // Solana
  SOLANA_RPC_URL: z.string().default('https://api.mainnet-beta.solana.com'),
  HELIUS_API_KEY: z.string().default(''),
  BIRDEYE_API_KEY: z.string().default(''),

  // Jupiter
  JUPITER_API_BASE: z.string().default('https://quote-api.jup.ag/v6'),

  // Hyperliquid
  HYPERLIQUID_API_URL: z.string().default('https://api.hyperliquid.xyz'),
  HYPERLIQUID_WALLET_ADDRESS: z.string().default(''),
  HYPERLIQUID_PRIVATE_KEY: z.string().default(''),

  // EVM (Phase 3 — Base / Ethereum)
  BASE_RPC_URL: z.string().default('https://mainnet.base.org'),
  ETHEREUM_RPC_URL: z.string().default('https://eth.llamarpc.com'),
  EVM_EXECUTOR_PRIVATE_KEY: z.string().default(''),
  UNISWAP_SUBGRAPH_ETH: z
    .string()
    .default('https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v3'),
  LP_EVM_ENABLED: booleanish,
  EVM_GAS_COST_CEIL_USD: num(1.5),

  // Polymarket (Phase 3 — CLOB on Polygon)
  POLYMARKET_GAMMA_API: z.string().default('https://gamma-api.polymarket.com'),
  POLYMARKET_CLOB_API: z.string().default('https://clob.polymarket.com'),
  POLYMARKET_PRIVATE_KEY: z.string().default(''),
  POLYMARKET_FUNDER_ADDRESS: z.string().default(''),
  POLYMARKET_MIN_EDGE: num(0.08),

  // Robinhood Crypto (Phase 3 — US crypto markets)
  ROBINHOOD_API_BASE: z.string().default('https://trading.robinhood.com'),
  ROBINHOOD_API_KEY: z.string().default(''),
  ROBINHOOD_PRIVATE_KEY_B64: z.string().default(''),

  // TimescaleDB candle ingest (Phase 4)
  CANDLES_INTERVAL_MIN: num(5),
  CANDLES_BACKFILL_HOURS: num(48),

  // Telegram
  TELEGRAM_BOT_TOKEN: z.string().default(''),
  TELEGRAM_CHAT_ID: z.string().default(''),
  NARRATIVE_TELEGRAM_BOT_TOKEN: z.string().default(''),
  NARRATIVE_TELEGRAM_CHANNELS: z.string().default(''),

  // Reddit
  REDDIT_CLIENT_ID: z.string().default(''),
  REDDIT_CLIENT_SECRET: z.string().default(''),
  REDDIT_USER_AGENT: z.string().default('luxy-ai-narrative-agent/0.1'),

  // Hardcoded risk limits (executor layer — the LLM can never touch these)
  RISK_MAX_POSITION_PCT: num(0.03),
  RISK_MAX_DAILY_DRAWDOWN_PCT: num(0.08),
  RISK_MAX_SLIPPAGE_PCT: num(0.02),
  RISK_MAX_CONCURRENT_POSITIONS: num(5),

  // Cadence (minutes)
  SCREENER_INTERVAL_MIN: num(5),
  PERPS_INTERVAL_MIN: num(15),
  LP_HUNTER_INTERVAL_MIN: num(30),
  LP_HEALER_INTERVAL_MIN: num(10),
  NARRATIVE_INTERVAL_MIN: num(20),
  POLYMARKET_INTERVAL_MIN: num(30),
  STRATEGY_TUNE_INTERVAL_MIN: num(60),
});

export type AppConfig = z.infer<typeof envSchema>;

function load(): AppConfig {
  // Load .env without a dependency: minimal parser (KEY=VALUE lines).
  // Real environment variables always take precedence over .env values.
  try {
    const envPath = resolve(process.cwd(), '.env');
    if (existsSync(envPath)) {
      const lines = readFileSync(envPath, 'utf8').split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq <= 0) continue;
        const key = trimmed.slice(0, eq).trim();
        let val = trimmed.slice(eq + 1).trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        if (process.env[key] === undefined) process.env[key] = val;
      }
    }
  } catch {
    // .env is optional
  }

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('Invalid environment configuration:');
    for (const issue of parsed.error.issues) {
      console.error(`  ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }
  return parsed.data;
}

export const config: AppConfig = load();

/** True when all trades are simulated. Default and strongly recommended. */
export const isDryRun = (): boolean => config.DRY_RUN;
