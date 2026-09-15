#!/usr/bin/env bash
# =============================================================================
# Luxy AI — VPS deploy bootstrap (Ubuntu 22.04/24.04, BLUEPRINT.md §13.1)
#
# Installs system deps + Node 22 + pnpm + PM2, clones/updates the repo,
# migrates the database, builds the web UI and starts every process.
#
#   1. Provision a VPS (Contabo/Hetzner/DO, 2-4 GB RAM) and SSH in as root.
#   2. apt-get update && apt-get install -y curl git
#   3. bash scripts/deploy.sh            # first run: installs everything
#   4. bash scripts/deploy.sh            # re-runs are idempotent updates
#
# Prerequisites you must fill in before step 3:
#   - Postgres 16 + Redis 7 running (docker compose up -d on the VPS,
#     or native packages — see docs/DEPLOY.md §2)
#   - /opt/luxy/.env populated from .env.example (secrets via sops — §5)
# =============================================================================
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/mrxpoint/Luxy-AI.git}"
REPO_DIR="${REPO_DIR:-/opt/luxy/Luxy-AI}"
BRANCH="${BRANCH:-feat/initial-implementation}"
ENV_FILE="${ENV_FILE:-/opt/luxy/.env}"

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

# --- 1. system deps ----------------------------------------------------------
log "installing system dependencies"
apt-get update -qq
apt-get install -y -qq curl git ca-certificates >/dev/null

if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'parseInt(process.versions.node)')" -lt 22 ]; then
  log "installing Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi

if ! command -v pnpm >/dev/null 2>&1; then
  log "installing pnpm"
  npm install -g pnpm@9 >/dev/null
fi

if ! command -v pm2 >/dev/null 2>&1; then
  log "installing pm2"
  npm install -g pm2 >/dev/null
fi

# --- 2. infrastructure (postgres + redis via docker compose) -----------------
if ! command -v docker >/dev/null 2>&1; then
  log "installing docker (for Postgres 16 + Redis 7 + TimescaleDB)"
  curl -fsSL https://get.docker.com | sh >/dev/null 2>&1
fi
if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -q luxy-db; then
  log "starting Postgres + Redis (docker compose, infra only)"
  cd "$REPO_DIR"
  docker compose up -d db cache 2>/dev/null || docker compose up -d postgres redis 2>/dev/null || \
    echo "  !! start your Postgres/Redis manually — see docs/DEPLOY.md §2"
fi

# --- 3. code ------------------------------------------------------------------
if [ -d "$REPO_DIR/.git" ]; then
  log "updating repository at $REPO_DIR"
  cd "$REPO_DIR"
  git fetch origin "$BRANCH"
  git checkout "$BRANCH"
  git reset --hard "origin/$BRANCH"
else
  log "cloning $REPO_URL ($BRANCH) → $REPO_DIR"
  mkdir -p "$(dirname "$REPO_DIR")"
  git clone --branch "$BRANCH" "$REPO_URL" "$REPO_DIR"
  cd "$REPO_DIR"
fi

# --- 4. env --------------------------------------------------------------------
log "linking env file $ENV_FILE"
ln -sf "$ENV_FILE" "$REPO_DIR/.env"
if [ ! -f "$ENV_FILE" ]; then
  cp "$REPO_DIR/.env.example" "$ENV_FILE"
  echo "  !! $ENV_FILE created from template — FILL IN SECRETS (LLM keys, wallet keys), then re-run"
fi

# --- 5. build + migrate ---------------------------------------------------------
log "installing dependencies"
pnpm install --frozen-lockfile

log "running database migrations"
pnpm db:migrate

log "building core + web"
pnpm build
pnpm build:web

# --- 6. processes ----------------------------------------------------------------
log "starting PM2 processes"
cd "$REPO_DIR"
pm2 start ecosystem.config.cjs --env production || pm2 reload ecosystem.config.cjs --env production
pm2 save

log "verifying health"
sleep 4
npx tsx scripts/healthcheck.ts || true
pm2 status

cat <<'EOF'

Deploy complete. Next steps:
  pm2 startup        # enable auto-restart on reboot (run once, follow output)
  pm2 logs           # tail every process
  npx tsx scripts/preflight-live.ts   # before enabling live trading (docs/DEPLOY.md §5)
EOF
