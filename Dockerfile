# Luxy AI — production image (BLUEPRINT.md §13.2, Phase 4)
#
# One image, per-process entrypoints selected via the SERVICE build arg or
# docker-compose `command:` override. Build once:
#   docker compose -f docker-compose.prod.yml build
#
# The web UI image is built from the same source (target web stage) so the
# whole system ships from a single Dockerfile.
FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable
ENV PNPM_HOME=/pnpm PNPM_VERSION=9.15.9
RUN npm i -g pnpm@9.15.9

# ---- dependencies ----
FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ---- runtime (backend services) ----
FROM base AS service
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY src ./src
COPY scripts ./scripts
COPY db ./db
ENV NODE_ENV=production
# Default entrypoint: the executor. Override with `command: tsx src/<path>` per service.
CMD ["pnpm", "dev:executor"]

# ---- web UI ----
FROM base AS web
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web ./apps/web
RUN pnpm --filter @luxy/web build
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
CMD ["pnpm", "start:web"]
