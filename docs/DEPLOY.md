# Luxy AI — Deployment & Go-Live Runbook

From a bare VPS to live trading, in order. Every step is idempotent unless noted.
Default posture is **dry-run** (`DRY_RUN=true`): every fill is simulated end-to-end and no
key, wallet or funded account is required to boot the full system.

---

## 1. Provision

| Requirement | Notes |
|---|---|
| VPS 2–4 GB RAM | Contabo/Hetzner/DigitalOcean, Ubuntu 22.04/24.04 |
| Docker | installed by `scripts/deploy.sh` if missing |
| Node 22 + pnpm 9 + PM2 | installed by `scripts/deploy.sh` |
| Open ports | `22` (SSH). `3000` only if you skip the reverse proxy |

## 2. Data layer

`docker-compose.yml` starts the infra pair; `docker-compose.prod.yml` is the Phase-4
full-service-isolation layout (10 containers incl. TimescaleDB).

```bash
cd /opt/luxy/Luxy-AI
docker compose up -d          # postgres:16 + redis:7 (infra only)
pnpm db:migrate               # creates all tables + TimescaleDB hypertable
```

Redis runs with `noeviction` + `appendonly yes` — queue jobs are never silently dropped.

## 3. Deploy the app

```bash
ENV_FILE=/opt/luxy/.env bash scripts/deploy.sh
pm2 startup && pm2 save       # auto-restart on reboot (once)
```

`deploy.sh` is idempotent: re-running pulls the branch, rebuilds, migrates and reloads PM2.
Processes (BLUEPRINT §5.1): `luxy-screener`, `luxy-executor`, `luxy-agent`, `luxy-perps`,
`luxy-lp`, `luxy-narrative`, `luxy-polymarket`, `luxy-candles`, `luxy-telegram`, `luxy-web`.

Verify:

```bash
npx tsx scripts/healthcheck.ts   # postgres, redis, external APIs, mode banner
pm2 logs --lines 20              # every process alive
curl -s localhost:3000/api/dashboard | head
```

## 4. Configure (dry-run first)

Fill `/opt/luxy/.env` (see `.env.example` inline comments). Minimum for a useful dry-run:

```ini
DRY_RUN=true
LUXY_LLM_PROVIDER=anthropic        # or openai / openrouter / local (vLLM, OpenAI-compatible)
LUXY_LLM_API_KEY=sk-...
SUBAGENT_LLM_PROVIDER=openrouter
SUBAGENT_LLM_API_KEY=sk-or-...
TELEGRAM_BOT_TOKEN=<from @BotFather>
TELEGRAM_CHAT_ID=<your chat id>
E2B_API_KEY=<optional — without it the local TS analysis twin runs instead>
```

Secrets in production are sops+age encrypted (`docs/SECURITY.md`):
`sops exec-env /opt/luxy/.env.enc 'pm2 start ecosystem.config.cjs --env production'`.

Restart after any env change: `pm2 reload ecosystem.config.cjs --env production`.

## 5. Going live — venue by venue

### 5.0 Global interlocks (BLUEPRINT §1.2 principle 5)

Live execution requires **both**:

1. `DRY_RUN=false`
2. `LIVE_CONFIRM=yes`

Boot with `DRY_RUN=false` but without `LIVE_CONFIRM=yes` **refuses to start** with a loud
banner. Risk guard (3% position / 8% daily drawdown kill switch / 2% slippage / 5 open
positions) stays hardcoded in the executor and cannot be overridden by any LLM output.
Telegram `/pause` or the Redis key `luxy:paused` halts execution instantly at any time.

Run the gate-aware preflight before and after provisioning:

```bash
npx tsx scripts/preflight-live.ts
```

### 5.1 Solana (meme agent — Jupiter v6)

```bash
pnpm bootstrap-wallet --agent=meme --chain=solana   # prints the secret ONCE → store in sops
```

- `SOLANA_PRIVATE_KEY` — base58 secret from the bootstrap output
- Fund the wallet: SOL for fees (~0.5+), USDC for trading
- First swap auto-creates the USDC ATA (`wrapAndUnwrapSol: true`)
- Entries: Jupiter quoted swap, signed locally, submitted + confirmed on-chain
- Exits: reverse swap of the recorded entry output; positions lacking the recorded
  output fail loud instead of guessing

### 5.2 Hyperliquid (perps agent)

- `HYPERLIQUID_PRIVATE_KEY` — EVM key of the trader wallet
- `HYPERLIQUID_WALLET_ADDRESS` — must be the address that key derives (preflight checks)
- Deposit USDC on hyperliquid.xyz with that address (perps margin)
- Orders are EIP-712-signed IoC limits priced 2% through the mid; exits are reduce-only
  sized from the exchange position. Signature stack verified against mainnet
  (`scripts/test-hyperliquid-signing.ts`)
