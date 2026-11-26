import type { Logger } from '@ofl/server-core';

/**
 * Runs `shutdown` once on SIGTERM/SIGINT. A second signal, or a shutdown
 * that takes longer than `timeoutMs`, exits immediately.
 */
export function onShutdownSignal(logger: Logger, shutdown: () => Promise<void>, timeoutMs = 15_000): void {
  let started = false;
  const handle = (signal: NodeJS.Signals) => {
    if (started) {
      logger.warn({ signal }, 'second signal, exiting now');
      process.exit(1);
    }
    started = true;
    logger.info({ signal }, 'shutting down');
    setTimeout(() => {
      logger.error('shutdown timed out');
      process.exit(1);
    }, timeoutMs).unref();
    shutdown().then(
      () => process.exit(0),
      (error: unknown) => {
        logger.error({ err: error }, 'shutdown failed');
        process.exit(1);
      },
    );
  };
  process.on('SIGTERM', handle);
  process.on('SIGINT', handle);
}
