/**
 * LuxySandbox — per-session E2B code execution (BLUEPRINT.md §4.3).
 *
 * The SDK is imported lazily so the rest of the system runs without the
 * package when E2B is not configured (dry-run / local dev).
 */
import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';

const log = logger.child({ module: 'e2b' });

export interface SandboxResult {
  stdout: string;
  stderr: string;
  results: unknown[];
  error?: string;
}

export class LuxySandbox {
  private sandbox: unknown = null;
  private readonly template: string;
  private readonly timeoutMs: number;

  constructor(template = 'luxy-trading', timeoutMs = 30_000) {
    this.template = template;
    this.timeoutMs = timeoutMs;
  }

  get available(): boolean {
    return config.E2B_API_KEY.length > 0;
  }

  async init(): Promise<void> {
    if (!this.available) {
      throw new Error('E2B_API_KEY not configured — use the local backtest fallback instead');
    }
    const mod = (await import('@e2b/code-interpreter')) as unknown as {
      Sandbox: { create(opts: Record<string, unknown>): Promise<unknown> };
    };
    this.sandbox = await mod.Sandbox.create({
      template: this.template,
      apiKey: config.E2B_API_KEY,
      timeoutMs: this.timeoutMs,
    });
    log.debug({ template: this.template }, 'e2b sandbox created');
  }

  async run(code: string): Promise<SandboxResult> {
    if (!this.sandbox) throw new Error('Sandbox not initialized');
    const sandbox = this.sandbox as {
      runCode: (
        code: string,
        opts?: Record<string, unknown>,
      ) => Promise<{
        logs: { stdout: string[]; stderr: string[] };
        results: Array<{ data?: unknown }>;
        error?: { value?: string } | null;
      }>;
    };
    const result = await sandbox.runCode(code, { language: 'python' });
    return {
      stdout: result.logs.stdout.join('\n'),
      stderr: result.logs.stderr.join('\n'),
      results: result.results.map((r) => r.data),
      error: result.error?.value,
    };
  }

  async close(): Promise<void> {
    if (!this.sandbox) return;
    try {
      await (this.sandbox as { kill: () => Promise<void> }).kill();
      log.debug('e2b sandbox closed');
    } catch (err) {
      log.warn({ err }, 'failed to close e2b sandbox cleanly');
    }
    this.sandbox = null;
  }
}
