// Tiny external store for the WebSocket connection state, read with
// useSyncExternalStore. It is UI state about the transport, not server data.

export type RealtimeStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting';

type Listener = () => void;

export type RealtimeStatusStore = {
  get(): RealtimeStatus;
  set(status: RealtimeStatus): void;
  subscribe(listener: Listener): () => void;
};

export function createRealtimeStatusStore(initial: RealtimeStatus = 'idle'): RealtimeStatusStore {
  let status = initial;
  const listeners = new Set<Listener>();
  return {
    get: () => status,
    set(next) {
      if (next === status) return;
      status = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
