export type WaitForOptions = { timeoutMs?: number; intervalMs?: number; description?: string };

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_INTERVAL_MS = 50;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Bounded polling. Resolves with the first value that is not null, undefined,
 * or false. Rejects after the timeout with the last error the probe threw.
 */
export async function waitFor<T>(
  probe: () => Promise<T | null | undefined | false> | T | null | undefined | false,
  options: WaitForOptions = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  for (;;) {
    try {
      const value = await probe();
      if (value !== null && value !== undefined && value !== false) return value;
    } catch (error) {
      lastError = error;
    }
    if (Date.now() >= deadline) {
      const what = options.description ?? 'condition';
      const reason = lastError instanceof Error ? `: ${lastError.message}` : '';
      throw new Error(`waitFor timed out after ${timeoutMs} ms waiting for ${what}${reason}`);
    }
    await delay(intervalMs);
  }
}
