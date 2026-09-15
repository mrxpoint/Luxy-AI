# LUXY AI — System Blueprint v1.4

> Complete technical specification for building an autonomous AI trading agent system with a native quantitative engine (LuxyEngine), multi-layer memory (HiveMind + conversation + RAG), interactive backtesting, Freqtrade-style easy CLI, full ordered Docker installation, optional LLM reasoning, autonomous runtime, and E2B-powered in-session code execution.

---

## Table of Contents

1. [Vision & Philosophy](#1-vision--philosophy)
2. [System Architecture](#2-system-architecture)
3. [AI Model Architecture](#3-ai-model-architecture)
   - 3.1 [LuxyEngine — Quantitative Decision Layer](#31-luxyengine--quantitative-decision-layer)
   - 3.2 [Two-Tier LLM Strategy (Optional Enhancement)](#32-two-tier-llm-strategy-optional-enhancement)
   - 3.3 [Fine-Tuning Architecture](#33-fine-tuning-architecture)
   - 3.4 [Provider-Agnostic Adapter](#34-provider-agnostic-adapter)
4. [E2B In-Session Terminal](#4-e2b-in-session-terminal)
5. [Runtime Architecture](#5-runtime-architecture)
6. [Agent Breakdown](#6-agent-breakdown)
7. [Risk Management Layer](#7-risk-management-layer)
8. [Data Architecture](#8-data-architecture)
   - 8.4 [Memory Architecture](#84-memory-architecture)
9. [Market Connectivity](#9-market-connectivity)
10. [Interface Layer](#10-interface-layer)
   - 10.4 [Interactive Backtest Runner](#104-interactive-backtest-runner)
11. [Fine-Tuning Pipeline](#11-fine-tuning-pipeline)
12. [Security & Key Management](#12-security--key-management)
13. [Deployment Architecture](#13-deployment-architecture)
   - 13.3 [Luxy CLI & Easy Setup (Freqtrade-style)](#133-luxy-cli--easy-setup-freqtrade-style)
   - 13.4 [Complete ordered installation (zero → running)](#134-complete-ordered-installation-zero--running)
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

Luxy is built on six design principles:

**1. Quantitative core first, LLM second.** Core scoring, ranking, and bias decisions run through **LuxyEngine** — a native quantitative layer (LightGBM / XGBoost / CatBoost / PyTorch). The LLM is an optional enhancement layer for higher-quality reasoning, narrative context, and edge-case analysis. The system remains fully operational even when the LLM is unavailable or deliberately disabled.

**2. The model must be domain-specific.** A general LLM prompted to trade is like hiring a poet to do accounting. When used, Luxy employs models (or a future fine-tuned model) that understand order book dynamics, on-chain signal patterns, DeFi liquidity mechanics, and historical market regimes. LuxyEngine itself is trained on the same domain data.

**3. The terminal must be in every session.** The critical missing piece in all existing AI agent trading systems is the ability to *validate a trade decision in code before executing it*. Luxy gives every agent session a dedicated E2B sandboxed environment where the agent can write and run analysis code, backtest strategies, and compute signals — all within the same session loop, before the intent is submitted to the executor.

**4. Engine + LLM = decisions. Bot = execution.** LuxyEngine produces structured predictions (score, confidence, action bias, feature contributions). The optional LLM can consume those predictions as rich context and emit a final `LuxyIntent`. Execution is handled by a separate, deterministic bot layer that enforces hardcoded risk rules neither the engine nor the LLM can override.

**5. The system learns across sessions.** HiveMind captures structured lessons from closed positions. Conversation memory preserves multi-turn chat. Vector RAG retrieves relevant past trades and lessons by similarity. Future engine training runs and agent calls are primed with this combined memory, creating a compounding intelligence loop.

**6. Risk is not a prompt instruction.** Max position size, max drawdown kill switch, slippage limits — these are hardcoded in the executor, outside both LuxyEngine and LLM control. An adversarial prompt, a hallucinated reasoning chain, a model drift, or a bad market condition cannot cause the system to blow up the account.

### 1.3 Comparison: Luxy vs Senpi.ai

[Senpi.ai](https://senpi.ai) is the closest reference implementation. Key differences:

| Dimension | Senpi.ai | Luxy AI |
|---|---|---|
| Quantitative engine | Not primary | **LuxyEngine** (LightGBM / XGBoost / CatBoost / PyTorch) as native first layer |
| Fine-tuned / LLM model | Senpi Samurai (Hyperliquid-specific) | Optional enhancement + planned multi-market fine-tune |
| Strategy packaging | 80+ strategy templates | Strategy self-tuning via Luxy agent |
| In-session code execution | None | **E2B sandbox in every session** |
| Cross-session learning | HiveMind (cloud) | HiveMind (self-hosted, PostgreSQL) + engine retrain |
| Supported markets | Hyperliquid primary | Solana, Hyperliquid, Base, Ethereum, Polymarket |
| Open-source | Partial | Full (Apache 2.0) |
| Deployment | Cloud-first | **Full Docker Compose** (default), self-hosted VPS |

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
║  │  ┌──────────────────────┐   ┌────────────────┐  ┌────────────┐ │ ║
║  │  │   LuxyEngine         │   │  Luxy Core LLM │  │ E2B        │ │ ║
║  │  │   (Quantitative)     │──►│  (Optional)    │◄─►│ Sandbox    │ │ ║
║  │  │                      │   │                │  │ Terminal   │ │ ║
║  │  │  LightGBM / XGBoost  │   │  Anthropic /   │  │ Backtest   │ │ ║
║  │  │  CatBoost / PyTorch  │   │  OpenRouter /  │  │ Analysis   │ │ ║
║  │  │  score · confidence  │   │  local fine-   │  │            │ │ ║
║  │  │  action_bias · FI    │   │  tuned model   │  │            │ │ ║
║  │  └──────────┬───────────┘   └───────┬────────┘  └────────────┘ │ ║
║  │             │                       │                            │ ║
║  │             └───────────┬───────────┘                            │ ║
║  │                         │ LuxyIntent (structured JSON)           │ ║
║  └─────────────────────────┼────────────────────────────────────────┘ ║
║                            │                                           ║
║  ┌─────────────────────────▼────────── AGENT LAYER ───────────────┐  ║
║  │                                                                  │  ║
║  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │  ║
║  │  │  Meme    │  │  Perps   │  │    LP    │  │  Narrative   │  │  ║
║  │  │  Agent   │  │  Agent   │  │  Agent   │  │   Agent      │  │  ║
║  │  │ Solana   │  │ Hyperlq  │  │  Hunter  │  │  Reddit      │  │  ║
║  │  │ DexScr   │  │ screener │  │  Healer  │  │  Telegram    │  │  ║
║  │  │ Birdeye  │  │          │  │ HiveMind │  │              │  │  ║
║  │  │ Helius   │  │          │  │          │  │              │  │  ║
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
║  │  │  Risk Guard (hardcoded) → Jupiter / HL / Uniswap / PM   │   │  ║
║  │  │  LP Deploy/Rebalance → Portfolio tracking               │   │  ║
║  │  └─────────────────────────────────────────────────────────┘   │  ║
║  └──────────────────────────────────────────────────────────────── ┘  ║
║                                                                       ║
║  ┌──────────────────────────── DATA LAYER ─────────────────────── ┐  ║
║  │  PostgreSQL 16 + TimescaleDB     Redis 7                       │  ║
║  │  positions · signals · models    BullMQ queues · feature cache │  ║
║  │  lp_lessons · wallets · audit    Pause flags                   │  ║
║  │  strategy_config · engine_runs                                 │  ║
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
┌───────────────┐     rule-based
│   Screener    │────scoring ──────────────┐
│  (24/7 bot)   │                          │
└───────────────┘                          ▼
                                   ┌──────────────────┐
                                   │   LuxyEngine     │
                                   │  (LightGBM /     │
                                   │   XGBoost /      │
                                   │   CatBoost /     │
                                   │   PyTorch)       │
                                   │                  │
                                   │  Features →      │
                                   │  score, conf,    │
                                   │  action_bias,    │
                                   │  top features    │
                                   └────────┬─────────┘
                                            │ EnginePrediction
                                            ▼
                                   ┌──────────────────┐
                                   │  Signal Queue    │
                                   │  (Redis/BullMQ)  │
                                   └────────┬─────────┘
                                            │
                     ┌──────────────────────┼──────────────────────┐
                     │ mode=engine_only     │ mode=engine_plus_llm │
                     ▼                      ▼
              ┌─────────────┐     ┌─────────────────────────┐
              │ Luxy Agent  │     │      Luxy Agent          │
              │ (pass-thru) │     │  (LLM enhancement)       │
              │             │     │                          │
              │ Intent from │     │  1. Receive Engine pred  │
              │ Engine bias │     │  2. Optional E2B backtest│
              └──────┬──────┘     │  3. LLM reasoning        │
                     │            │  4. Output LuxyIntent    │
                     │            └──────────┬───────────────┘
                     └───────────┬───────────┘
                                 │ LuxyIntent JSON
                                 ▼
                      ┌──────────────────────────┐
                      │       Risk Guard          │
                      │  (hardcoded, engine- &   │
                      │   LLM-proof)             │
                      │  checkPositionSize()      │
                      │  checkDailyDrawdown()     │
                      │  checkSlippage()          │
                      └──────────┬───────────────┘
                                 │ allowed = true
                                 ▼
                      ┌──────────────────────────┐
                      │        Executor           │
                      │  Jupiter / HL / Uniswap / │
                      │  Polymarket / Robinhood   │
                      │  Record Position in DB    │
                      │  Notify via Telegram      │
                      └──────────────────────────┘
```

---

## 3. AI Model Architecture

Luxy’s decision stack is deliberately layered:

1. **LuxyEngine** (native quantitative layer) — always on, low-latency, deterministic, trainable.
2. **LLM** (optional enhancement) — used when higher reasoning quality is desired.
3. **E2B** — code-level validation before any intent reaches the executor.

### 3.1 LuxyEngine — Quantitative Decision Layer

**LuxyEngine** is a first-class component that sits between the screener and the (optional) LLM. It turns raw and engineered market features into structured predictions that the rest of the system can consume without calling an LLM.

#### 3.1.1 Responsibilities

- Feature engineering from candles, liquidity, volume, holder concentration, social signals, HiveMind lessons, etc.
- Multi-backend inference: **LightGBM**, **XGBoost**, **CatBoost**, **PyTorch**
- Model versioning and registry
- Structured, explainable output (score + confidence + action bias + feature contributions)
- Optional scheduled / online retrain from closed positions and labeled signals

#### 3.1.2 Core Interface

```typescript
// Conceptual contract — src/engine/types.ts
interface LuxyEnginePrediction {
  score: number;                 // 0.0 – 1.0
  confidence: number;            // 0.0 – 1.0
  action_bias: "entry" | "skip" | "watch" | "exit";
  top_features: Array<{
    name: string;
    contribution: number;        // SHAP / gain based
  }>;
  model: "lightgbm" | "xgboost" | "catboost" | "pytorch";
  model_version: string;         // e.g. "lgbm-meme-v3"
  raw_features: Record<string, number>;
  inference_ms: number;
  created_at: string;            // ISO
}

interface LuxyEngine {
  predict(candidate: ScoredCandidate, context?: EngineContext): Promise<LuxyEnginePrediction>;
  retrain?(dataset: TrainingBatch): Promise<{ model_version: string }>;
  listModels(): Promise<ModelMeta[]>;
}
```

#### 3.1.3 Operating Modes

| Mode | Behavior | Typical use |
|------|----------|-------------|
| `engine_only` | LuxyEngine decision is final (mapped to LuxyIntent) | High-frequency / cost-sensitive / LLM unavailable |
| `engine_plus_llm` | Engine prediction is injected as rich context into the LLM prompt | Default production mode — best of both worlds |
| `llm_only` | Classic path (rule score → LLM). Engine still records features for later training | A/B testing / fallback |

Config (env):

```ini
LUXY_ENGINE_ENABLED=true
LUXY_ENGINE_MODE=engine_plus_llm   # engine_only | engine_plus_llm | llm_only
LUXY_ENGINE_BACKEND=lightgbm       # lightgbm | xgboost | catboost | pytorch
LUXY_ENGINE_MODEL_VERSION=latest
```

#### 3.1.4 Why multiple backends

- **LightGBM / XGBoost / CatBoost** — excellent tabular performance, fast inference, native feature importance, low resource footprint. Default for most agents.
- **PyTorch** — for sequential / representation-learning experiments (candle windows, order-flow style features) when tabular models plateau.

The engine exposes a single prediction interface so the rest of the system never cares which backend produced the score.

#### 3.1.5 Training & continuous learning

- Training data is derived from `signals`, `positions`, `backtest_runs`, and `lp_lessons`.
- Labels come from realized outcomes (PnL, max adverse excursion, hold duration).
- Model artifacts + metadata are stored in object storage / local volume and registered in a `engine_models` table.
- Retrain can be triggered manually or on a schedule (e.g. weekly) via a dedicated process or job.

LuxyEngine never executes trades. It only produces predictions. Risk Guard remains the final authority.

---

### 3.2 Two-Tier LLM Strategy (Optional Enhancement)

When `LUXY_ENGINE_MODE` includes the LLM, Luxy still uses two distinct LLM tiers with different cost/capability tradeoffs:

```
┌─────────────────────────────────────────────────────────┐
│  TIER 1 — Luxy Core (High-Stakes Decisions)             │
│                                                          │
│  Provider: Anthropic direct API (claude-sonnet-5)       │
│  OR: Custom fine-tuned model (later)                    │
│  Use cases: Final entry/exit decision, strategy updates │
│  Input: EnginePrediction + market context + E2B results │
│  Trigger: On signal (event-driven), never polling       │
│  Cost: ~$2-10 per million tokens (paid per use)         │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  TIER 2 — Sub-agent LLM (High-Volume, Low-Stakes)       │
│                                                          │
│  Provider: OpenRouter (deepseek/deepseek-chat-v3-0324)  │
│  Use cases: Token screening assist, narrative analysis, │
│             LP categorization, hype detection           │
│  Volume: Hundreds of calls per day                      │
│  Cost: $0.24/M input, $0.90/M output                   │
│  Fallback: OpenRouter :free models (50 req/day)         │
└─────────────────────────────────────────────────────────┘
```

The LLM never sees raw private keys and never bypasses Risk Guard. When LuxyEngine is enabled, the LLM’s primary job is to interpret the engine’s score, feature contributions, and any E2B backtest results, then emit a clean `LuxyIntent`.

---

### 3.3 Fine-Tuning Architecture

The long-term goal remains a model that *natively understands* trading context. Fine-tuning now serves two purposes:

1. Improve the optional Tier-1 LLM.
2. Provide richer labels / soft targets that can also help LuxyEngine (knowledge distillation style).

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
    │  Input: signal context + EnginePrediction + market state
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
  "reasoning": "Engine score 0.81 (lgbm-meme-v3). Top features: volume/liquidity 4.2x, SMA slope positive. E2B backtest: 64% win rate, 1.6 Sharpe. Risk: thin liquidity at $85k, set stop at -12%.",
  "confidence": 0.72,
  "engine": {
    "score": 0.81,
    "model_version": "lgbm-meme-v3"
  },
  "createdAt": "2025-08-19T14:22:00Z"
}
```

---

### 3.4 Provider-Agnostic Adapter

All LLM calls still go through a single adapter interface — switching from Anthropic to a self-hosted fine-tuned model requires changing one config line:

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

LuxyEngine itself is **not** routed through this adapter; it has its own lightweight client/process.

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

### 5.1 Process Architecture (Docker default)

Default deployment is **full Docker Compose** (see §13). Each logical process runs in its own container. The conceptual process set is:

```
Docker Compose services
├── screener          → Meme / multi-venue screener loop
├── luxy-engine       → LuxyEngine inference + optional retrain worker
├── executor          → BullMQ worker: risk check + order execution
├── luxy-agent        → Decision agent (engine_only | engine_plus_llm) + E2B
├── perps-agent       → Hyperliquid screener + position monitor
├── lp-agent          → Meteora / Uniswap Hunter/Healer/HiveMind
├── narrative-agent   → Reddit + Telegram + optional LLM hype detection
├── polymarket-agent  → Polymarket Gamma/CLOB agent
├── candles           → TimescaleDB candle ingest
├── telegram-bot      → grammY bot + notification worker
├── web               → Next.js dashboard
├── db                → PostgreSQL 16 + TimescaleDB
└── cache             → Redis 7 (BullMQ + feature cache)
```

**Signal flow between processes:**

```
screener ──► LuxyEngine ──► Redis signalQueue ──► luxy-agent
                                                      │
narrative-agent ──────────────────────────────►       │ (processes signal)
                                                      │
perps / lp / polymarket ──► Redis intentQueue ◄───────┘
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
-- Core operational tables
positions         -- All trades (open + closed) with PnL tracking
signals           -- Screener/narrative signals with raw_data JSONB
strategy_config   -- Versioned strategy parameters per agent
audit_log         -- Immutable action log
wallets           -- Agent wallet addresses (public only)
lp_lessons        -- HiveMind: structured LP position outcomes

-- Market & evaluation
candles           -- TimescaleDB hypertable for OHLCV (multi-venue)
backtest_runs     -- E2B / local / interactive backtest results
model_evals       -- Fine-tuning + LuxyEngine evaluation results
engine_models     -- LuxyEngine model registry (version, backend, metrics, path)

-- Memory layer (see §8.4)
chat_sessions     -- Conversation sessions (Telegram / Web / API)
chat_messages     -- Ordered messages within a session
memory_chunks     -- Chunked text + metadata for RAG retrieval
memory_embeddings -- Vector embeddings (pgvector) keyed to memory_chunks
agent_sessions    -- Short-lived working memory / scratchpad per agent run
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

-- Memory
CREATE INDEX idx_chat_messages_session ON chat_messages (session_id, created_at);
CREATE INDEX idx_memory_chunks_source ON memory_chunks (source_type, source_id);
-- pgvector similarity (requires CREATE EXTENSION vector)
CREATE INDEX idx_memory_embeddings_cosine ON memory_embeddings
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
```

### 8.3 Redis Usage

| Key/Queue | Type | Purpose |
|---|---|---|
| `signals` (BullMQ) | List | Screener → Luxy signal queue |
| `intents` (BullMQ) | List | Luxy → Executor intent queue |
| `notifications` (BullMQ) | List | All → Telegram notification queue |
| `backtest` (BullMQ) | List | Interactive / scheduled backtest jobs |
| `luxy:paused` | String | Global pause flag for executor |
| `price:sol` | String | Cached SOL price (30s TTL) |
| `session:{id}` | Hash / String | Optional hot session scratch (TTL) |

**Persistence:** RDB + AOF hybrid. `maxmemory-policy: noeviction` (never silently drop queue jobs).

### 8.4 Memory Architecture

Luxy has three complementary memory systems. They are intentionally separated so that operational lessons, chat context, and retrieval-augmented knowledge do not collapse into a single opaque store.

#### 8.4.1 HiveMind + operational DB history (already in production)

- **HiveMind (`lp_lessons`)** — structured lessons from closed LP (and, over time, other) positions: action, outcome summary, pool/market id, regime tags.
- **Operational tables** — `positions`, `signals`, `audit_log`, `backtest_runs`, `strategy_config` provide durable, queryable history for agents, LuxyEngine training, and the UI.
- Injected into Luxy Agent / LuxyEngine context as compact lesson strings and aggregate stats (not raw chat dumps).

#### 8.4.2 Conversation memory (chat sessions)

Stateful multi-turn dialogue for Web Chat, Telegram `/chat`, and future API clients.

```text
User (Telegram | Web | API)
        │
        ▼
chat_sessions  (id, channel, user_ref, agent_scope, created_at, last_active_at)
        │
        ▼
chat_messages  (id, session_id, role: user|assistant|system|tool,
                content, tool_calls JSONB, created_at)
```

**Behaviour:**
- Each Telegram chat id / Web user gets a `chat_sessions` row (or one session per explicit “new chat”).
- Last *N* messages (configurable, default 20–40) are loaded into the LLM prompt as conversation history.
- Older messages are summarized or moved into `memory_chunks` for RAG (see below), not dropped silently.
- Tool/E2B/backtest results that the agent produced in-session can be stored as `role=tool` messages for later turns.

**Config (env):**
```ini
MEMORY_CHAT_MAX_MESSAGES=30
MEMORY_CHAT_SUMMARY_AFTER=40
MEMORY_CHAT_TTL_DAYS=90
```

#### 8.4.3 Session / working memory (per agent run)

Short-lived scratchpad for a single decision or backtest job:

- Keyed by `run_id` / `job_id`
- Holds intermediate Engine predictions, E2B stdout, feature vectors, user constraints for that run
- Stored primarily in Redis (`session:{id}`, TTL 1–24h) with optional spill to `agent_sessions` in Postgres for audit
- Never used as long-term knowledge; cleared after the run completes or TTL expires

#### 8.4.4 Vector RAG memory

For “remember what happened last time we traded SOL perps in high-funding regimes” style queries that pure SQL + last-N chat cannot answer well.

**Pipeline:**
1. **Chunk** — closed positions, HiveMind lessons, notable signals, backtest summaries, and (optionally) resolved Polymarket events → `memory_chunks` (text + metadata: agent, chain, symbol, time range, outcome).
2. **Embed** — embedding model (OpenAI / local / OpenRouter) → `memory_embeddings` via **pgvector**.
3. **Retrieve** — on agent/LLM call, embed the current question or signal context, cosine top-k, inject as “Retrieved memory” block in the prompt.
4. **Scope filters** — metadata filters (agent, chain, time window) so retrieval stays relevant.

**When RAG is used:**
- Luxy Agent decision context (optional, behind flag)
- `/chat` and Web Chat answers about past performance
- Strategy tuner and interactive backtest “similar setups” hints
- LuxyEngine feature enrichment (optional soft features from retrieved text stats)

**Config (env):**
```ini
MEMORY_RAG_ENABLED=true
MEMORY_RAG_TOP_K=8
MEMORY_EMBEDDING_PROVIDER=openai   # openai | openrouter | local
MEMORY_EMBEDDING_MODEL=text-embedding-3-small
MEMORY_CHUNK_MAX_TOKENS=512
```

**Design rules:**
- RAG is **read-only context**. It never bypasses Risk Guard or LuxyEngine hard scores.
- Private keys, full `.env`, and raw wallet secrets are never chunked or embedded.
- HiveMind structured rows remain the source of truth for LP lessons; RAG is a retrieval layer over text derived from them and other tables.

#### 8.4.5 Who consumes which memory

| Consumer | HiveMind / DB | Conversation | Session scratch | Vector RAG |
|---|---|---|---|---|
| LuxyEngine | Yes (features / labels) | No | Optional | Optional soft features |
| Luxy Agent (LLM) | Yes | Yes (chat) | Yes | Yes |
| Interactive Backtest | Yes (history) | No | Yes (job state) | Similar-setup retrieval |
| Web / Telegram Chat | Summary stats | Yes | No | Yes |
| Executor / Risk Guard | No | No | No | No |

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
| `POST /info { type: "candleSnapshot" }` | OHLCV candles (historical + recent) |
| `POST /info { type: "clearinghouseState" }` | User positions |
| `POST /exchange { action: ... }` | Order placement (EIP-712 signed) |

Rate limits: 1,200 weight/minute (IP), each info call = 20 weight.
Trading fees: 0.045% taker / 0.015% maker (base tier).

**Historical candles for backtest:**
- `candleSnapshot` supports coin, interval (`1m`/`5m`/`15m`/`1h`/`4h`/`1d`), and time range.
- Interactive Backtest Runner and candle ingest pull ranges into the TimescaleDB `candles` hypertable (venue=`hyperliquid`).
- User can request ranges via Telegram / Web / CLI (see §10.4); data is cached so repeated backtests do not re-hit the API.

### 9.3 EVM Chains (Phase 3)

| Chain | LP Protocol | Pool Data | RPC |
|---|---|---|---|
| Base | Uniswap v3 | The Graph subgraph | Alchemy/Infura |
| Ethereum | Uniswap v3/v4 | The Graph subgraph | Alchemy/Infura |

Uniswap v3 ETH subgraph ID: `5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV`

Historical pool/swap data for research backtests can be pulled from The Graph where available; execution still uses live QuoterV2 + SwapRouter02.

### 9.4 Polymarket (Phase 3)

| Service | Chain | Auth |
|---|---|---|
| CLOB API | Polygon (Chain ID: 137) | EIP-712 L1 + HMAC L2 |
| Gamma API | — | Public market metadata |
| TypeScript SDK | `@polymarket/ts-sdk` | API key |

**Historical / resolved markets for backtest & research:**
- Gamma + CLOB expose markets, events, and (where available) price history / resolution outcomes.
- Luxy only uses **data that Polymarket actually provides** — no fabricated series.
- Interactive Backtest can:
  - Filter by time range (`from` / `to`)
  - Filter by event / market slug or tag (if exposed by Gamma)
  - Restrict to **resolved** markets only (for label-quality research and Engine training)
- Resolved outcomes are stored as memory chunks / training labels when useful; live trading still goes through the signed CLOB path only.

### 9.5 Historical data contract (all venues)

```typescript
interface HistoricalFetchRequest {
  venue: "hyperliquid" | "birdeye" | "polymarket" | "uniswap_subgraph";
  symbolOrMarket: string;       // coin, token, or market id/slug
  interval?: string;            // candles: 1m, 5m, 1h, ...
  from: string;                 // ISO or unix
  to: string;
  resolvedOnly?: boolean;       // polymarket
  eventFilter?: string;         // polymarket event/tag if available
}

interface HistoricalFetchResult {
  venue: string;
  series: Array<Candle | PolymarketPoint>;
  cached: boolean;
  source: "api" | "timescaledb" | "partial_cache";
}
```

All interactive backtests and Engine training prefer TimescaleDB cache; APIs are used to fill gaps only.

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
| `/chat` Luxy Chat | Client component | API: `/api/chat` → agent + conversation memory |
| `/signals` Screener | Server component | DB: signals (+ engine score when available) |
| `/positions` | Server component | DB: positions history |
| `/strategy` | Server component | DB: strategy_config versions |
| `/evaluation` | Client + server | Backtest runs, strategy comparison |
| `/backtest` | Client component | **Interactive Backtest Runner** (§10.4) |

Chat uses `chat_sessions` / `chat_messages` and optional RAG retrieval so multi-turn context is preserved.

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
| `/chat <msg>` | Multi-turn chat with conversation memory |
| `/newchat` | Start a fresh chat session |
| `/memory <query>` | RAG query over lessons / past trades (optional) |
| `/backtest` | Interactive backtest wizard (see §10.4) |
| `/candles` | Fetch / cache historical candles for a venue+symbol+range |
| `/proposals` `/approve` `/reject` | Strategy self-tuning flow |

**Notification schema:**

```
[SIGNAL]  WIF score=0.82 — strong organic volume, 1.2k txns/24h
[ENTRY]   Entered WIF (solana) — $75, entry $2.34, tx: 5K2j...
[EXIT]    Closed WIF — PnL: +$12.40 (+16.6%)
[ALERT]   Risk guard blocked: daily drawdown limit reached (-8.1%)
[LP]      Redeployed SOL/USDC to bin 3420-3480 — range shift detected
[HYPE]    WIF trending on Reddit (high hype, bullish) — 12 posts
[BACKTEST] job=bt_01abc done — win_rate 58% sharpe 1.4 n=42
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

### 10.4 Interactive Backtest Runner

Backtesting exists in three layers. Layers 1–2 are already in the codebase; layer 3 is specified here for implementation.

| Layer | Role | Status in codebase |
|---|---|---|
| 1. In-session (E2B / local TS) | Agent validates a candidate before intent | Implemented |
| 2. Replay | `scripts/replay-signals.ts` over stored signals | Implemented |
| 3. **Interactive Runner** | User-triggered jobs via Web / Telegram / CLI | **To implement** |

#### 10.4.1 Goals

- User can download historical candles/charts from supported venues (Hyperliquid, Birdeye/Solana, and other configured sources).
- User can run backtests on a chosen symbol, interval, and time range.
- For Polymarket: run research backtests / edge studies on **resolved** markets and events within a user-defined window (only data Polymarket actually exposes).
- Results are stored in `backtest_runs`, shown in Web `/backtest` + `/evaluation`, and summarized on Telegram.
- Jobs are async (BullMQ `backtest` queue) so Telegram/Web stay responsive.

#### 10.4.2 Job contract

```typescript
interface BacktestJobRequest {
  source: "telegram" | "web" | "cli";
  userRef: string;
  venue: "hyperliquid" | "birdeye" | "polymarket" | "replay_signals";
  symbolOrMarket: string;
  interval?: string;          // e.g. "5m", "1h"
  from: string;               // ISO
  to: string;
  strategy?: string;          // named strategy or params JSON
  params?: Record<string, unknown>;
  resolvedOnly?: boolean;     // polymarket
  eventFilter?: string;       // polymarket event/tag if available
  engine?: "e2b" | "local-ts" | "luxy-engine";
}

interface BacktestJobResult {
  jobId: string;
  status: "queued" | "running" | "done" | "failed";
  metrics?: {
    n_trades: number;
    win_rate: number;
    sharpe: number;
    max_drawdown: number;
    pnl_pct: number;
  };
  chartRef?: string;          // optional stored series id / path
  error?: string;
}
```

#### 10.4.3 Historical data pull

1. Check TimescaleDB `candles` (or polymarket cache table) for the requested range.
2. If gaps exist, call venue API (`candleSnapshot` for Hyperliquid, Birdeye OHLCV, Gamma/CLOB for Polymarket resolved series **if provided**).
3. Upsert into cache; mark `source` on the job result (`api` | `timescaledb` | `partial_cache`).
4. Never invent candles or resolution outcomes.

#### 10.4.4 Telegram UX

```
/backtest
  → bot asks: venue? (hyperliquid | polymarket | birdeye | replay)
  → symbol/market?
  → from / to? (or presets: 7d, 30d, 90d)
  → interval? (for candles)
  → resolved only? (polymarket)
  → confirm → enqueue job → reply job id

/backtest status <jobId>
/backtest last
/candles hyperliquid BTC 1h 2026-08-01 2026-09-01
```

Long results are truncated in chat; full metrics + link (if Web is deployed) are included.

#### 10.4.5 Web UX (`/backtest`)

- Form: venue, symbol/market, date range, interval, strategy params, Polymarket filters.
- “Fetch data only” vs “Fetch + run backtest”.
- Job list with status; detail view with metrics and simple equity/drawdown chart (from cached series).
- Deep link from `/evaluation` to re-run a past job with modified params.
- Auth: same Bearer / session rules as other mutation APIs.

#### 10.4.6 CLI

```bash
pnpm backtest --venue hyperliquid --symbol BTC --interval 1h --from 2026-08-01 --to 2026-09-01
pnpm candles --venue polymarket --market <slug> --from ... --to ... --resolved-only
```

#### 10.4.7 Safety

- Interactive backtests are **read-only** research. They never place live orders.
- Risk Guard and live interlocks are unaffected.
- Rate-limit historical API pulls per user/IP to protect venue quotas.

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

**Default deployment model is full Docker Compose.**  
PM2 remains available as a lightweight alternative for development or very small VPS, but production and the recommended path use containers.

### 13.1 Default: Full Docker Compose

All processes run as isolated services defined in `docker-compose.prod.yml` (and the lighter `docker-compose.yml` for local infra-only development).

```yaml
# Conceptual layout (actual file: docker-compose.prod.yml)
services:
  screener:
  luxy-engine:          # NEW — quantitative inference / retrain
  executor:
  luxy-agent:
  perps-agent:
  lp-agent:
  narrative-agent:
  polymarket-agent:
  candles:
  telegram-bot:
  web:                  # ports: ["3000:3000"]
  db:                   # postgres:16 + TimescaleDB
  cache:                # redis:7 (noeviction + AOF)
```

**Key properties:**
- One process per container (`restart: unless-stopped`)
- Application containers run the **compiled** `dist/` output (Dockerfile multi-stage build)
- Secrets via `sops exec-env .env.enc 'docker compose ...'` or mounted env file
- Shared Docker network; only `web` (and optionally a reverse proxy) is exposed
- Volumes for Postgres data, Redis AOF, and LuxyEngine model artifacts

**Typical go-live commands:**

```bash
# 1. Decrypt secrets for the session (never write plaintext .env to disk in prod)
export SOPS_AGE_KEY_FILE=~/.config/sops/age/keys.txt
sops exec-env .env.enc 'docker compose -f docker-compose.prod.yml up -d --build'

# 2. Migrate
docker compose -f docker-compose.prod.yml exec luxy-agent node dist/scripts/migrate.js

# 3. Health
docker compose -f docker-compose.prod.yml exec luxy-agent node dist/scripts/healthcheck.js
```

**VPS sizing guidance:** 4 GB RAM recommended once LuxyEngine + TimescaleDB + multiple agents are running. Contabo / Hetzner / DigitalOcean remain the cost-optimized choices.

### 13.2 Alternative: PM2 (development / minimal VPS)

For local development or extremely constrained hosts, the previous PM2 + host Node layout is still supported via `ecosystem.config.cjs` and `scripts/deploy.sh`. Infra (Postgres + Redis) can still be started with the lightweight `docker compose up -d`.

This path is **not** the default for new production deployments.

### 13.3 Luxy CLI & Easy Setup (Freqtrade-style)

Luxy aims for the same day-1 ergonomics as Freqtrade: **minimal questions at setup, one command to run, model and data choices as separate, changeable steps** — not a long install wizard that forces algorithm selection.

#### 13.3.1 Design principles (borrowed from FreqAI, adapted)

| Principle | Freqtrade | Luxy |
|---|---|---|
| Install ML deps | Optional yes/no (+ optional Torch) | Optional Docker profile / optional npm extras |
| Choose model | CLI `--freqaimodel` + config | Env + `pnpm luxy engine --backend …` |
| Historical data | `download-data` + auto on live | `pnpm luxy candles` + auto-fill on Engine/backtest |
| Daily run | `freqtrade trade …` | `pnpm luxy start` |
| Safe default | dry-run common | `DRY_RUN=true` until explicit live interlock |

**Do not** ask “LightGBM or XGBoost?” during first install. Ask only whether to enable the Engine stack; backend is config and can be switched anytime.

#### 13.3.2 Entry point

Single user-facing CLI (implemented as `scripts/luxy-cli.ts`, exposed via package.json):

```bash
pnpm luxy <command> [options]
# after global link / publish: luxy <command>
```

#### 13.3.3 `pnpm luxy init` (interactive, once)

Minimal prompts only:

```text
Luxy setup
──────────
[1/5] Deploy mode?
      (1) Docker full (recommended)  (2) PM2 + docker infra only
[2/5] Enable LuxyEngine (ML)?
      (1) Yes — tree models (LightGBM/XGBoost/CatBoost)
      (2) Yes + PyTorch (large download)
      (3) No — LLM / rules only
[3/5] Download historical data now?
      (1) Yes  (2) Later
[4/5] Default candle venues?
      (1) Hyperliquid  (2) Birdeye/Solana  (3) Both
[5/5] Initial range?
      (1) 7d  (2) 30d  (3) 90d  (4) Custom

→ writes .env (non-secret defaults)
→ docker compose up / migrate
→ optional first candles pull
→ prints: pnpm luxy status
```

Writes (examples):

```ini
LUXY_ENGINE_ENABLED=true
LUXY_ENGINE_BACKEND=lightgbm
LUXY_ENGINE_MODE=engine_plus_llm
DRY_RUN=true
# LIVE_CONFIRM=          # must be "yes" only when going live
```

Secrets (API keys, private keys) are **never** collected by `init`; user edits `.env` or uses sops.

#### 13.3.4 Daily commands

| Command | Purpose |
|---|---|
| `pnpm luxy start` | `docker compose -f docker-compose.prod.yml up -d` (+ profile `engine` if enabled) |
| `pnpm luxy stop` | Stop stack |
| `pnpm luxy status` | Health: db, redis, services, DRY_RUN banner, engine backend/mode |
| `pnpm luxy logs [-f] [service]` | Tail logs |
| `pnpm luxy migrate` | Run DB migrations |
| `pnpm luxy engine` | Show current backend, mode, model_version |
| `pnpm luxy engine --backend xgboost` | Switch backend (updates env / restarts `luxy-engine`) |
| `pnpm luxy engine --mode engine_only` | Switch operating mode |
| `pnpm luxy engine list` | List registered models in `engine_models` |
| `pnpm luxy engine retrain` | Enqueue retrain job |
| `pnpm luxy candles --venue hyperliquid --symbol BTC --interval 1h --days 30` | Download / refresh historical OHLCV |
| `pnpm luxy candles --venue polymarket --resolved-only --days 90` | Pull resolved market series **if API provides** |
| `pnpm luxy backtest --venue hyperliquid --symbol SOL --interval 15m --from 2026-08-01 --to 2026-09-01` | Enqueue interactive backtest job |
| `pnpm luxy preflight` | Live preflight checks (no orders) |
| `pnpm luxy healthcheck` | Same as existing healthcheck script |

Candle and backtest flags mirror §9.5 and §10.4 (`--from/--to`, `--days`, `--resolved-only`, `--event-filter`).

#### 13.3.5 Docker profiles (optional heavy deps)

```bash
# Core only (no tree-ML / no torch)
docker compose -f docker-compose.prod.yml up -d

# + LuxyEngine tree backends
docker compose -f docker-compose.prod.yml --profile engine up -d

# + PyTorch
docker compose -f docker-compose.prod.yml --profile engine-torch up -d
```

| Profile | Contents |
|---|---|
| (default) | All agents, executor, web, db, redis — LLM path works |
| `engine` | + `luxy-engine` service, LightGBM / XGBoost / CatBoost deps |
| `engine-torch` | + PyTorch (larger image) |

CatBoost may be omitted on ARM (same constraint as Freqtrade).

#### 13.3.6 Auto data behaviour (FreqAI-like)

When Engine train/infer or an interactive backtest needs a range:

1. Query TimescaleDB `candles` (or polymarket cache) for coverage  
2. Fetch only gaps from venue APIs  
3. Upsert cache  
4. Proceed  

Manual `pnpm luxy candles` is for explicit control and bulk warm-up, not a hard prerequisite for every run.

#### 13.3.7 Telegram / Web parity

Critical CLI actions have thin mirrors:

- Telegram: `/engine`, `/engine backend <name>`, `/candles …`, `/backtest` wizard, `/status`
- Web: settings panel for backend/mode; `/backtest` page; status on dashboard  

Same safety rules: backtest and candles are read-only; live trading still requires `DRY_RUN=false` + `LIVE_CONFIRM=yes`.

#### 13.3.8 Implementation sketch

```text
scripts/luxy-cli.ts          # commander/yargs entry
src/cli/commands/
  init.ts
  start.ts | stop.ts | status.ts | logs.ts
  engine.ts
  candles.ts
  backtest.ts
package.json                 # "luxy": "tsx scripts/luxy-cli.ts"
```

Non-interactive CI: all prompts support flags (`--docker`, `--engine tree|torch|off`, `--days 30`, `--yes`).

### 13.4 Complete ordered installation (zero → running)

This is the **canonical install path** for a full system on a fresh VPS. Default is **full Docker Compose**. PM2 is only an alternative (§13.2). Until `pnpm luxy` is implemented, use the equivalent `docker compose` / `node dist/scripts/…` commands shown in parallel.

#### 13.4.1 Overview (checklist)

```text
 0. Provision VPS
 1. Install Docker on host
 2. Clone repository
 3. Create and edit .env (DRY_RUN=true)
 4. (Optional) Encrypt secrets with sops+age
 5. Build & start Docker stack
 6. Run database migrations
 7. Healthcheck
 8. (Optional) Historical candles warm-up
 9. (Optional) Bootstrap wallets — before any live path
10. Operate in dry-run (Telegram / Web / logs)
11. Preflight live (per venue)
12. Enable live only with DRY_RUN=false + LIVE_CONFIRM=yes
```

#### 13.4.2 Step 0 — Provision

| Item | Recommendation |
|---|---|
| OS | Ubuntu 22.04 or 24.04 LTS |
| RAM | **≥ 4 GB** once LuxyEngine + TimescaleDB + all agents run; 2 GB only for minimal dry-run experiments |
| Disk | ≥ 40 GB SSD (candles + model artifacts grow) |
| Network | SSH (22). Expose 3000 only behind reverse proxy if Web is public |
| Providers | Contabo / Hetzner / DigitalOcean (cost-optimized) |

#### 13.4.3 Step 1 — Host dependencies

```bash
# Docker Engine + Compose plugin
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# log out and back in so group applies

docker version
docker compose version
```

Node 22 + pnpm on the **host** are optional if you only operate via `docker compose exec`. They become useful for `pnpm luxy` once the CLI lands.

#### 13.4.4 Step 2 — Clone

```bash
sudo mkdir -p /opt/luxy && sudo chown "$USER:$USER" /opt/luxy
cd /opt/luxy
git clone https://github.com/mrxpoint/Luxy-AI.git
cd Luxy-AI
git checkout feat/initial-implementation   # or main after merge
```

#### 13.4.5 Step 3 — Environment file

```bash
cp .env.example .env
chmod 600 .env
```

**Minimum for a useful dry-run** (no funded keys required):

```ini
DRY_RUN=true
# LIVE_CONFIRM=                 # leave unset or anything other than "yes"

POSTGRES_PASSWORD=change_me_to_a_long_random_string
DATABASE_URL=postgresql://luxy:${POSTGRES_PASSWORD}@db:5432/luxydb
REDIS_URL=redis://cache:6379

# LLM — optional at first boot; required for LLM decision path
LUXY_LLM_PROVIDER=anthropic
LUXY_LLM_API_KEY=
SUBAGENT_LLM_PROVIDER=openrouter
SUBAGENT_LLM_API_KEY=

# Telegram — optional but recommended for ops
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

# E2B — optional; without it local TS backtest twin is used
E2B_API_KEY=

# LuxyEngine — enable when Phase 5 code exists
# LUXY_ENGINE_ENABLED=true
# LUXY_ENGINE_BACKEND=lightgbm
# LUXY_ENGINE_MODE=engine_plus_llm

# Venue keys — only when testing that venue (dry-run still OK without live keys)
# SOLANA_PRIVATE_KEY=
# HYPERLIQUID_PRIVATE_KEY=
# POLYMARKET_PRIVATE_KEY=
# EVM_EXECUTOR_PRIVATE_KEY=
```

**Rules:**
- Never commit `.env`
- Production should prefer `.env.enc` via sops (§12.1)
- `POSTGRES_PASSWORD` is required by `docker-compose.prod.yml` (no weak default in prod)

#### 13.4.6 Step 4 — Secrets encryption (recommended for production)

```bash
age-keygen -o ~/.config/sops/age/keys.txt
# put public key into .sops.yaml creation_rules

sops --encrypt .env > .env.enc
# Prefer runtime decrypt without writing plaintext:
export SOPS_AGE_KEY_FILE=~/.config/sops/age/keys.txt
# then prefix compose commands with: sops exec-env .env.enc '…'
```

#### 13.4.7 Step 5 — Build and start (full Docker)

```bash
cd /opt/luxy/Luxy-AI

# Core stack (all agents + db + redis + web)
docker compose -f docker-compose.prod.yml up -d --build

# After LuxyEngine is implemented:
# docker compose -f docker-compose.prod.yml --profile engine up -d --build
# docker compose -f docker-compose.prod.yml --profile engine-torch up -d --build

# With sops:
# sops exec-env .env.enc 'docker compose -f docker-compose.prod.yml up -d --build'
```

**Expected services (conceptual):**  
`db`, `cache`, `screener`, `executor`, `luxy-agent`, `perps-agent`, `lp-agent`, `narrative-agent`, `polymarket-agent`, `candle-ingest` (candles), `telegram-bot`, `web`, and later `luxy-engine`.

Verify containers:

```bash
docker compose -f docker-compose.prod.yml ps
```

#### 13.4.8 Step 6 — Database migration

```bash
docker compose -f docker-compose.prod.yml exec luxy-agent \
  node dist/scripts/migrate.js

# Future CLI:
# pnpm luxy migrate
```

Creates/updates: `positions`, `signals`, `strategy_config`, `audit_log`, `wallets`, `lp_lessons`, `candles` (Timescale), `backtest_runs`, `model_evals`, and later memory / `engine_models` tables.

#### 13.4.9 Step 7 — Healthcheck

```bash
docker compose -f docker-compose.prod.yml exec luxy-agent \
  node dist/scripts/healthcheck.js

curl -s http://127.0.0.1:3000/api/dashboard | head
docker compose -f docker-compose.prod.yml logs --tail=50 luxy-agent
```

**Success criteria:**
- Postgres and Redis reachable
- Banner shows **DRY_RUN**
- No crash loops on critical services
- Web API responds (if `web` service is up)

#### 13.4.10 Step 8 — Historical data (optional early, required for strong Engine/backtest)

```bash
# Future CLI examples:
pnpm luxy candles --venue hyperliquid --symbol BTC --interval 1h --days 30
pnpm luxy candles --venue birdeye --symbol <mint_or_symbol> --days 30
pnpm luxy candles --venue polymarket --resolved-only --days 90

# Until CLI exists: rely on candle-ingest service + manual scripts, or wait for auto gap-fill
```

Policy: **cache-first** (TimescaleDB). APIs only fill gaps. Polymarket historical/resolved data only when the upstream API actually provides it.

#### 13.4.11 Step 9 — Wallet bootstrap (before live or live-signing tests)

```bash
# One wallet per (agent × chain). Script refuses to overwrite.
pnpm bootstrap-wallet --agent=meme --chain=solana
pnpm bootstrap-wallet --agent=lp --chain=solana
# … base / ethereum / hyperliquid-related keys as needed

# Store secrets in .env / sops only. Public addresses may be recorded in DB.
```

Never commit private keys. Executor does not auto-approve unlimited token allowances on EVM.

#### 13.4.12 Step 10 — Operate in dry-run

```bash
docker compose -f docker-compose.prod.yml logs -f executor
# Telegram: /status /signals /positions /pause /chat
# Web UI: http://<host>:3000  (put behind nginx + TLS + auth if public)
```

All fills are simulated. Risk Guard and queues still run for realism.

#### 13.4.13 Step 11 — Live preflight

```bash
docker compose -f docker-compose.prod.yml exec luxy-agent \
  node dist/scripts/preflight-live.js
```

Checks connectivity, signing paths where configured, risk config, pause flag, and refuses to proceed if interlocks are wrong. **Does not place orders.**

#### 13.4.14 Step 12 — Go live (explicit dual interlock)

```ini
# .env — both required
DRY_RUN=false
LIVE_CONFIRM=yes
```

Then recreate or reload affected services:

```bash
docker compose -f docker-compose.prod.yml up -d --force-recreate executor luxy-agent
# or full stack reload if preferred
```

If `DRY_RUN=false` but `LIVE_CONFIRM` is not exactly `yes`, process **refuses to start live** and stays safe.

#### 13.4.15 Day-2 operations cheat sheet

| Task | Command (Docker) | Future CLI |
|---|---|---|
| Status | `docker compose … ps` + healthcheck | `pnpm luxy status` |
| Logs | `docker compose … logs -f <svc>` | `pnpm luxy logs -f <svc>` |
| Stop | `docker compose … stop` | `pnpm luxy stop` |
| Update code | `git pull` → `up -d --build` → migrate | `pnpm luxy start` after pull |
| Switch Engine backend | edit env → recreate `luxy-engine` | `pnpm luxy engine --backend xgboost` |
| Backtest job | (queue / web / telegram) | `pnpm luxy backtest …` |
| Pause trading | Telegram `/pause` or Redis `luxy:paused` | same |

#### 13.4.16 What “fully installed” means

The system is considered **installed and operational** when:

1. All required containers are `running` / healthy  
2. Migrations applied  
3. Healthcheck passes with DRY_RUN banner  
4. At least one path produces signals or dry-run intents (screener → queue → agent/executor)  
5. Web and/or Telegram respond  

LuxyEngine, conversation RAG, and interactive backtest runner are **additional capabilities** on top of this baseline; their absence does not block a valid dry-run install.

#### 13.4.17 Common failure modes

| Symptom | Likely cause | Action |
|---|---|---|
| `db` unhealthy | Wrong `POSTGRES_PASSWORD` / volume perms | Fix `.env`, recreate `db` |
| Agent exit on boot | Missing required env / LIVE interlock mis-set | Read logs; set `DRY_RUN=true` |
| No signals | Screener API keys / network | Check screener logs, Birdeye/Helius/DexScreener |
| Web 401 on mutations | `LUXY_WEB_TOKEN` set but client missing Bearer | Pass token or unset for private LAN |
| Live refused | `LIVE_CONFIRM` not `yes` | Intentional — set only when ready |

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
- [x] Meme Agent EVM: Base + Ethereum support (DexScreener + Uniswap v3)
- [x] LP Agent EVM: Uniswap v3 Hunter/Healer with gas cost optimizer (v4 quoter/execution deferred — v3 verified live first)
- [x] Prediction Market Agent: Polymarket CLOB API (GTC/GTD orders; order format v2, L1/L2 auth, POLY_1271 deposit-wallet flow)
- [x] **E2B Terminal Integration:** sandboxed Python executor per agent session
- [x] Strategy self-tuning: Luxy proposes → user approves → new version in strategy_config
- [x] Robinhood Crypto API: Ed25519-signed orders for US crypto markets
- [x] Web UI additions: Positions history + Strategy Config versioning page

**E2B integration specifics:**
- Custom E2B template with pandas, numpy, ta, scikit-learn
- `src/e2b/sandbox.ts` — LuxySandbox class with `init()`, `run()`, `close()`
- Agent system prompt updated to mandate code validation before entry
- Analysis templates: momentum backtest, Kelly sizing, liquidity depth check
- Backtest results stored in new `backtest_runs` table for future fine-tuning dataset

### Phase 4 — Production Scale + Fine-Tuned Model

**Target deliverables:**
- [x] Docker Compose: full service isolation per process (**now the default deployment model** — see §13.1)
- [x] TUI: Ink multi-panel terminal (prices + positions + alerts)
- [x] Backtesting engine: replay historical signals from `signals` table
- [x] Custom fine-tuned model — **deferred by decision**: the training-data pipeline (`pnpm ft:export` → JSONL SFT + `model_evals` registration) runs from day one, and any fine-tuned or third-party model plugs in via the OpenAI-compatible adapter (`LUXY_LLM_PROVIDER=openai|openrouter|local`). A QLoRA/Axolotl training run remains an option once 60+ days of labeled sessions exist.
- [x] TimescaleDB: OHLCV hypertable for efficient time-series queries
- [x] Strategy evaluation dashboard: backtest comparison across versions
- [ ] Multi-VPS: separate DB VPS when system grows beyond single node (operational step, not code)

**Live-trading enablement (all phases):**
- [x] Hyperliquid EIP-712 order signing (msgpack action hash + Agent phantom payload — verified against mainnet signature checking)
- [x] Jupiter v6 swap build/sign/submit with the agent keypair
- [x] Uniswap SwapRouter02 live swaps (entries + reverse exits, never auto-approving allowances)
- [x] Polymarket CLOB live orders (L1 ClobAuth → L2 HMAC → order-v2 EIP-712, incl. deposit-wallet flow)
- [x] Global interlock: `DRY_RUN=false` + `LIVE_CONFIRM=yes` required to boot live
- [x] `scripts/preflight-live.ts`, `scripts/healthcheck.ts`, `scripts/deploy.sh`, [docs/DEPLOY.md](docs/DEPLOY.md)

### Phase 5 — LuxyEngine (Quantitative Native Layer)  ← primary focus

**Target deliverables:**
- [ ] LuxyEngine module (`src/engine/`) with unified prediction interface
- [ ] Backends: LightGBM (default), XGBoost, CatBoost, PyTorch
- [ ] Feature engineering pipeline from existing market + position data
- [ ] Operating modes: `engine_only` | `engine_plus_llm` | `llm_only`
- [ ] Model registry table + versioned artifacts
- [ ] Integration into screener → signal path and Luxy Agent context
- [ ] Docker service `luxy-engine` added to `docker-compose.prod.yml`
- [ ] Retrain job / script fed by closed positions + labeled signals
- [ ] Web UI: engine score, top features, model version on signal & decision views
- [ ] Documentation & config (`.env.example`, BLUEPRINT §3.1)

### Phase 6 — Memory + Interactive Backtest + Easy CLI

**Target deliverables:**

**Memory (§8.4)**
- [ ] `chat_sessions` + `chat_messages` schema and migration
- [ ] Conversation memory wired to Web `/chat` and Telegram `/chat` + `/newchat`
- [ ] Session/working memory (Redis TTL + optional `agent_sessions`)
- [ ] `memory_chunks` + `memory_embeddings` (pgvector) + embedding pipeline
- [ ] RAG retrieval helper used by Luxy Agent, chat, and optional Engine soft features
- [ ] Config: `MEMORY_*` env keys; never embed secrets

**Interactive Backtest (§10.4)**
- [ ] BullMQ `backtest` queue + worker
- [ ] Historical fetch: Hyperliquid `candleSnapshot`, Birdeye OHLCV, Polymarket resolved/event data **only when API provides it**
- [ ] TimescaleDB cache-first policy for candles / series
- [ ] Telegram: `/backtest` wizard, `/backtest status`, `/candles`
- [ ] Web: `/backtest` full runner + richer `/evaluation`
- [ ] Results persisted to `backtest_runs`; notify on completion
- [ ] Read-only guarantee (no live orders from backtest jobs)

**Luxy CLI & Easy Setup (§13.3)**
- [ ] `scripts/luxy-cli.ts` + `pnpm luxy` entry
- [ ] `luxy init` interactive (deploy mode, engine on/off/+torch, optional first candles) — no algorithm quiz
- [ ] `luxy start|stop|status|logs|migrate|preflight|healthcheck`
- [ ] `luxy engine` / `--backend` / `--mode` / `list` / `retrain`
- [ ] `luxy candles` and `luxy backtest` with venue/range flags
- [ ] Docker Compose profiles: default, `engine`, `engine-torch`
- [ ] Auto gap-fill historical data on Engine/backtest (cache-first)
- [ ] Telegram/Web parity for engine backend, candles, backtest
- [ ] Non-interactive flags for CI (`--yes`, `--docker`, `--engine tree|torch|off`)

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

*This blueprint (v1.4) represents the complete technical vision for Luxy AI as of September 2026. Major additions: v1.1 — LuxyEngine + Docker-default deploy; v1.2 — Memory + Interactive Backtest; v1.3 — Freqtrade-style CLI (§13.3); v1.4 — Complete ordered installation zero→running (§13.4: VPS → Docker → migrate → health → dry-run → preflight → live interlock). Architecture decisions are recorded here to maintain alignment across implementation phases. All API endpoints, pricing, and rate limits should be re-verified before implementation as these change frequently.*