- Optional: set leverage once via the UI; default 1x is safest

### 5.3 EVM (Base + Ethereum — Uniswap v3)

- `EVM_EXECUTOR_PRIVATE_KEY` — funded EOA key
- `BASE_SWAP_ROUTER_02` — required for live Base swaps (Ethereum default is the canonical
  SwapRouter02; override via `ETHEREUM_SWAP_ROUTER_02`)
- **Allowances are never opened automatically.** Approve USDC to the router manually
  (preflight prints the exact spender), sized to your own comfort
- Entries: QuoterV2-quoted swap with the 2% slippage cap enforced; exits: reverse swap of
  the recorded entry output

### 5.4 Polymarket (prediction markets)

The CLOB requires the maker to be a **registered Polymarket wallet** (raw EOAs are
rejected with "please use the deposit wallet flow"):

1. Create/log into a Polymarket account; note your proxy/deposit wallet address
2. Export the owner key per Polymarket's documented flow
3. Configure:
   - `POLYMARKET_PRIVATE_KEY` — owner EOA key (must be the address that owns the wallet)
   - `POLYMARKET_FUNDER_ADDRESS` — the proxy / Gnosis safe / deposit wallet address
   - `POLYMARKET_SIGNATURE_TYPE` — `1` (magic-link proxy) / `2` (Gnosis safe, most common)
     / `3` (deposit wallet, EIP-1271 bundle — implemented)
4. L2 credentials self-provision on first live order (`POST /auth/api-key`), or set
   `POLYMARKET_API_KEY` / `POLYMARKET_API_SECRET` / `POLYMARKET_API_PASSPHRASE` from a
   one-time derivation
5. Deposit USDC.e on Polygon into the funder wallet
- Entries: GTC limit at the live midpoint with tick-size + neg-risk exchange resolution;
  exits: SELL of the recorded share count
- `scripts/test-polymarket-live.ts` verifies the full auth + signing stack live (L1 creds,
  L2 HMAC, order v2 signature) with a throwaway key — no funds needed

### 5.5 Robinhood Crypto

- `ROBINHOOD_API_KEY` + `ROBINHOOD_PRIVATE_KEY_B64` (Ed25519, `generateRobinhoodKeypair()`
  prints a pair — register the public key with Robinhood)
- Live **entries** place USD-notional market orders; live **closes** are deliberately not
  automated (USD-notional sells can't close an exact position) — they fail loud with
  instructions until fill quantities are recorded

### 5.6 LP agents

- Solana (Meteora DLMM): enabled by default; EVM LP behind `LP_EVM_ENABLED=true` with a
  gas-cost optimizer gate (`EVM_GAS_COST_CEIL_USD`)
- LP deposits are not auto-provisioned live: provision wallets via bootstrap and follow
  the same funding/allowance discipline as above before enabling rebalances with funds

## 6. Flip to live

```bash
# in /opt/luxy/.env
DRY_RUN=false
LIVE_CONFIRM=yes
```

```bash
pm2 reload ecosystem.config.cjs --env production
npx tsx scripts/preflight-live.ts    # must be fully green now
pm2 logs luxy-executor --lines 50    # first live intents show no [DRY-RUN] tag
```

Rollout discipline: enable **one venue at a time**, minimum sizes, watch a full
entry→exit cycle per venue before widening limits.

## 7. Operations

| Task | Command |
|---|---|
| Pause everything instantly | Telegram `/pause` (or `redis-cli SET luxy:paused 1`) |
| Resume | Telegram `/resume` |
| Tail logs | `pm2 logs` |
| Health | `npx tsx scripts/healthcheck.ts` (cron every 5 min, alert on exit 1) |
| Live preflight | `npx tsx scripts/preflight-live.ts` |
| Live signature self-test | `npx tsx scripts/test-hyperliquid-signing.ts` / `test-polymarket-live.ts` |
| Backtest replay | `pnpm replay` |
| Terminal monitor | `pnpm tui` |
| Emergency stop | `pm2 stop luxy-executor` — nothing new executes; screeners keep collecting |

Rollback: flip `DRY_RUN=true`, `pm2 reload`, then sort out any open live positions manually
per §5 (Hyperliquid/UI, Polymarket UI, wallets).

## 8. Fine-tuning (deferred)

The model provider is OpenAI-compatible: point `LUXY_LLM_PROVIDER=openai` (or
`openrouter`/`local` + `LUXY_LLM_BASE_URL`) at any served model — no code changes.
The SFT dataset pipeline (`pnpm ft:export`) keeps accumulating labeled sessions for a
future custom fine-tune whenever you choose to invest in it.
