-- ============================================================
-- Luxy AI — PostgreSQL 16 schema
-- Idempotent: safe to re-run via `pnpm db:migrate`.
-- Matches BLUEPRINT.md §8 (Data Architecture).
-- ============================================================

-- Migration bookkeeping (used by scripts/migrate.ts)
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------
-- positions — all trades (open + closed) with PnL tracking
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS positions (
  id              BIGSERIAL PRIMARY KEY,
  agent           TEXT NOT NULL,               -- 'meme' | 'perps' | 'lp' | 'narrative'
  chain           TEXT NOT NULL,               -- 'solana' | 'base' | 'ethereum' | 'hyperliquid'
  token           TEXT,                        -- token mint / market symbol (NULL for LP pools)
  pool_id         TEXT,                        -- Meteora DLMM pool id (lp agent only)
  side            TEXT,                        -- 'long' | 'short' (perps only)
  status          TEXT NOT NULL DEFAULT 'open',-- 'open' | 'closed'
  size_usd        NUMERIC(20, 6) NOT NULL,
  entry_price     NUMERIC(30, 12),
  exit_price      NUMERIC(30, 12),
  pnl_usd         NUMERIC(20, 6),
  pnl_pct         NUMERIC(12, 6),
  tx_signature    TEXT,                        -- Solana tx / HL fill id (NULL in dry-run)
  dry_run         BOOLEAN NOT NULL DEFAULT TRUE,
  intent          JSONB,                       -- originating LuxyIntent (full audit)
  opened_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at       TIMESTAMPTZ
);

-- Hot path: active positions per agent (BLUEPRINT.md §8.2)
CREATE INDEX IF NOT EXISTS idx_positions_active
  ON positions (agent, opened_at DESC) WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_positions_closed_at
  ON positions (closed_at DESC) WHERE status = 'closed';

