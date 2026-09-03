<div align="center">

<h1>⚡ Luxy AI</h1>
<p><strong>Autonomous AI Trading Agent — Fine-Tuned Model · Execution Runtime · E2B In-Session Terminal</strong></p>

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-007ACC?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-22.x-43853D?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Status](https://img.shields.io/badge/Status-Alpha-orange)](BLUEPRINT.md)
[![E2B](https://img.shields.io/badge/E2B-Sandboxed_Terminal-7C3AED?logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0id2hpdGUiIGQ9Ik0yMCAzSDRhMSAxIDAgMDAtMSAxdjE2YTEgMSAwIDAwMSAxaDE2YTEgMSAwIDAwMS0xVjRhMSAxIDAgMDAtMS0xek04IDE3SDZ2LTJoMnYyek04IDEzSDZ2LTJoMnYyek04IDlINlY3aDJ2MnoiLz48L3N2Zz4=)](https://e2b.dev)
[![Hyperliquid](https://img.shields.io/badge/Hyperliquid-Perps-00D4FF)](https://hyperliquid.xyz)
[![Solana](https://img.shields.io/badge/Solana-DeFi-9945FF?logo=solana&logoColor=white)](https://solana.com)
[![PRs Welcome](https://img.shields.io/badge/PRs-Welcome-brightgreen.svg)](CONTRIBUTING.md)

</div>

---

## What is Luxy AI?

Luxy AI is an **open-source autonomous AI trading agent system** that combines three capabilities that no single system has had before in one package:

1. **A domain-specific fine-tuned trading model** — not a general-purpose LLM prompted to trade, but a model trained on market context, order book dynamics, and on-chain signal patterns across Solana and EVM chains.

2. **A production-grade autonomous runtime** — multi-agent architecture with a hardcoded risk management layer, BullMQ-powered signal queues, and 24/7 screener + executor processes, inspired by the Hunter/Healer/HiveMind pattern.

3. **An E2B-powered in-session code execution terminal for every agent** — the most important differentiator. Every Luxy agent session gets a dedicated [E2B](https://e2b.dev) sandboxed environment where it can write Python/TypeScript, run real-time backtests, analyze market data with pandas/numpy, and generate results — all fed back into the agent's reasoning context in the same session.

> Think of it as: **Senpi's trading intelligence + the terminal you have in Claude Code, but for every agent session on every trade.**

---

## Key Differentiators

| Feature | General LLM + Prompt | Senpi.ai | **Luxy AI** |
|---|---|---|---|
| Domain-specific fine-tuned model | No | Yes (Samurai) | **Yes (planned)** |
| Autonomous execution runtime | No | Yes | **Yes** |
| Multi-chain (Solana + EVM + Perps) | No | Partial | **Yes** |
| In-session code execution terminal | No | No | **Yes (E2B)** |
| Real-time backtest within session | No | No | **Yes** |
| HiveMind cross-session learning | No | Yes | **Yes** |
| Open-source | No | Partial | **Yes (Apache 2.0)** |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        LUXY AI SYSTEM                                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                    INTELLIGENCE LAYER                         │   │
│  │                                                               │   │
│  │   ┌─────────────────┐      ┌────────────────────────────┐   │   │
│  │   │  Luxy Core LLM  │      │   E2B Sandbox Terminal     │   │   │
│  │   │  (fine-tuned)   │◄────►│   Per-session isolated     │   │   │
│  │   │                 │      │   Python/TS/JS executor     │   │   │
│  │   └────────┬────────┘      └────────────────────────────┘   │   │
│  │            │ intent JSON                                       │   │
│  └────────────┼──────────────────────────────────────────────────┘  │
│               │                                                       │
│  ┌────────────▼──────────────────────────────────────────────────┐  │
│  │                      AGENT LAYER                               │  │
│  │                                                                │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐ │  │
│  │  │  Meme    │  │  Perps   │  │    LP    │  │  Narrative   │ │  │
│  │  │  Agent   │  │  Agent   │  │  Agent   │  │   Agent      │ │  │
│  │  │ (Solana) │  │ (HL/EVM) │  │(Meteora) │  │(Reddit/TG)   │ │  │
│  │  └────┬─────┘  └────┬─────┘  └────┬─────┘  └──────┬───────┘ │  │
│  └───────┼─────────────┼─────────────┼────────────────┼─────────┘  │
│          │             │             │                │              │
│  ┌───────▼─────────────▼─────────────▼────────────────▼──────────┐ │
│  │                    RUNTIME / EXECUTOR LAYER                    │ │
│  │                                                                 │ │
│  │   Risk Guard (hardcoded) → Jupiter Executor → Position Manager │ │
│  │   BullMQ Signal Queue → Intent Queue → Notification Queue      │ │
│  └─────────────────────────────────┬───────────────────────────── ┘ │
│                                    │                                 │
│  ┌─────────────────────────────────▼───────────────────────────── ┐ │
│  │                       DATA LAYER                                │ │
│  │              PostgreSQL · Redis · TimescaleDB (future)          │ │
│  └─────────────────────────────────────────────────────────────── ┘ │
│                                                                       │
│  ┌─────────────────────────────────────────────────────────────── ┐ │
│  │                     INTERFACE LAYER                             │ │
│  │           Web UI (Next.js) · Telegram Bot · TUI (Ink)          │ │
│  └─────────────────────────────────────────────────────────────── ┘ │
└─────────────────────────────────────────────────────────────────────┘
```

---

## The E2B Terminal: Why It Matters

The single most important innovation in Luxy is the **E2B in-session sandboxed terminal**.

Every time Luxy's AI agent processes a signal or starts a session, it gets access to a dedicated [E2B](https://e2b.dev) sandbox — an isolated Docker container with Python, pandas, numpy, matplotlib, and access to real-time market data.

**What the agent can do inside the sandbox:**

```python
# The agent writes this code — E2B executes it — results come back to agent context

import pandas as pd
import numpy as np

# Fetch OHLCV data inline
df = pd.DataFrame(candle_data)
df['sma_12'] = df['close'].rolling(12).mean()
df['momentum'] = df['close'].pct_change(12)

# Real-time backtest of the proposed entry
entry_price = 142.50
stop_loss   = entry_price * 0.92
take_profit = entry_price * 1.20

df['signal'] = np.where(
    (df['close'] > df['sma_12']) & (df['momentum'] > 0.05),
    'entry', 'hold'
)

backtest_result = {
    'win_rate': 0.67,
    'avg_return': 0.14,
    'max_drawdown': 0.08,
    'sharpe': 1.8
}

print(backtest_result)
# → fed back to agent: "backtest shows 67% win rate, Sharpe 1.8 — proceed with entry"
```

This means the agent doesn't just reason about trades — it **validates them in code before executing**. No other autonomous trading agent does this in the same session loop.

---

## Stack

| Layer | Technology |
|---|---|
| **Core Runtime** | Node.js 22 + TypeScript 5 |
| **Agent LLM (main)** | Anthropic Claude / custom fine-tuned |
| **Sub-agent LLM** | OpenRouter (DeepSeek V3 / free tier) |
| **In-session Terminal** | [E2B](https://e2b.dev) Python/TS sandboxes |
| **Queue System** | BullMQ + Redis 7 |
| **Database** | PostgreSQL 16 |
| **Solana** | @solana/web3.js + @meteora-ag/dlmm |
| **EVM** | viem |
| **Perps** | Hyperliquid REST API |
| **Web UI** | Next.js 15 + shadcn/ui (Bauhaus × Brutalism) |
| **Telegram** | grammY |
| **TUI** | Ink (React for CLI) |
| **Process Manager** | PM2 → Docker Compose (Phase 4) |
| **Secret Management** | sops + age |

---

## Supported Markets

| Market | Status | Notes |
|---|---|---|
| Solana Meme Tokens | Alpha | DexScreener + Birdeye + Helius |
| Solana LP (Meteora DLMM) | Alpha | Hunter/Healer/HiveMind pattern |
| Hyperliquid Perps | Alpha (dry-run) | EIP-712 signing, 10 major markets |
| Base/Ethereum (EVM) | Alpha (dry-run) | Uniswap v3 screener + executor, gas-aware LP |
| Polymarket Prediction | Alpha (dry-run) | Gamma + CLOB, LLM edge detection, GTC/GTD |
| Robinhood Crypto | Alpha (dry-run) | Ed25519-signed US crypto orders |

---

## Quick Start

### Prerequisites

- Node.js 22+
- PostgreSQL 16
- Redis 7
- [E2B API Key](https://e2b.dev) (for sandbox terminal)
- Anthropic or OpenRouter API key

### Setup

```bash
# 1. Clone
git clone https://github.com/mrxpoint/Luxy-AI.git
cd Luxy-AI

# 2. Start Postgres 16 + Redis 7 (local dev infra)
docker compose up -d

# 3. Install dependencies
pnpm install

# 4. Configure environment
cp .env.example .env
# Edit .env with your API keys (everything works in dry-run with keys empty)

# 5. Run DB migrations
pnpm db:migrate

# 6. Bootstrap wallets (one-time, manual)
pnpm bootstrap-wallet --agent=meme --chain=solana
pnpm bootstrap-wallet --agent=lp --chain=solana

# 7. Start all processes (development)
pnpm dev:screener    # Meme agent screener
pnpm dev:executor    # Order executor + risk guard
pnpm dev:agent       # Luxy main agent
pnpm dev:perps       # Hyperliquid perps agent
pnpm dev:lp          # LP agent (Hunter/Healer/HiveMind)
pnpm dev:narrative   # Reddit + Telegram narrative agent
pnpm dev:telegram    # Telegram bot + notifications
pnpm dev:web         # Next.js web UI on http://localhost:3000

# OR: Start all with PM2 (production)
pm2 start ecosystem.config.cjs --env production
pm2 save
pm2 startup
```

> **Dry-run first.** `DRY_RUN=true` (the default) simulates every fill end-to-end —
> screeners, backtests, risk checks, positions and PnL all work without wallets,
> API keys, or real funds. Live execution paths fail loudly until wallet signing
> is provisioned (see BLUEPRINT.md §12).

### Environment Variables

```env
# LLM — Main agent
LUXY_LLM_PROVIDER=anthropic
LUXY_LLM_API_KEY=sk-ant-xxx
LUXY_LLM_MODEL=claude-sonnet-5

# LLM — Sub-agents
SUBAGENT_LLM_PROVIDER=openrouter
SUBAGENT_LLM_API_KEY=sk-or-xxx
SUBAGENT_LLM_MODEL=deepseek/deepseek-chat-v3-0324

# E2B Sandbox Terminal
E2B_API_KEY=e2b_xxx

# Data
DATABASE_URL=postgresql://luxy:password@localhost:5432/luxydb
REDIS_URL=redis://localhost:6379

# Solana
HELIUS_API_KEY=your_helius_key
BIRDEYE_API_KEY=your_birdeye_key

# Perps
HYPERLIQUID_WALLET_ADDRESS=0x...
HYPERLIQUID_PRIVATE_KEY=your_private_key   # encrypted via sops

# Telegram
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
```

---

## Roadmap

- [x] **Phase 1** — Meme Agent (Solana), Screener, Luxy Chat, Web UI, Telegram Bot
- [x] **Phase 2** — Perps Agent (Hyperliquid), LP Agent (Meteora DLMM Hunter/Healer/HiveMind), Narrative Agent
- [ ] **Phase 3** — Multichain EVM (Base/Ethereum), Polymarket, Strategy self-tuning, E2B terminal integration
- [ ] **Phase 4** — Custom fine-tuned model, Docker Compose, TUI, Backtesting engine

See [BLUEPRINT.md](BLUEPRINT.md) for the full detailed technical specification.

---

## Project Structure

```
luxy-ai/
├── src/
│   ├── config/          # Env validation (Zod)
│   ├── db/              # PostgreSQL pool + audit helper
│   ├── redis/           # BullMQ queues
│   ├── llm/             # Provider-agnostic LLM adapter
│   ├── e2b/             # E2B sandbox terminal + kelly/liquidity preflight
│   ├── screener/        # Meme screener — Solana + Base + Ethereum
│   ├── strategy/        # Self-tuning: propose → approve → version (§5.3)
│   ├── market/          # TimescaleDB candle store + OHLCV ingest (§8.1)
│   ├── executor/        # Risk guard + Jupiter/Uniswap/Polymarket/Robinhood
│   ├── tui/             # Ink terminal monitor (§10.3)
│   └── agents/
│       ├── luxy/        # Main agent + strategy tuning pass
│       ├── perps/       # Hyperliquid perps agent
│       ├── lp/          # Meteora Hunter/Healer/HiveMind + evm/ (Uniswap v3)
│       ├── polymarket/  # Prediction-market edge agent
│       └── narrative/   # Reddit + Telegram narrative scraper
├── apps/
│   └── web/             # Next.js 15 web UI (+ /evaluation dashboard)
├── db/
│   └── schema.sql       # PostgreSQL schema (incl. candles hypertable)
├── e2b/
│   └── templates/       # Custom sandbox template + Python analysis templates
├── scripts/
│   ├── migrate.ts
│   ├── bootstrap-wallet.ts
│   ├── replay-signals.ts # Backtest replay engine (P4)
│   └── export-training-data.ts # Fine-tuning SFT export (§11)
├── docker-compose.prod.yml # Phase 4 full service isolation
└── ecosystem.config.cjs # PM2 multi-process config
```

---

## Phase 3/4 Modules

Beyond the core Phase 1–2 runtime, the blueprint's full scope is implemented:

| Module | What it does | Where |
|---|---|---|
| **Strategy self-tuning** | Luxy drafts conservative param proposals from closed-position outcomes; approve/reject via Telegram (`/proposals` `/approve <id>` `/reject <id>`) or the Strategy page. Versions are never overwritten. | `src/strategy/` · `/strategy` |
| **EVM meme trading** | Multi-chain screener (Solana + Base + Ethereum via DexScreener) and a Uniswap v3 executor with REAL QuoterV2 quotes feeding the risk guard. Live signing is fail-loud until provisioned. | `src/screener/` · `src/executor/uniswap.ts` |
| **Uniswap v3 LP** | Hunter/Healer over The Graph subgraph with the gas cost optimizer: a redeploy is skipped when gas > expected fee gain (open question #6). Enable with `LP_EVM_ENABLED=true`. | `src/agents/lp/evm/` |
| **Polymarket agent** | Gamma market discovery → Tier-2 LLM probability estimate → edge vs CLOB midpoint → GTC/GTD intents when edge ≥ 8¢. | `src/agents/polymarket/` |
| **Robinhood Crypto** | Ed25519-signed orders via `trading.robinhood.com` (node:crypto, no extra deps). | `src/executor/robinhood.ts` |
| **E2B preflight** | Momentum backtest + quarter-Kelly sizing + liquidity depth check run before every entry (Python templates in `e2b/templates/`, identical TS twins locally). | `src/e2b/analysis.ts` |
| **TimescaleDB candles** | `candles` hypertable (auto-created when the extension exists) fed by the ingest process; `price:<sym>` hot cache in Redis. | `src/market/` |
| **Backtest replay** | Replays historical signals through the backtest engine into `backtest_runs`; aggregates print to the console and power `/evaluation`. | `pnpm replay` |
| **Evaluation dashboard** | Backtest comparison across strategy versions (win rate / Sharpe / drawdown meters). | `/evaluation` |
| **TUI** | Ink multi-panel terminal: price feed, open positions, static alert stream — over plain SSH. | `pnpm tui` |
| **Docker Compose P4** | Full service isolation: 10 services incl. TimescaleDB, `restart: unless-stopped`, noeviction Redis. | `docker-compose.prod.yml` |
| **Fine-tuning export** | SFT JSONL dataset from closed positions with clear outcomes + risk-block augmentations; registers the dataset version in `model_evals`. | `pnpm ft:export` |

Secret management follows BLUEPRINT §12.1 — see [docs/SECURITY.md](docs/SECURITY.md) for the sops + age workflow.

---

## Risk Disclaimer

This software is provided for educational and research purposes. Autonomous trading carries significant financial risk. Risk management is hardcoded and enforced at the executor layer — the LLM cannot override position limits, drawdown kill switches, or slippage guards. Always start in dry-run mode. Never trade with funds you cannot afford to lose.

---

## Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.

1. Fork the repo
2. Create your feature branch (`git checkout -b feat/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feat/amazing-feature`)
5. Open a Pull Request

---

## License

Apache 2.0 — see [LICENSE](LICENSE) for details.

---

<div align="center">
<sub>Built by mrxpoint · Inspired by Senpi.ai · Powered by E2B, Anthropic, Hyperliquid, Solana</sub>
</div>
