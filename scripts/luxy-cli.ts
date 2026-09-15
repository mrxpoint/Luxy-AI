/**
 * Luxy CLI — Freqtrade-style entrypoint (BLUEPRINT.md §13.3).
 *
 *   pnpm luxy <command> [options]
 *
 * Commands: init | start | stop | status | logs | migrate | engine | candles | backtest | healthcheck | preflight
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';

const ROOT = resolve(process.cwd());
const COMPOSE_FILE = 'docker-compose.prod.yml';

function args(): string[] {
  return process.argv.slice(2);
}

function printHelp(): void {
  console.log(`Luxy CLI (BLUEPRINT §13.3)

Usage: pnpm luxy <command> [options]

Commands:
  init                 Interactive first-time setup
  start [--profile engine|engine-torch]
  stop
  status
  logs [-f] [service]
  migrate
  healthcheck
  preflight
  engine               Show engine config
  engine --backend <baseline|lightgbm|xgboost|catboost|pytorch>
  engine --mode <engine_only|engine_plus_llm|llm_only>
  candles --venue <hyperliquid|birdeye> [--symbol X] [--days N]
  backtest --help      (job enqueue — requires running stack)

Examples:
  pnpm luxy init
  pnpm luxy start --profile engine
  pnpm luxy engine --backend baseline --mode engine_plus_llm
`);
}

async function prompt(q: string, def?: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const hint = def != null ? ` [${def}]` : '';
  const answer: string = await new Promise((resolveAns) => {
    rl.question(`${q}${hint}: `, resolveAns);
  });
  rl.close();
  const t = answer.trim();
  return t || def || '';
}

function run(cmd: string, cmdArgs: string[], opts?: { cwd?: string }): Promise<number> {
  return new Promise((resolveCode) => {
    const child = spawn(cmd, cmdArgs, {
      cwd: opts?.cwd ?? ROOT,
      stdio: 'inherit',
      shell: false,
    });
    child.on('close', (code) => resolveCode(code ?? 1));
  });
}

function compose(cmdArgs: string[]): Promise<number> {
  return run('docker', ['compose', '-f', COMPOSE_FILE, ...cmdArgs]);
}

function setEnvKey(key: string, value: string): void {
  const envPath = resolve(ROOT, '.env');
  let text = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
  const re = new RegExp(`^${key}=.*$`, 'm');
  if (re.test(text)) text = text.replace(re, `${key}=${value}`);
  else text = `${text.trimEnd()}\n${key}=${value}\n`;
  writeFileSync(envPath, text, 'utf8');
  console.log(`  set ${key}=${value}`);
}

async function cmdInit(): Promise<void> {
  console.log('Luxy setup\n──────────');
  if (!existsSync(resolve(ROOT, '.env')) && existsSync(resolve(ROOT, '.env.example'))) {
    copyFileSync(resolve(ROOT, '.env.example'), resolve(ROOT, '.env'));
    console.log('Created .env from .env.example');
  }

  const deploy = await prompt('Deploy mode? (1) Docker full  (2) PM2', '1');
  const engine = await prompt(
    'Enable LuxyEngine? (1) Yes baseline/tree  (2) Yes+PyTorch note  (3) No',
    '1',
  );
  const pullData = await prompt('Download historical data now? (1) Yes  (2) Later', '2');

  if (engine === '1' || engine === '2') {
    setEnvKey('LUXY_ENGINE_ENABLED', 'true');
    setEnvKey('LUXY_ENGINE_BACKEND', 'baseline');
    setEnvKey('LUXY_ENGINE_MODE', 'engine_plus_llm');
  } else {
    setEnvKey('LUXY_ENGINE_ENABLED', 'false');
  }
  setEnvKey('DRY_RUN', 'true');

  if (deploy === '1') {
    console.log('\nBuilding & starting Docker stack…');
    const profiles =
      engine === '1' || engine === '2' ? ['--profile', 'engine'] : [];
    await compose(['up', '-d', '--build', ...profiles]);
    console.log('Running migrate…');
    await compose(['exec', '-T', 'luxy-agent', 'node', 'dist/scripts/migrate.js']);
  } else {
    console.log('PM2 path: start infra with `docker compose up -d` then `pnpm deploy` / ecosystem.');
  }

  if (pullData === '1') {
    console.log('Candle warm-up: use `pnpm luxy candles --venue hyperliquid --symbol BTC --days 30` once stack is healthy.');
  }
  console.log('\nDone. Next: pnpm luxy status');
}

async function cmdEngine(rest: string[]): Promise<void> {
  const backendIdx = rest.indexOf('--backend');
  const modeIdx = rest.indexOf('--mode');
  if (backendIdx >= 0 && rest[backendIdx + 1]) {
    setEnvKey('LUXY_ENGINE_BACKEND', rest[backendIdx + 1]!);
    setEnvKey('LUXY_ENGINE_ENABLED', 'true');
  }
  if (modeIdx >= 0 && rest[modeIdx + 1]) {
    setEnvKey('LUXY_ENGINE_MODE', rest[modeIdx + 1]!);
  }
  // Show current
  const envPath = resolve(ROOT, '.env');
  const text = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
  const get = (k: string, d: string) => {
    const m = text.match(new RegExp(`^${k}=(.*)$`, 'm'));
    return m?.[1]?.trim() || process.env[k] || d;
  };
  console.log('LuxyEngine config:');
  console.log(`  ENABLED=${get('LUXY_ENGINE_ENABLED', 'false')}`);
  console.log(`  BACKEND=${get('LUXY_ENGINE_BACKEND', 'baseline')}`);
  console.log(`  MODE=${get('LUXY_ENGINE_MODE', 'engine_plus_llm')}`);
  console.log(`  MODEL_VERSION=${get('LUXY_ENGINE_MODEL_VERSION', 'latest')}`);
  console.log('Restart luxy-agent (and luxy-engine when available) to apply.');
}

async function cmdCandles(rest: string[]): Promise<void> {
  const venue = flag(rest, '--venue') ?? 'hyperliquid';
  const symbol = flag(rest, '--symbol') ?? 'BTC';
  const days = flag(rest, '--days') ?? '30';
  console.log(
    `Candle fetch requested: venue=${venue} symbol=${symbol} days=${days}\n` +
      `Ingest service uses Hyperliquid/Birdeye APIs via candle-ingest.\n` +
      `Full interactive pull is wired through the running stack + Timescale cache (BLUEPRINT §9.5).\n` +
      `Ensure candle-ingest is up: docker compose -f ${COMPOSE_FILE} logs -f candle-ingest`,
  );
}

async function cmdBacktest(rest: string[]): Promise<void> {
  console.log(
    `Backtest job (BLUEPRINT §10.4)\n` +
      `Flags: ${rest.join(' ') || '(none)'}\n` +
      `Enqueue path uses BullMQ "backtest" queue when worker is deployed.\n` +
      `In-session E2B/local backtest already runs inside luxy-agent on each signal.`,
  );
}

function flag(rest: string[], name: string): string | undefined {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : undefined;
}

async function main(): Promise<void> {
  const a = args();
  const cmd = a[0];
  if (!cmd || cmd === '-h' || cmd === '--help') {
    printHelp();
    return;
  }
  const rest = a.slice(1);

  switch (cmd) {
    case 'init':
      await cmdInit();
      break;
    case 'start': {
      const p = flag(rest, '--profile');
      const extra = p ? ['--profile', p] : [];
      process.exit(await compose(['up', '-d', '--build', ...extra]));
      break;
    }
    case 'stop':
      process.exit(await compose(['stop']));
      break;
    case 'status':
      process.exit(await compose(['ps']));
      break;
    case 'logs': {
      const follow = rest.includes('-f') || rest.includes('--follow');
      const svc = rest.find((x) => !x.startsWith('-'));
      const la = follow ? ['-f'] : [];
      process.exit(await compose(['logs', '--tail=100', ...la, ...(svc ? [svc] : [])]));
      break;
    }
    case 'migrate':
      process.exit(
        await compose(['exec', '-T', 'luxy-agent', 'node', 'dist/scripts/migrate.js']),
      );
      break;
    case 'healthcheck':
      process.exit(
        await compose(['exec', '-T', 'luxy-agent', 'node', 'dist/scripts/healthcheck.js']),
      );
      break;
    case 'preflight':
      process.exit(
        await compose(['exec', '-T', 'luxy-agent', 'node', 'dist/scripts/preflight-live.js']),
      );
      break;
    case 'engine':
      await cmdEngine(rest);
      break;
    case 'candles':
      await cmdCandles(rest);
      break;
    case 'backtest':
      await cmdBacktest(rest);
      break;
    default:
      console.error(`Unknown command: ${cmd}`);
      printHelp();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