-- ------------------------------------------------------------
-- signals — all screener/narrative signals with raw_data JSONB
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS signals (
  id             BIGSERIAL PRIMARY KEY,
  source         TEXT NOT NULL,                -- 'screener' | 'narrative' | 'perps' | 'lp'
  agent          TEXT NOT NULL,                -- owning agent: 'meme' | 'perps' | 'lp' | 'narrative'
  chain          TEXT NOT NULL,
  token          TEXT,                         -- token address / market / pool id
  symbol         TEXT,
  score          NUMERIC(6, 4) NOT NULL,       -- rule-based score 0.0-1.0
  llm_verdict    TEXT,                         -- 'strong' | 'moderate' | 'weak' | 'skip'
  llm_reason     TEXT,
  llm_evaluated  BOOLEAN NOT NULL DEFAULT FALSE,
  pushed_to_queue BOOLEAN NOT NULL DEFAULT FALSE,
  raw_data       JSONB NOT NULL,               -- immutable snapshot from the data source
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- LLM evaluation pipeline (BLUEPRINT.md §8.2)
CREATE INDEX IF NOT EXISTS idx_signals_unprocessed
  ON signals (created_at DESC) WHERE llm_evaluated = FALSE;

-- JSONB extraction for frontend (BLUEPRINT.md §8.2)
CREATE INDEX IF NOT EXISTS idx_signals_raw_gin
  ON signals USING GIN (raw_data jsonb_path_ops);

CREATE INDEX IF NOT EXISTS idx_signals_recent
  ON signals (created_at DESC);

-- ------------------------------------------------------------
-- strategy_config — versioned strategy parameters per agent
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS strategy_config (
  id         BIGSERIAL PRIMARY KEY,
  agent      TEXT NOT NULL,                    -- which agent owns this
  version    INT  NOT NULL,
  params     JSONB NOT NULL,                   -- all configurable params as JSONB
  created_by TEXT NOT NULL,                    -- 'luxy' | 'user'
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (agent, version)
);

-- Self-tuning lifecycle (BLUEPRINT.md §5.3): Luxy proposes → user approves.
-- 'pending' rows are proposals awaiting /approve; they never gate execution.
ALTER TABLE strategy_config ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'approved';
ALTER TABLE strategy_config ADD COLUMN IF NOT EXISTS rationale TEXT;

CREATE INDEX IF NOT EXISTS idx_strategy_pending
  ON strategy_config (agent, created_at DESC) WHERE status = 'pending';

-- ------------------------------------------------------------
-- audit_log — immutable action log (no DELETE permission for app user)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  id         BIGSERIAL PRIMARY KEY,
  actor      TEXT NOT NULL,                    -- 'executor' | 'luxy' | 'risk-guard' | 'user' | agent name
  action     TEXT NOT NULL,                    -- 'entry' | 'exit' | 'risk_block' | 'strategy_change' | ...
  payload    JSONB NOT NULL,                   -- full action payload
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_recent
  ON audit_log (created_at DESC);

-- ------------------------------------------------------------
-- wallets — agent wallet addresses (public only; secrets never stored)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wallets (
  id         BIGSERIAL PRIMARY KEY,
  agent      TEXT NOT NULL,                    -- 'meme' | 'lp' | 'perps' | 'reserve'
  chain      TEXT NOT NULL,                    -- 'solana' | 'base' | 'ethereum' | 'hyperliquid'
  address    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (agent, chain)
);

-- ------------------------------------------------------------
-- lp_lessons — HiveMind: structured LP position outcomes
-- (BLUEPRINT.md §6.3)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lp_lessons (
  id                  BIGSERIAL PRIMARY KEY,
  chain               TEXT NOT NULL,           -- 'solana' | 'base' | 'ethereum'
  pool_id             TEXT NOT NULL,
  action              TEXT NOT NULL,           -- 'stay' | 'close' | 'redeploy'
  fee_tvl_ratio       NUMERIC(10, 6),
  yield_realized      NUMERIC(10, 6),          -- % return from fees
  range_shift_reason  TEXT,
  gas_cost_at_action  NUMERIC(20, 8),          -- NULL for Solana, relevant for EVM
  outcome_summary     TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- HiveMind lookups per pool (BLUEPRINT.md §8.2)
CREATE INDEX IF NOT EXISTS idx_lp_lessons_pool
  ON lp_lessons (pool_id, created_at DESC);

-- ------------------------------------------------------------
-- backtest_runs — E2B / local backtest results cache
-- (filled by the Luxy agent; feeds the future fine-tuning dataset)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS backtest_runs (
  id           BIGSERIAL PRIMARY KEY,
  signal_id    BIGINT REFERENCES signals (id),
  engine       TEXT NOT NULL DEFAULT 'local-ts', -- 'e2b' | 'local-ts' | 'replay'
  params       JSONB NOT NULL,
  result       JSONB NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------
-- candles — OHLCV time-series (Phase 4, BLUEPRINT.md §8.1)
-- Plain PostgreSQL table by default; converted to a TimescaleDB
-- hypertable automatically when the extension is available.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS candles (
  chain     TEXT   NOT NULL,                   -- 'solana' | 'base' | 'ethereum' | 'hyperliquid'
  token     TEXT   NOT NULL,                   -- mint / address / market symbol
  timeframe TEXT   NOT NULL DEFAULT '1h',      -- '1m' | '5m' | '1h' | '1d'
  ts        TIMESTAMPTZ NOT NULL,              -- candle open time
  o DOUBLE PRECISION NOT NULL,
  h DOUBLE PRECISION NOT NULL,
  l DOUBLE PRECISION NOT NULL,
  c DOUBLE PRECISION NOT NULL,
  v DOUBLE PRECISION NOT NULL DEFAULT 0,
  UNIQUE (chain, token, timeframe, ts)
);

CREATE INDEX IF NOT EXISTS idx_candles_lookup
  ON candles (chain, token, timeframe, ts DESC);

-- Convert to hypertable when TimescaleDB is installed (no-op otherwise).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
    PERFORM create_hypertable('candles', 'ts', if_not_exists => TRUE, migrate_data => TRUE);
  END IF;
END
$$;

-- ------------------------------------------------------------
-- model_evals — fine-tuning evaluation results (Phase 4, BLUEPRINT.md §8.1)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS model_evals (
  id              BIGSERIAL PRIMARY KEY,
  model           TEXT NOT NULL,               -- model name / checkpoint
  dataset_version TEXT NOT NULL,               -- exported dataset label
  metrics         JSONB NOT NULL,              -- schema adherence, decision quality, hallucination rate
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------
-- engine_models — LuxyEngine model registry (BLUEPRINT.md §3.1 / §8.1)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS engine_models (
  id              BIGSERIAL PRIMARY KEY,
  backend         TEXT NOT NULL,               -- baseline | lightgbm | xgboost | catboost | pytorch
  version         TEXT NOT NULL,
  agent           TEXT NOT NULL DEFAULT 'meme',
  metrics         JSONB NOT NULL DEFAULT '{}',
  artifact_path   TEXT,
  active          BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (backend, version, agent)
);

CREATE INDEX IF NOT EXISTS idx_engine_models_active
  ON engine_models (agent, active, created_at DESC);

-- ------------------------------------------------------------
-- chat_sessions / chat_messages — conversation memory (§8.4.2)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chat_sessions (
  id              BIGSERIAL PRIMARY KEY,
  channel         TEXT NOT NULL,               -- telegram | web | api
  user_ref        TEXT NOT NULL,
  agent_scope     TEXT NOT NULL DEFAULT 'luxy',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_active_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_user
  ON chat_sessions (channel, user_ref, last_active_at DESC);

CREATE TABLE IF NOT EXISTS chat_messages (
  id              BIGSERIAL PRIMARY KEY,
  session_id      BIGINT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role            TEXT NOT NULL,               -- user | assistant | system | tool
  content         TEXT NOT NULL,
  tool_calls      JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_session
  ON chat_messages (session_id, created_at);

-- ------------------------------------------------------------
-- memory_chunks — RAG text store (§8.4.4); embeddings optional later
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS memory_chunks (
  id              BIGSERIAL PRIMARY KEY,
  source_type     TEXT NOT NULL,               -- position | lesson | signal | backtest | note
  source_id       TEXT,
  agent           TEXT,
  chain           TEXT,
  symbol          TEXT,
  content         TEXT NOT NULL,
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_memory_chunks_source
  ON memory_chunks (source_type, source_id);

CREATE INDEX IF NOT EXISTS idx_memory_chunks_agent
  ON memory_chunks (agent, created_at DESC);

-- ------------------------------------------------------------
-- agent_sessions — short-lived working memory audit (§8.4.3)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_sessions (
  id              BIGSERIAL PRIMARY KEY,
  run_id          TEXT NOT NULL UNIQUE,
  agent           TEXT NOT NULL,
  payload         JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_agent_sessions_expires
  ON agent_sessions (expires_at);
