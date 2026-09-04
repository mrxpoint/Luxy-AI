# Security & Key Management

Implements BLUEPRINT.md §12 (Security & Key Management).

## 1. Secret encryption — sops + age

Secrets never live in git as plaintext. `.env` holds them locally; only the
encrypted form (`.env.enc`) is committed.

### One-time setup

```bash
# 1. Generate an age keypair (keep the private key on the VPS only)
age-keygen -o ~/.config/sops/age/keys.txt

# 2. Put the public key (age1...) into .sops.yaml creation_rules

# 3. Encrypt — safe to commit the result
sops --encrypt .env > .env.enc
git add .env.enc

# 4. Decrypt at runtime WITHOUT writing plaintext to disk:
export SOPS_AGE_KEY_FILE=~/.config/sops/age/keys.txt
sops exec-env .env.enc 'pm2 start ecosystem.config.cjs --env production'

# Docker Compose equivalent:
sops exec-env .env.enc 'docker compose -f docker-compose.prod.yml up -d'
```

## 2. Wallet provisioning

One wallet per `(chain × agent)` — a compromised agent cannot drain another
agent's funds (§7.2). Bootstrap is manual and refuses to overwrite:

```bash
pnpm bootstrap-wallet --agent=meme --chain=solana
pnpm bootstrap-wallet --agent=lp   --chain=solana
pnpm bootstrap-wallet --agent=meme --chain=base      # EVM (Phase 3)
pnpm bootstrap-wallet --agent=lp   --chain=base
```

- Public address → `wallets` table (safe to display).
- Private key → printed ONCE to the terminal; encrypt via sops immediately.
- The executor never auto-approves ERC-20 allowances: approve the Uniswap
  SwapRouter02 spend manually, sized to a limit you accept.

### Key storage stage ladder (§12.2)

| Stage | Method |
|---|---|
| Development | `.env` (never commit, gitignored) |
| Staging | `sops` + `age` encryption |
| Production | `sops` + `age` + encrypted disk + VPS firewall |
| Future | HSM or Vault |

## 3. Database security

- App DB user holds only `SELECT`, `INSERT`, `UPDATE`.
- `audit_log` has NO `DELETE`/`TRUNCATE` permission for the app role —
  append-only by grant, not by convention.
- No `DROP TABLE` for the runtime role; migrations run under a separate
  elevated role.
- Rotate the DB password monthly via sops-encrypted `.env.enc`.

## 4. Live-execution guardrails

Every execution venue follows the same stance (see `src/executor/`):

1. `DRY_RUN=true` (default) simulates fills end-to-end — no key needed.
2. Live paths fail LOUD when provisioning is incomplete; the system never
   silently degrades from live to simulated or vice versa.
3. The risk guard (`3% size · 8% daily drawdown · 2% slippage · 5 positions`)
   is hardcoded at the executor layer and cannot be overridden by any LLM
   output, strategy proposal, or prompt injection.
