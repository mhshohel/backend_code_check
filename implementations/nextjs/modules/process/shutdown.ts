const SHUTDOWN_TIMEOUT_MS = 15_000;

/**
 * Runs `shutdown` once on SIGTERM/SIGINT, then exits. A second signal or a
 * stuck shutdown forces exit so orchestrators never wait forever.
 */
export function onShutdownSignal(shutdown: () => Promise<void>): void {
  let stopping = false;
  const handle = (signal: NodeJS.Signals): void => {
    if (stopping) {
      process.exit(1);
    }
    stopping = true;
    console.warn(`received ${signal}, shutting down`);
    const timer = setTimeout(() => {
      console.error('shutdown timed out');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    timer.unref();
    shutdown()
      .then(() => process.exit(0))
      .catch((error: unknown) => {
        console.error('shutdown failed', error);
        process.exit(1);
      });
  };
  process.on('SIGTERM', handle);
  process.on('SIGINT', handle);
}
