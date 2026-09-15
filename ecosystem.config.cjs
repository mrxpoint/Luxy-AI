/**
 * Luxy AI — PM2 process configuration.
 *
 * Matches BLUEPRINT.md §5.1 / §13.1: one process per role, memory-capped,
 * with the Next.js web UI running in cluster mode.
 *
 * Usage:
 *   pm2 start ecosystem.config.cjs --env production
 *   pm2 save && pm2 startup
 */
module.exports = {
  apps: [
    {
      name: 'luxy-screener',
      script: 'tsx',
      args: 'src/screener/index.ts',
      max_memory_restart: '512M',
      env: { NODE_ENV: 'production' },
      time: true,
    },
    {
      name: 'luxy-executor',
      script: 'tsx',
      args: 'src/executor/index.ts',
      max_memory_restart: '256M',
      env: { NODE_ENV: 'production' },
      time: true,
    },
    {
      name: 'luxy-agent',
      script: 'tsx',
      args: 'src/agents/luxy/index.ts',
      max_memory_restart: '512M',
      env: { NODE_ENV: 'production' },
      time: true,
    },
    {
      name: 'luxy-perps',
      script: 'tsx',
      args: 'src/agents/perps/index.ts',
      max_memory_restart: '256M',
      env: { NODE_ENV: 'production' },
      time: true,
    },
    {
      name: 'luxy-lp',
      script: 'tsx',
      args: 'src/agents/lp/index.ts',
      max_memory_restart: '512M',
      env: { NODE_ENV: 'production' },
      time: true,
    },
    {
      name: 'luxy-narrative',
      script: 'tsx',
      args: 'src/agents/narrative/index.ts',
      max_memory_restart: '256M',
      env: { NODE_ENV: 'production' },
      time: true,
    },
    {
      name: 'luxy-polymarket',
      script: 'tsx',
      args: 'src/agents/polymarket/index.ts',
      max_memory_restart: '256M',
      env: { NODE_ENV: 'production' },
      time: true,
    },
    {
      name: 'luxy-candles',
      script: 'tsx',
      args: 'src/market/ingest.ts',
      max_memory_restart: '256M',
      env: { NODE_ENV: 'production' },
      time: true,
    },
    {
      name: 'luxy-telegram',
      script: 'tsx',
      args: 'src/telegram/index.ts',
      max_memory_restart: '128M',
      env: { NODE_ENV: 'production' },
      time: true,
    },
    {
      name: 'luxy-web',
      cwd: './apps/web',
      script: 'node_modules/next/dist/bin/next',
      args: 'start',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '512M',
      env: { NODE_ENV: 'production', PORT: 3000 },
      time: true,
    },
  ],
};
