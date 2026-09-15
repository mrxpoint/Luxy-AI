/**
 * Optional LuxyEngine worker process (Docker profile `engine`).
 * Inference itself runs in-process inside luxy-agent; this worker is reserved
 * for scheduled retrain / model registry maintenance.
 */
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { engineBackend, engineEnabled, engineMode } from './index.js';

const log = logger.child({ module: 'luxy-engine-worker' });

log.info(
  {
    enabled: engineEnabled(),
    backend: engineBackend(),
    mode: engineMode(),
    version: config.LUXY_ENGINE_MODEL_VERSION,
  },
  'luxy-engine worker online (retrain jobs TBD — inference is in luxy-agent)',
);

setInterval(() => {
  log.debug(
    { enabled: engineEnabled(), backend: engineBackend() },
    'engine worker heartbeat',
  );
}, 60_000);

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
