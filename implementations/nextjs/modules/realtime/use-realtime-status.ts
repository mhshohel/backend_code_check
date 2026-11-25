'use client';

import { createContext, useContext, useSyncExternalStore } from 'react';
import { createRealtimeStatusStore, type RealtimeStatus, type RealtimeStatusStore } from './connection-status';

const fallbackStore = createRealtimeStatusStore();

export const RealtimeStatusContext = createContext<RealtimeStatusStore>(fallbackStore);

export function useRealtimeStatus(): RealtimeStatus {
  const store = useContext(RealtimeStatusContext);
  return useSyncExternalStore(store.subscribe, store.get, () => 'idle');
}
