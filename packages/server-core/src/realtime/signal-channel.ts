/**
 * A coalescing signal: any number of notify() calls between two reads
 * become one wake-up. Subscribers re-read the current state from
 * PostgreSQL, so a burst of notifications needs only one re-read.
 */
export type SignalChannel = AsyncIterableIterator<void> & {
  notify(): void;
  close(): void;
  readonly closed: boolean;
};

export function createSignalChannel(onClose: () => void = () => undefined): SignalChannel {
  let pending = false;
  let closed = false;
  let wake: ((result: IteratorResult<void>) => void) | null = null;

  const finish = () => {
    if (closed) return;
    closed = true;
    onClose();
    wake?.({ value: undefined, done: true });
    wake = null;
  };

  const channel: SignalChannel = {
    get closed() {
      return closed;
    },
    notify() {
      if (closed) return;
      if (wake) {
        const resolve = wake;
        wake = null;
        resolve({ value: undefined, done: false });
      } else {
        pending = true;
      }
    },
    close: finish,
    next() {
      if (closed) return Promise.resolve({ value: undefined, done: true });
      if (pending) {
        pending = false;
        return Promise.resolve({ value: undefined, done: false });
      }
      return new Promise((resolve) => {
        wake = resolve;
      });
    },
    return() {
      finish();
      return Promise.resolve({ value: undefined, done: true });
    },
    [Symbol.asyncIterator]() {
      return channel;
    },
  };
  return channel;
}
