# LUXY AI — System Blueprint v1.0

> Complete technical specification for building an autonomous AI trading agent system with fine-tuned domain model, autonomous runtime, and E2B-powered in-session code execution terminal.

---

## Table of Contents

1. [Vision & Philosophy](#1-vision--philosophy)
2. [System Architecture](#2-system-architecture)
3. [AI Model Architecture](#3-ai-model-architecture)
4. [E2B In-Session Terminal](#4-e2b-in-session-terminal)
5. [Runtime Architecture](#5-runtime-architecture)
6. [Agent Breakdown](#6-agent-breakdown)
7. [Risk Management Layer](#7-risk-management-layer)
8. [Data Architecture](#8-data-architecture)
9. [Market Connectivity](#9-market-connectivity)
10. [Interface Layer](#10-interface-layer)
11. [Fine-Tuning Pipeline](#11-fine-tuning-pipeline)
12. [Security & Key Management](#12-security--key-management)
13. [Deployment Architecture](#13-deployment-architecture)
14. [Phase Roadmap](#14-phase-roadmap)
15. [Cost Structure](#15-cost-structure)
16. [Open Questions & Decisions](#16-open-questions--decisions)

---

## 1. Vision & Philosophy

### 1.1 The Problem with Current AI Trading Systems

Most "AI trading" today falls into one of three failure modes:

**Mode A — The Prompt Cowboy:** A general-purpose LLM (GPT-4, Claude) instructed via a long system prompt to "act as a trader." No fine-tuning, no domain knowledge baked in. Every session starts from zero. Hallucinations are common. Can't execute. Doesn't learn.

**Mode B — The Rule Bot with an LLM Hat:** A traditional rule-based trading bot with an LLM bolted on for commentary. The LLM doesn't actually make decisions — it's a dashboard label. The "AI" is cosmetic.

**Mode C — The Black Box Signal Service:** A fine-tuned model that produces signals but gives no insight into reasoning, can't be extended, and has no real-time validation capability.

### 1.2 The Luxy Approach

Luxy is built on five design principles:

**1. The model must be domain-specific.** A general LLM prompted to trade is like hiring a poet to do accounting. Luxy uses a model fine-tuned on trading context: order book dynamics, on-chain signal patterns, DeFi liquidity mechanics, historical market regimes.

**2. The terminal must be in every session.** The critical missing piece in all existing AI agent trading systems is the ability to *validate a trade decision in code before executing it*. Luxy gives every agent session a dedicated E2B sandboxed environment where the agent can write and run analysis code, backtest strategies, and compute signals — all within the same session loop, before the intent is submitted to the executor.

**3. LLM = decisions. Bot = execution.** The LLM component reasons over data and outputs structured intents (JSON). It never touches order books or wallets directly. Execution is handled by a separate, deterministic bot layer that enforces hardcoded risk rules the LLM cannot override.

**4. The system learns across sessions.** The HiveMind component captures structured lessons from every closed position — what worked, what didn't, under what conditions. Future agent calls are primed with this lesson history, creating a compounding intelligence loop.

**5. Risk is not a prompt instruction.** Max position size, max drawdown kill switch, slippage limits — these are hardcoded in the executor, outside LLM control. An adversarial prompt, a hallucinated reasoning chain, or a bad market condition cannot cause the LLM to blow up the account.

### 1.3 Comparison: Luxy vs Senpi.ai

[Senpi.ai](https://senpi.ai) is the closest reference implementation. Key differences:

| Dimension | Senpi.ai | Luxy AI |
|---|---|---|
| Fine-tuned model | Senpi Samurai (Hyperliquid-specific) | Planned: multi-market (Solana + EVM + Perps) |
| Strategy packaging | 80+ strategy templates | Strategy self-tuning via Luxy agent |
| In-session code execution | None | **E2B sandbox in every session** |
| Cross-session learning | HiveMind (cloud) | HiveMind (self-hosted, PostgreSQL) |
| Supported markets | Hyperliquid primary | Solana, Hyperliquid, Base, Ethereum, Polymarket |
| Open-source | Partial | Full (Apache 2.0) |
| Deployment | Cloud-first | Self-hosted VPS first |

---

## 2. System Architecture

### 2.1 Layer Diagram

```
╔══════════════════════════════════════════════════════════════════════╗
║                         LUXY AI SYSTEM                               ║
╠══════════════════════════════════════════════════════════════════════╣
║                                                                       ║
║  ┌─────────────────────── INTELLIGENCE LAYER ─────────────────────┐ ║
║  │                                                                  │ ║
║  │  ┌──────────────────────┐      ┌───────────────────────────┐   │ ║
║  │  │   Luxy Core LLM      │      │   E2B Sandbox Terminal    │   │ ║
║  │  │   (fine-tuned or     │◄────►│   Per-session isolated    │   │ ║
║  │  │    Anthropic direct) │      │   Python/TS/JS executor   │   │ ║
║  │  │                      │      │   Real-time backtest      │   │ ║
║  │  │   Thesis · Decision  │      │   Data analysis           │   │ ║
║  │  │   Strategy Update    │      │   Chart generation        │   │ ║
║  │  └──────────┬───────────┘      └───────────────────────────┘   │ ║
║  │             │ LuxyIntent (structured JSON)                        │ ║
║  └─────────────┼────────────────────────────────────────────────────┘ ║
║                │                                                       ║
║  ┌─────────────▼────────────── AGENT LAYER ───────────────────────┐  ║
║  │                                                                  │  ║
║  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │  ║
║  │  │  Meme    │  │  Perps   │  │    LP    │  │  Narrative   │  │  ║
║  │  │  Agent   │  │  Agent   │  │  Agent   │  │   Agent      │  │  ║
║  │  │          │  │          │  │  Hunter  │  │              │  │  ║
║  │  │ Solana   │  │ Hyperlq  │  │  Healer  │  │  Reddit      │  │  ║
║  │  │ DexScr   │  │ screener │  │ HiveMind │  │  Telegram    │  │  ║
║  │  │ Birdeye  │  │ 15-min   │  │ 30+10min │  │  20-min scan │  │  ║
║  │  │ Helius   │  │ loop     │  │ loops    │  │  LLM hype    │  │  ║
║  │  └────┬─────┘  └────┬─────┘  └────┬─────┘  └──────┬───────┘  │  ║
║  └───────┼─────────────┼─────────────┼────────────────┼──────────┘  ║
║          │ ScoredCandidate / NarrativeSignal          │              ║
║  ┌───────▼─────────────▼─────────────▼────────────────▼──────────┐  ║
║  │                     RUNTIME LAYER                               │  ║
║  │                                                                  │  ║
║  │  Signal Queue (BullMQ)  →  Luxy Agent  →  Intent Queue          │  ║
║  │                                                                  │  ║
║  │  ┌─────────────────────────────────────────────────────────┐   │  ║
║  │  │                    EXECUTOR                              │   │  ║
║  │  │  Risk Guard (hardcoded) → Jupiter Swap → TX Signer      │   │  ║
║  │  │  Hyperliquid Orders → LP Deploy/Rebalance → Portfolio   │   │  ║
║  │  └─────────────────────────────────────────────────────────┘   │  ║
║  └──────────────────────────────────────────────────────────────── ┘  ║
║                                                                       ║
║  ┌──────────────────────────── DATA LAYER ─────────────────────── ┐  ║
║  │  PostgreSQL 16          Redis 7              TimescaleDB (Phase4)│  ║
║  │  positions · signals    BullMQ queues        OHLCV time-series  │  ║
║  │  lp_lessons · wallets   Pub/Sub signals      Candlestick cache  │  ║
║  │  strategy_config        Pause flags           Market data        │  ║
║  └─────────────────────────────────────────────────────────────── ┘  ║
║                                                                       ║
║  ┌──────────────────────── INTERFACE LAYER ────────────────────── ┐  ║
║  │  Web UI (Next.js 15)    Telegram Bot (grammY)    TUI (Ink)     │  ║
║  │  Dashboard · Chat       /status /positions       SSH monitor    │  ║
║  │  Signals · Positions    /signals /pause           Live prices   │  ║
║  └─────────────────────────────────────────────────────────────── ┘  ║
╚══════════════════════════════════════════════════════════════════════╝
```

### 2.2 Data Flow

```
Market Data Sources
        │
        ▼
┌───────────────┐     rule-based      ┌──────────────┐
│   Screener    │────scoring > 0.45──►│  LLM Filter  │
│  (24/7 bot)   │                     │  (OpenRouter) │
└───────────────┘                     └──────┬───────┘
                                             │ ScoredCandidate
                                             ▼
                                     ┌──────────────┐
                                     │ Signal Queue  │
                                     │   (Redis/BQ)  │
                                     └──────┬───────┘
                                            │
                                            ▼
                              ┌─────────────────────────┐
                              │      Luxy Agent          │
                              │   (fine-tuned LLM)       │
                              │                          │
                              │  1. Get signal context   │
                              │  2. Spin up E2B sandbox  │
                              │  3. Run analysis code    │
                              │  4. Get backtest results │
                              │  5. Decide: entry/exit/  │
                              │     hold/alert           │
                              │  6. Output LuxyIntent    │
                              └──────────┬──────────────┘
                                         │ LuxyIntent JSON
                                         ▼
                              ┌──────────────────────────┐
                              │       Risk Guard          │
                              │  (hardcoded, LLM-proof)  │
                              │  checkPositionSize()      │
                              │  checkDailyDrawdown()     │
                              │  checkSlippage()          │
                              └──────────┬───────────────┘
                                         │ allowed = true
                                         ▼
                              ┌──────────────────────────┐
                              │        Executor           │
                              │  Jupiter Swap / HL Order  │
                              │  Record Position in DB    │
                              │  Notify via Telegram      │
                              └──────────────────────────┘
```

---

## 3. AI Model Architecture

### 3.1 Two-Tier LLM Strategy

Luxy uses two distinct LLM tiers with different cost/capability tradeoffs:

```
┌─────────────────────────────────────────────────────────┐
│  TIER 1 — Luxy Core (High-Stakes Decisions)             │
│                                                          │
│  Provider: Anthropic direct API (claude-sonnet-5)       │
│  OR: Custom fine-tuned model (Phase 4)                  │
│  Use cases: Entry/exit decisions, strategy updates      │
│  Trigger: On signal (event-driven), never polling       │
│  Cost: ~$2-10 per million tokens (paid per use)         │
│  Why direct API: Zero rate limit risk on live capital   │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  TIER 2 — Sub-agent LLM (High-Volume, Low-Stakes)       │
│                                                          │
│  Provider: OpenRouter (deepseek/deepseek-chat-v3-0324)  │
│  Use cases: Token screening, narrative analysis,        │
│             LP categorization, hype detection           │
│  Volume: Hundreds of calls per day                      │
│  Cost: $0.24/M input, $0.90/M output                   │
│  Fallback: OpenRouter :free models (50 req/day)         │
└─────────────────────────────────────────────────────────┘
```

### 3.2 Fine-Tuning Architecture (Phase 4)

The goal is a model that *natively understands* trading context — not a general LLM that has to be re-explained what a bin is, what fee/TVL ratio means, or what a rug looks like.

**Target model base:** Qwen-2.5-7B or Llama-3.2-8B (open weights, commercially usable)

**Training data composition:**

```
Dataset Category              Volume    Source
──────────────────────────────────────────────────────────
1. Market signal examples     30%       Synthetic + filtered
   - Good entry signals                 from historical Luxy sessions
   - Bad entry signals (labels)
   - Hold decisions with reasoning

2. DeFi domain knowledge      25%       On-chain docs, protocol
   - Meteora DLMM mechanics             specs, Hyperliquid docs,
   - Bin dynamics, fee calc             Uniswap v3 math
   - LP strategies

3. Historical position data   20%       Luxy session logs
   - Entry → outcome pairs             (accumulated over time)
   - HiveMind lesson corpus
   - Position + PnL + reasoning

4. Risk/rug pattern corpus    15%       On-chain analysis
   - Token metadata patterns            curated dataset
   - Dev wallet behavior
   - Wash trading signals

5. General trading context    10%       Public finance texts
   - Market regimes                     filtered for relevance
   - Technical analysis
```

**Training methodology:**

```
Base Model
    │
    ▼ Step 1: Domain pre-training
    │  Continued pre-training on DeFi/crypto corpus
    │  (structured market data, protocol docs)
    │
    ▼ Step 2: Instruction fine-tuning (SFT)
    │  Input: signal context + market state
    │  Output: structured LuxyIntent JSON
    │  Dataset: ~50k examples (synthetic + curated)
    │
    ▼ Step 3: RLHF / DPO alignment
    │  Preference pairs: good decisions vs bad decisions
    │  Human evaluation of reasoning quality
    │
    ▼ Luxy Trading Model (7-8B params)
```

**Output format (enforced via structured output):**

```json
{
  "action": "entry",
  "agent": "meme",
  "chain": "solana",
  "token": "TokenMintAddress...",
  "sizeUsd": 75,
  "reasoning": "Volume/liquidity ratio 4.2x indicates organic momentum. SMA confirms uptrend. E2B backtest over last 30 similar setups: 64% win rate, 1.6 Sharpe. Risk: thin liquidity at $85k, set stop at -12%.",
  "confidence": 0.72,
  "createdAt": "2025-08-19T14:22:00Z"
}
```

### 3.3 Provider-Agnostic Adapter

All LLM calls go through a single adapter interface — switching from Anthropic to a self-hosted fine-tuned model requires changing one config line:

```typescript
// src/llm/adapter.ts
interface LLMAdapter {
  chat(messages: LLMMessage[], systemPrompt?: string): Promise<LLMResponse>;
}

// src/llm/config.ts
export const luxyLLM = buildAdapter(
  config.LUXY_LLM_PROVIDER,   // "anthropic" | "openai" | "openrouter" | "local"
  config.LUXY_LLM_API_KEY,
  config.LUXY_LLM_MODEL
);

// Future: local fine-tuned model via vLLM / Ollama
// LUXY_LLM_PROVIDER=local
// LUXY_LLM_BASE_URL=http://localhost:8000/v1
// LUXY_LLM_MODEL=luxy-trading-7b
```

---

## 4. E2B In-Session Terminal

This is the most novel component in Luxy. No other AI trading agent provides this.

### 4.1 What is E2B?

[E2B](https://e2b.dev) provides **sandboxed code execution environments** — isolated Docker containers that can run Python, TypeScript, JavaScript, and other runtimes. Each sandbox:

- Starts in ~150ms
- Has a full Linux environment with pre-installed packages
- Is isolated from the host and other sandboxes
- Can be kept alive for the duration of a session
- Communicates results back via SDK

E2B is the same category of technology that powers AI coding agents that can run code — Claude's computer use, Devin, etc.

### 4.2 The Integration Architecture

```
Luxy Agent Session
        │
        ├── 1. Signal received (new token, perps signal, etc.)
        │
        ├── 2. E2B sandbox created for this session
        │   ┌─────────────────────────────────────────┐
        │   │  E2B Sandbox (isolated Docker container)  │
        │   │                                          │
        │   │  Python 3.12 + pandas + numpy +          │
        │   │  matplotlib + requests + ta-lib          │
        │   │                                          │
        │   │  Market data fetched inside sandbox:     │
        │   │  - OHLCV via DexScreener/Helius          │
        │   │  - Orderbook snapshots                   │
        │   │  - On-chain metrics                      │
        │   └─────────────────────────────────────────┘
        │
        ├── 3. Agent writes analysis code → sandbox executes it
        │
        ├── 4. Results returned to agent context:
        │       {
        │         backtest_win_rate: 0.64,
        │         sharpe_ratio: 1.8,
        │         max_drawdown: 0.09,
        │         recommended_size: 75,
        │         key_risk: "thin liquidity at $85k"
        │       }
        │
        ├── 5. Agent incorporates results into final LuxyIntent
        │
        ├── 6. Sandbox closed (or kept alive for follow-up)
        │
        └── 7. Intent submitted to executor
```

### 4.3 Implementation

```typescript
// src/e2b/sandbox.ts
import { Sandbox } from "@e2b/code-interpreter";

export interface SandboxResult {
  stdout: string;
  stderr: string;
  results: unknown[];
  error?: string;
}

export class LuxySandbox {
  private sandbox: Sandbox | null = null;

  async init(): Promise<void> {
    this.sandbox = await Sandbox.create({
      template: "luxy-trading",   // custom E2B template with ta-lib, pandas, etc.
      apiKey: process.env.E2B_API_KEY,
      timeoutMs: 30_000,
    });
  }

  async run(code: string): Promise<SandboxResult> {
    if (!this.sandbox) throw new Error("Sandbox not initialized");

    const result = await this.sandbox.runCode(code, { language: "python" });

    return {
      stdout: result.logs.stdout.join("\n"),
      stderr: result.logs.stderr.join("\n"),
      results: result.results.map(r => r.data),
      error: result.error?.value,
    };
  }

  async close(): Promise<void> {
    await this.sandbox?.kill();
    this.sandbox = null;
  }
}
```

### 4.4 Analysis Templates

Pre-built analysis modules the agent can invoke:

```python
# Template: momentum_backtest.py
# Agent sends this code to E2B, gets results back

import pandas as pd
import numpy as np

def run_backtest(candles: list[dict], params: dict) -> dict:
    df = pd.DataFrame(candles)
    df['close'] = df['close'].astype(float)
    df['sma'] = df['close'].rolling(params.get('sma_period', 12)).mean()
    df['momentum'] = df['close'].pct_change(params.get('momentum_period', 6))

    # Entry signal: close > SMA and momentum > threshold
    df['entry'] = (df['close'] > df['sma']) & (df['momentum'] > params.get('momentum_threshold', 0.03))

    # Simulate trades
    returns = []
    for i, row in df[df['entry']].iterrows():
        if i + params.get('hold_periods', 4) < len(df):
            entry_price = row['close']
            exit_price = df.iloc[i + params.get('hold_periods', 4)]['close']
            returns.append((exit_price - entry_price) / entry_price)

    if not returns:
        return {'win_rate': 0, 'avg_return': 0, 'sharpe': 0, 'n_trades': 0}

    returns = np.array(returns)
    return {
        'win_rate': float(np.mean(returns > 0)),
        'avg_return': float(np.mean(returns)),
        'sharpe': float(np.mean(returns) / (np.std(returns) + 1e-8) * np.sqrt(252)),
        'max_drawdown': float(np.min(returns)),
        'n_trades': len(returns),
    }
```

### 4.5 E2B Custom Template

A custom E2B template (`luxy-trading`) is pre-built with all required packages:

```dockerfile
# e2b/Dockerfile (used to build custom template)
FROM e2b/code-interpreter:latest

RUN pip install --no-cache-dir \
    pandas==2.2.0 \
    numpy==1.26.4 \
    matplotlib==3.8.0 \
    scikit-learn==1.4.0 \
    ta==0.11.0 \
    requests==2.31.0 \
    scipy==1.12.0

# Pre-download common market data utilities
COPY templates/ /home/user/templates/
```

Published to E2B with:
```bash
e2b template build --name luxy-trading
```

### 4.6 Agent Prompt for Terminal Use

The Luxy system prompt includes instructions on how to use the E2B terminal:

```
When evaluating a trading signal, you MUST use the code execution terminal
to validate your reasoning before submitting an intent.

Available tool: execute_code(python_code: str) → str

Steps:
1. Fetch the signal's historical OHLCV data
2. Run a momentum/backtest analysis
3. Compute position sizing based on Kelly criterion or fixed fractional
4. Check liquidity depth at the intended entry price
5. Include backtest metrics in your intent's reasoning field
6. Only submit an "entry" intent if backtest win_rate >= 0.55 AND n_trades >= 10

If execute_code fails, you MUST default to "hold" and report the failure.
```

---

## 5. Runtime Architecture

### 5.1 Process Architecture (PM2)

```
PM2 Process Manager
├── screener        → Meme Agent screener loop (5-min cycles)
├── executor        → BullMQ worker: risk check + order execution
├── luxy-agent      → Main LLM agent + E2B terminal
├── perps-agent     → Hyperliquid screener + position monitor
├── lp-agent        → Meteora DLMM Hunter/Healer/HiveMind
├── narrative-agent → Reddit + Telegram + LLM hype detection
└── telegram-bot    → grammY bot + notification worker
```

**Signal flow between processes:**

```
screener ──────────► Redis signalQueue ──────► luxy-agent
                                                    │
narrative-agent ──►  Redis signalQueue ──────►     │ (processes signal)
                                                    │
perps-agent ──────►  Redis intentQueue ◄────────────┘
                            │
                     executor (worker) ──► positions DB
                            │
                     notificationQueue ──► telegram-bot
```

### 5.2 Queue Architecture (BullMQ + Redis)

```
Queue: signals          (screener → luxy-agent)
  Job payload: ScoredCandidate
  Retry: 3 attempts, exponential backoff 5s
  Cleanup: keep 500 completed, 100 failed

Queue: intents          (luxy-agent → executor)
  Job payload: LuxyIntent
  Retry: 1 attempt (idempotent on executor)
  Cleanup: keep 200 completed

Queue: notifications    (all agents → telegram-bot)
  Job payload: { text: string, type: string }
  Retry: 2 attempts
  Rate limit: 1 message/second (Telegram limit)
```

### 5.3 Strategy Config Versioning

All strategy parameters are versioned in PostgreSQL, not hardcoded:

```sql
CREATE TABLE strategy_config (
  id         BIGSERIAL PRIMARY KEY,
  agent      TEXT NOT NULL,           -- which agent owns this
  version    INT NOT NULL,
  params     JSONB NOT NULL,          -- all configurable params as JSONB
  created_by TEXT NOT NULL,           -- 'luxy' | 'user'
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Luxy agent can propose strategy updates; user approves via Telegram or Web UI. Approved changes increment version, old versions retained for audit.

---

## 6. Agent Breakdown

### 6.1 Luxy Main Agent

**Role:** Orchestrator, decision maker, user interface

**Trigger:** Event-driven — responds to signals from queue or user chat messages.

**Capabilities with E2B:**
- Write and execute Python analysis code
- Run real-time backtests against current market data
- Compute position sizing
- Validate entries before submission

**System prompt philosophy:**
```
You are Luxy — an AI trading agent. You:
- Reason carefully before every decision
- Always validate signals in code via the terminal before acting
- Output structured JSON intents for the executor
- Never execute trades directly — you produce intents
- Learn from HiveMind lessons stored in your context
- Ask for clarification when uncertain rather than guessing
```

### 6.2 Meme Agent Screener

**Architecture:** Pure bot layer (non-LLM), 24/7 operation

**Data sources:**
- DexScreener API — trending pairs, volume, liquidity
- Birdeye API — holder data, token metadata
- Helius RPC — recent swap count, on-chain velocity

**Scoring criteria (rule-based, 0.0–1.0):**

| Condition | Score Delta |
|---|---|
| Volume/Liquidity > 3x | +0.25 |
| Volume/Liquidity > 1x | +0.15 |
| Liquidity > $100k | +0.20 |
| Liquidity > $50k | +0.10 |
| 24h txns > 1000 | +0.15 |
| 24h txns > 500 | +0.08 |
| Market cap < $10M | +0.10 |
| Price momentum positive | +0.10 |
| Liquidity < $20k | -0.30 |
| Volume 24h < $5k | -0.20 |

**Pipeline:** Fetch → Score (rule-based) → LLM filter (OpenRouter, `strong`/`moderate`/`weak`/`skip`) → Signal queue

### 6.3 LP Agent (Hunter/Healer/HiveMind)

Adapted from the Meridian architecture pattern.

**Hunter (screener, bot layer):**
- Scans Meteora DLMM pools via `dlmm.datapi.meteora.ag`
- Scores pools: fee yield, organic score, TVL, volume/TVL ratio
- No LLM calls — pure rule-based filtering
- Output: pool candidates to HiveMind-informed Healer

**Healer (manager, LLM-assisted):**
- Monitors open LP positions every 10 minutes
- Decision rules (applied in order):

| Condition | Action |
|---|---|
| PnL < -15% | CLOSE (stop loss) |
| Fee yield healthy AND in-range | STAY |
| Out of range > 30 min | REDEPLOY |
| PnL > +20% | CLOSE (take profit) |
| Default | STAY |

- REDEPLOY decisions are confirmed by LLM (checks HiveMind lessons)
- Large position redeployments escalate to Luxy for approval

**HiveMind (persistent learning):**

```sql
CREATE TABLE lp_lessons (
  id                  BIGSERIAL PRIMARY KEY,
  chain               TEXT NOT NULL,          -- 'solana' | 'base' | 'ethereum'
  pool_id             TEXT NOT NULL,
  action              TEXT NOT NULL,          -- 'stay' | 'close' | 'redeploy'
  fee_tvl_ratio       NUMERIC(10, 6),
  yield_realized      NUMERIC(10, 6),         -- % return from fees
  range_shift_reason  TEXT,
  gas_cost_at_action  NUMERIC(20, 8),         -- NULL for Solana, relevant for EVM
  outcome_summary     TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Lesson format injected into LLM context:
```
[HIVEMIND] Pool ABC123 (SOL/USDC): REDEPLOY — yield=0.8%, feeTvl=0.06 — 
Price shifted 15 bins, redeployed to center. Next 2h: +0.3% fees earned.
✓ Good decision at these conditions.
```

**Threshold evolution:** Every 5 closed positions, the system analyzes winner/loser distribution and nudges scoring thresholds toward optimal values (capped at 20% change per step).

### 6.4 Perps Agent (Hyperliquid)

**Market scope:** BTC, ETH, SOL, ARB, AVAX, DOGE, WIF, PEPE, BNB, MATIC

**Signal computation (per-market, every 15 min):**
1. Fetch 1h candles for last 24h
2. Compute:
   - 24h momentum: `(close[-1] - close[0]) / close[0]`
   - 12h SMA: average of last 12 candle closes
   - 4-candle volatility: avg of `(high - low) / open`
3. Classify:
   - `long`: momentum > +5%, price above SMA → score 0.7+
   - `short`: momentum < -5%, price below SMA → score 0.6+
   - `neutral`: everything else → score 0.3

**Position risk:**
- Max $200 per trade (Phase 2 conservative limit)
- Exit when unrealized PnL < -8% OR > +15%
- TP/SL managed at executor layer, not LLM

**Execution:** Via Hyperliquid REST API — `POST /exchange` with EIP-712 signed action

### 6.5 Narrative/Alert Agent

**Data sources:**

| Source | Method | Frequency |
|---|---|---|
| Reddit | OAuth2 → `/r/{sub}/hot.json` | Every 20 min |
| Telegram Channels | Bot API long-poll `getUpdates` | Continuous |
| Twitter/X (Phase 3) | Nitter / official API | TBD |

**Monitored subreddits:**
`CryptoCurrency`, `SolanaMemeCoins`, `solana`, `CryptoMoonShots`, `defi`

**LLM analysis output:**
```json
{
  "signals": [
    {
      "token": "WIF",
      "hypeLevel": "high",
      "sentiment": "bullish",
      "summary": "Multiple posts about WIF breaking $3 resistance. Community confident on ETF narrative. 47 unique mentions in last hour.",
      "confidence": 0.82,
      "sourceCount": 12
    }
  ]
}
```

High-hype signals are pushed to `signalQueue` for Luxy agent evaluation.

---

## 7. Risk Management Layer

This layer operates **outside LLM control**. No reasoning chain, hallucination, or adversarial prompt can bypass it.

### 7.1 Position-Level Guards

```typescript
interface RiskCheckResult {
  allowed: boolean;
  reason: string;
}

// Applied in order: drawdown check → size check → slippage check
function runAllChecks(
  intent: LuxyIntent,
  portfolio: PortfolioState,
  estimatedSlippage: number
): RiskCheckResult
```

| Guard | Default Value | Notes |
|---|---|---|
| Max position size | 3% of portfolio | Per single trade |
| Max daily drawdown | 8% | Kill switch — halts all new entries |
| Max slippage | 2% | Rejects order if Jupiter quote exceeds this |
| Max concurrent positions | 5 | Total open positions across all agents |

### 7.2 Wallet Isolation

One wallet per `(chain × agent)` combination. A bug or exploit in one agent cannot drain funds from another agent's wallet.

```
Solana wallets:
  meme-agent-solana     → trading wallet for meme tokens
  lp-agent-solana       → LP deposits (Meteora DLMM)
  reserve-solana        → cold reserve (manual funding only)

EVM wallets (Phase 3):
  meme-agent-base       → Base meme trading
  lp-agent-base         → Uniswap v3 LP on Base

Perps:
  perps-agent-hl        → Hyperliquid trading wallet
```

### 7.3 Pause Flag

A Redis key `luxy:paused` can be set via Telegram `/pause` command. The executor checks this before processing any intent. Setting this key brings all new trade execution to an immediate halt without stopping the screener or agent processes.

### 7.4 Audit Log

Every action — entry, exit, risk block, strategy change — is recorded in `audit_log` table with timestamp, actor, and full payload. Non-deletable (no DELETE permission for the app DB user).

---

## 8. Data Architecture

### 8.1 PostgreSQL Schema

```sql
-- Core tables
positions       -- All trades (open + closed) with PnL tracking
signals         -- All screener/narrative signals with raw_data JSONB
strategy_config -- Versioned strategy parameters per agent
audit_log       -- Immutable action log
wallets         -- Agent wallet addresses (public only)
lp_lessons      -- HiveMind: structured LP position outcomes

-- Future (Phase 3+)
candles         -- TimescaleDB hypertable for market data
backtest_runs   -- E2B backtest results cache
model_evals     -- Fine-tuning evaluation results
```

### 8.2 Key Index Strategy

```sql
-- positions: hot path — active positions per agent
CREATE INDEX idx_positions_active ON positions (agent, opened_at DESC)
  WHERE status = 'open';

-- signals: LLM evaluation pipeline
CREATE INDEX idx_signals_unprocessed ON signals (created_at DESC)
  WHERE llm_evaluated = FALSE;

-- signals: JSONB extraction for frontend
CREATE INDEX idx_signals_raw_gin ON signals USING GIN (raw_data jsonb_path_ops);

-- lp_lessons: HiveMind lookups per pool
CREATE INDEX idx_lp_lessons_pool ON lp_lessons (pool_id, created_at DESC);
```

### 8.3 Redis Usage

| Key/Queue | Type | Purpose |
|---|---|---|
| `signals` (BullMQ) | List | Screener → Luxy signal queue |
| `intents` (BullMQ) | List | Luxy → Executor intent queue |
| `notifications` (BullMQ) | List | All → Telegram notification queue |
| `luxy:paused` | String | Global pause flag for executor |
| `price:sol` | String | Cached SOL price (30s TTL) |

**Persistence:** RDB + AOF hybrid. `maxmemory-policy: noeviction` (never silently drop queue jobs).

---

## 9. Market Connectivity

### 9.1 Solana

| Service | Purpose | API | Free Tier |
|---|---|---|---|
| Helius | RPC + webhooks | `mainnet.helius-rpc.com` | 1M credits/month |
| Birdeye | Token data + OHLCV | `public-api.birdeye.so` | 30K CU/month |
| Jupiter v6 | Swap routing + quotes | `quote-api.jup.ag/v6` | Free, no auth |
| DexScreener | Pair data + trending | `api.dexscreener.com` | Free, 300 req/min |
| Meteora Data API | DLMM pool data | `dlmm.datapi.meteora.ag` | Free, 30 RPS |

### 9.2 Hyperliquid (Perps)

| Endpoint | Purpose |
|---|---|
| `POST /info { type: "allMids" }` | All mid prices |
| `POST /info { type: "candleSnapshot" }` | OHLCV candles |
| `POST /info { type: "clearinghouseState" }` | User positions |
| `POST /exchange { action: ... }` | Order placement (EIP-712 signed) |

Rate limits: 1,200 weight/minute (IP), each info call = 20 weight.
Trading fees: 0.045% taker / 0.015% maker (base tier).

### 9.3 EVM Chains (Phase 3)

| Chain | LP Protocol | Pool Data | RPC |
|---|---|---|---|
| Base | Uniswap v3 | The Graph subgraph | Alchemy/Infura |
| Ethereum | Uniswap v3/v4 | The Graph subgraph | Alchemy/Infura |

Uniswap v3 ETH subgraph ID: `5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV`

### 9.4 Polymarket (Phase 3)

| Service | Chain | Auth |
|---|---|---|
| CLOB API | Polygon (Chain ID: 137) | EIP-712 L1 + HMAC L2 |
| TypeScript SDK | `@polymarket/ts-sdk` | API key |

---

## 10. Interface Layer

### 10.1 Web UI (Next.js 15)

**Design language:** Bauhaus × Brutalism
- No soft shadows — hard `box-shadow: 4px 4px 0px #000`
- Borders: 2px solid black on all interactive elements
- Typography: Space Grotesk (headings) + JetBrains Mono (numbers/data)
- Color system: Black, white, red (#E53E3E), yellow (#F6E05E) accents
- Zero border-radius on all cards and buttons
- Hover state: invert colors

**Pages:**

| Page | Type | Data Source |
|---|---|---|
| `/` Dashboard | Server component | DB: positions, signals aggregated |
| `/chat` Luxy Chat | Client component | API: `/api/chat` → Luxy agent |
| `/signals` Screener | Server component | DB: signals table paginated |
| `/positions` | Server component | DB: positions history |
| `/strategy` | Server component | DB: strategy_config versions |

### 10.2 Telegram Bot (grammY)

**Commands:**

| Command | Function |
|---|---|
| `/start` | Welcome + command list |
| `/status` | Open positions, today PnL, strategy, pause state |
| `/positions` | List open positions with entry/size |
| `/signals` | Last 5 signals with scores |
| `/pause` | Pause executor (inline keyboard confirm) |
| `/resume` | Resume executor |
| `/chat <msg>` | Forward to Luxy agent, reply with response |

**Notification schema:**

```
[SIGNAL]  WIF score=0.82 — strong organic volume, 1.2k txns/24h
[ENTRY]   Entered WIF (solana) — $75, entry $2.34, tx: 5K2j...
[EXIT]    Closed WIF — PnL: +$12.40 (+16.6%)
[ALERT]   Risk guard blocked: daily drawdown limit reached (-8.1%)
[LP]      Redeployed SOL/USDC to bin 3420-3480 — range shift detected
[HYPE]    WIF trending on Reddit (high hype, bullish) — 12 posts
```

### 10.3 TUI (Ink)

Built with Ink (React for CLI) — monitored over SSH without browser.

**Layout:**
```
┌──────────────────┐  ┌─────────────────────────────────────┐
│   PRICE FEED     │  │         ACTIVE POSITIONS             │
│                  │  │                                       │
│  BTC  $65,420    │  │  WIF  $2.34 → $2.51  +7.2%  $75    │
│  ETH  $3,480     │  │  SOL  LP  [3420-3460]  fee=0.6%    │
│  SOL  $142       │  │                                       │
│  WIF  $2.51      │  │                                       │
└──────────────────┘  └─────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────┐
│   RECENT ALERTS (static — not overwritten on re-render)      │
│                                                               │
│  14:22  [SIGNAL] BONK score=0.71 — strong meme momentum      │
│  14:15  [ENTRY] WIF — $75 @ $2.34                           │
│  14:08  [HYPE] SOL trending on Reddit                        │
└──────────────────────────────────────────────────────────────┘
```

---

## 11. Fine-Tuning Pipeline

### 11.1 Dataset Generation

**Synthetic data generation (Phase 4 prerequisite):**

1. Run Luxy in paper-trading mode for 60+ days across multiple market conditions
2. Every agent session + E2B execution + final intent is logged with outcome
3. Filter: only sessions with clear outcome (position opened, PnL > +5% or < -5%)
4. Label: good decision (PnL positive within 24h) vs bad decision (PnL negative)
5. Augment with edge cases: rug pulls detected by risk guard, high-slippage blocks

**Dataset format (JSONL):**

```jsonl
{
  "messages": [
    {"role": "system", "content": "You are Luxy, an AI trading agent..."},
    {"role": "user", "content": "SIGNAL: WIF on Solana. Price $2.34, liquidity $180k, volume 24h $450k..."},
    {"role": "assistant", "content": "{\"action\":\"entry\",\"agent\":\"meme\",\"chain\":\"solana\",\"token\":\"EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm\",\"sizeUsd\":75,\"reasoning\":\"V/L ratio 2.5x, organic score 78, backtest 62% win rate over 25 similar setups...\",\"confidence\":0.71,\"createdAt\":\"2025-06-15T14:22:00Z\"}"}
  ],
  "outcome": "good",
  "actual_pnl_pct": 14.2,
  "outcome_24h_pct": 14.2
}
```

### 11.2 Training Infrastructure

```
┌──────────────────────────────────────────────────────┐
│              FINE-TUNING PIPELINE                     │
│                                                       │
│  Raw session logs → Filter/label → JSONL dataset     │
│                                                       │
│  Training: Axolotl (LoRA fine-tuning framework)      │
│  Base model: Qwen-2.5-7B-Instruct                   │
│  Method: QLoRA (4-bit quantization)                  │
│  Hardware: 2x A100 80GB or 4x RTX 3090 (self-host)  │
│                                                       │
│  Evaluation:                                         │
│  - Intent schema adherence (100% required)           │
│  - Decision quality vs holdout set                   │
│  - Hallucination rate on token addresses             │
│                                                       │
│  Serving:                                            │
│  - vLLM (OpenAI-compatible server)                  │
│  - Self-hosted on VPS GPU instance                  │
│  - Config: LUXY_LLM_PROVIDER=local                  │
│            LUXY_LLM_BASE_URL=http://gpu-vps:8000/v1 │
└──────────────────────────────────────────────────────┘
```

---

## 12. Security & Key Management

### 12.1 Secret Encryption

**Tool:** `sops` + `age`

```bash
# 1. Generate age key
age-keygen -o ~/.config/sops/age/keys.txt

# 2. Configure .sops.yaml
creation_rules:
  - path_regex: .*\.enc\.env$
    age: age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p

# 3. Encrypt secrets
sops --encrypt .env > .env.enc
git add .env.enc   # safe to commit encrypted

# 4. Runtime decryption (never writes to disk)
export SOPS_AGE_KEY_FILE=~/.config/sops/age/keys.txt
sops exec-env .env.enc 'pm2 start ecosystem.config.cjs'
```

### 12.2 Wallet Provisioning

```bash
# One-time, per (chain × agent), manual execution
pnpm bootstrap-wallet --agent=meme --chain=solana

# Output: public address saved to DB
# Secret key: printed to terminal ONCE, encrypt manually via sops
# Script REFUSES to run if wallet already exists (prevents double-generation)
```

Private key storage recommendation:

| Stage | Method |
|---|---|
| Development | `.env` (never commit, gitignored) |
| Staging | `sops` + `age` encryption |
| Production | `sops` + `age` + encrypted disk + VPS firewall |
| Future | Hardware security module (HSM) or Vault |

### 12.3 Database Security

- App DB user has `SELECT`, `INSERT`, `UPDATE` on all tables
- No `DELETE` permission on `audit_log` (append-only enforcement)
- No `DROP TABLE`, `TRUNCATE` permissions
- DB password rotated monthly via sops-encrypted `.env.enc`

---

## 13. Deployment Architecture

### 13.1 Phase 1–3: PM2 on VPS

```
VPS (2-4 GB RAM, Ubuntu 22.04)
├── PM2 process manager
│   ├── screener          (512MB max)
│   ├── executor          (256MB max)
│   ├── luxy-agent        (512MB max)
│   ├── perps-agent       (256MB max)
│   ├── lp-agent          (512MB max)
│   ├── narrative-agent   (256MB max)
│   └── telegram-bot      (128MB max)
├── PostgreSQL 16         (self-hosted)
├── Redis 7               (self-hosted)
└── Next.js web UI        (pm2 cluster mode)
```

**VPS providers (cost-optimized):** Contabo (~$5-8/mo), Hetzner (~$5-10/mo), DigitalOcean (~$12/mo)

**Auto-restart on reboot:**
```bash
pm2 start ecosystem.config.cjs --env production
pm2 startup   # generates systemd unit
pm2 save      # persist process list
```

### 13.2 Phase 4: Docker Compose

```yaml
services:
  screener:        { build: Dockerfile.screener, restart: unless-stopped }
  executor:        { build: Dockerfile.executor, restart: unless-stopped }
  luxy-agent:      { build: Dockerfile.agent, restart: unless-stopped }
  perps-agent:     { build: Dockerfile.perps, restart: unless-stopped }
  lp-agent:        { build: Dockerfile.lp, restart: unless-stopped }
  narrative-agent: { build: Dockerfile.narrative, restart: unless-stopped }
  telegram-bot:    { build: Dockerfile.telegram, restart: unless-stopped }
  web:             { build: apps/web, ports: ["3000:3000"] }
  db:              { image: postgres:16-alpine, volumes: [pg-data:/var/lib/postgresql/data] }
  cache:           { image: redis:7-alpine, command: "redis-server --maxmemory 512mb --appendonly yes" }
```

---

## 14. Phase Roadmap

### Phase 1 — Foundation (Solana + Robinhood) ✅

**Deliverables:**
- [x] Project scaffold: TypeScript/ESM, PM2, sops+age
- [x] DB schema: PostgreSQL with all tables + indexes
- [x] LLM adapter: provider-agnostic (Anthropic/OpenAI/OpenRouter)
- [x] Meme Agent Screener: DexScreener + Birdeye + Helius + LLM filter
- [x] Executor: BullMQ worker + Jupiter v6 swap + Risk Guard
- [x] Luxy Main Agent: Anthropic direct, signal processing loop
- [x] Telegram Bot: grammY, /status /positions /signals /pause /chat
- [x] Web UI: Next.js 15, Dashboard + Chat + Signals (Bauhaus × Brutalism)
- [x] Wallet bootstrap script: one-time, prevents duplicate generation

**Active risk limits:** 3% per trade, 8% daily drawdown kill switch, 2% slippage cap, 5 max concurrent positions

### Phase 2 — Perluasan ✅

**Deliverables:**
- [x] Perps Agent: Hyperliquid REST client, 10-market screener, position monitor
- [x] LP Agent: Meteora DLMM Hunter/Healer/HiveMind (fully adapted from Meridian pattern)
- [x] Narrative Agent: Reddit OAuth2 scraper + Telegram channel monitor + LLM hype detection
- [x] PM2 config updated with new processes

### Phase 3 — Multichain + Prediction Market

**Target deliverables:**
- [ ] Meme Agent EVM: Base + Ethereum support (DexScreener + Uniswap v3)
- [ ] LP Agent EVM: Uniswap v3/v4 Hunter/Healer with gas cost optimizer
- [ ] Prediction Market Agent: Polymarket CLOB API (GTC/GTD orders)
- [ ] **E2B Terminal Integration:** sandboxed Python executor per agent session
- [ ] Strategy self-tuning: Luxy proposes → user approves → new version in strategy_config
- [ ] Robinhood Crypto API: Ed25519-signed orders for US crypto markets
- [ ] Web UI additions: Positions history + Strategy Config versioning page

**E2B integration specifics:**
- Custom E2B template with pandas, numpy, ta, scikit-learn
- `src/e2b/sandbox.ts` — LuxySandbox class with `init()`, `run()`, `close()`
- Agent system prompt updated to mandate code validation before entry
- Analysis templates: momentum backtest, Kelly sizing, liquidity depth check
- Backtest results stored in new `backtest_runs` table for future fine-tuning dataset

### Phase 4 — Production Scale + Fine-Tuned Model

**Target deliverables:**
- [ ] Docker Compose: full service isolation per process
- [ ] TUI: Ink multi-panel terminal (prices + positions + alerts)
- [ ] Backtesting engine: replay historical signals from `signals` table
- [ ] **Custom fine-tuned model:** Qwen-2.5-7B-Instruct via QLoRA on Axolotl
  - Training data: 60+ days of Luxy session logs + labeled outcomes
  - Self-hosted via vLLM (OpenAI-compatible endpoint)
  - Drop-in via `LUXY_LLM_PROVIDER=local`
- [ ] TimescaleDB: OHLCV hypertable for efficient time-series queries
- [ ] Strategy evaluation dashboard: backtest comparison across versions
- [ ] Multi-VPS: separate DB VPS when system grows beyond single node

---

## 15. Cost Structure

### 15.1 Monthly Costs (Phase 1–2 reference)

| Component | Cost | Notes |
|---|---|---|
| VPS (Contabo/Hetzner) | $5–15/mo | 2–4GB RAM |
| LLM — sub-agents | $0 | OpenRouter free tier (50 req/day) → $0.24/M tokens paid |
| LLM — Luxy decisions | ~$5-20/mo | Anthropic claude-sonnet-5 at $2/M input, $10/M output, ~10-50 decision calls/day |
| Helius (Solana RPC) | $0 | 1M credits/month free |
| Birdeye | $0–99/mo | 30K CU free; $99/mo Starter for production |
| Jupiter API | $0 | Fully free |
| DexScreener | $0 | Free, 300 req/min |
| Meteora Data API | $0 | Free, 30 RPS |
| Hyperliquid | $0 | No API fees; trading fees 0.045% taker |
| E2B (Phase 3) | ~$10–30/mo | Per-sandbox-second pricing; ~100ms per evaluation |
| PostgreSQL + Redis | $0 | Self-hosted on same VPS |

**Minimum viable monthly cost: ~$10–35/month**

### 15.2 Phase 4 Additional Costs

| Component | Cost |
|---|---|
| GPU VPS for fine-tuning (one-time) | ~$100–300 for training run |
| GPU VPS for model serving (vLLM) | ~$50–150/mo (RTX 3090 tier) |
| TimescaleDB | $0 (open-source, self-hosted) |

---

## 16. Open Questions & Decisions

| # | Question | Status | Recommendation |
|---|---|---|---|
| 1 | **Risk thresholds final values** | Open | Start conservative (3%/8%), tune after 30 days live data |
| 2 | **LLM model per tier** | Partially decided | Anthropic claude-sonnet-5 for Luxy; A/B test sub-agent model after 2 weeks |
| 3 | **E2B template packages** | Open | Start with pandas+numpy+ta; add scikit-learn when backtest quality needs it |
| 4 | **Fine-tune base model** | Open | Qwen-2.5-7B vs Llama-3.2-8B; test both on synthetic eval set before committing |
| 5 | **Notification granularity** | Open | Bot notify for info, Luxy + inline keyboard for approval-required actions |
| 6 | **EVM gas optimization** | Open | Implement gas oracle check before any EVM LP rebalance; skip if cost > expected fee gain |
| 7 | **Polymarket geo-restriction** | Open | Some regions are blocked; use VPS IP in unrestricted jurisdiction |
| 8 | **Fine-tuning dataset size** | Open | Target 50k+ examples; start generating from first day of live operation |

---

## Appendix: Key Reference Links

### LLM & Infrastructure
- OpenRouter API: https://openrouter.ai/docs
- Anthropic models/pricing: https://docs.anthropic.com/en/docs/about-claude/models
- E2B sandboxes: https://e2b.dev/docs
- Axolotl (fine-tuning): https://github.com/OpenAccess-AI-Collective/axolotl
- vLLM (serving): https://github.com/vllm-project/vllm

### Solana
- Helius: https://docs.helius.dev
- Birdeye: https://docs.birdeye.so
- Jupiter v6: https://dev.jup.ag
- DexScreener: https://docs.dexscreener.com
- Meteora DLMM: https://docs.meteora.ag

### LP Reference
- Meridian (Hunter/Healer/HiveMind pattern): https://github.com/yunus-0x/meridian
- Meteora Data API: https://dlmm.datapi.meteora.ag/swagger-ui/
- Uniswap v3 SDK: https://github.com/Uniswap/sdks/tree/main/sdks/v3-sdk
- The Graph (pool queries): https://thegraph.com/studio

### Perps & Markets
- Hyperliquid API: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api
- Polymarket CLOB: https://docs.polymarket.com/developers/CLOB/introduction
- Robinhood Crypto API: https://trading.robinhood.com

### Security
- sops: https://github.com/getsops/sops
- age: https://github.com/FiloSottile/age

### Inspirations & Reference Implementations
- Senpi.ai: https://senpi.ai — most comparable production system
- Senpi GitHub: https://github.com/senpi-ai
- Meridian (LP agent): https://agentmeridian.xyz

---

*This blueprint represents the complete technical vision for Luxy AI as of August 2025. Architecture decisions are recorded here to maintain alignment across implementation phases. All API endpoints, pricing, and rate limits should be re-verified before implementation as these change frequently.*
