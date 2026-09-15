/**
 * Immutable audit helper (BLUEPRINT.md §7.4).
 *
 * Every action — entry, exit, risk block, strategy change — is recorded with
 * timestamp, actor and full payload. The DB role is provisioned WITHOUT
 * DELETE/TRUNCATE on this table; treat this module as the only write path.
 */
import { query } from './pool.js';
import { logger } from '../utils/logger.js';

const log = logger.child({ module: 'audit' });

export type AuditActor =
  | 'executor'
  | 'luxy'
  | 'risk-guard'
  | 'user'
  | 'screener'
  | 'perps-agent'
  | 'lp-agent'
  | 'narrative-agent'
  | 'polymarket-agent'
  | 'telegram-bot';

export async function audit(actor: AuditActor, action: string, payload: unknown): Promise<void> {
  try {
    await query('INSERT INTO audit_log (actor, action, payload) VALUES ($1, $2, $3)', [
      actor,
      action,
      JSON.stringify(payload ?? null),
    ]);
  } catch (err) {
    // Auditing must never crash the caller — log loudly instead.
    log.error({ err, actor, action }, 'failed to write audit log');
  }
}
