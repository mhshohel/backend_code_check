import pg from 'pg';
import { backoffDelayMs } from '@ofl/domain';
import type { Logger } from '../observability/logger';
import { ORDER_EVENTS_CHANNEL } from '../features/orders/events';
import { createSignalChannel, type SignalChannel } from './signal-channel';

export type OrderSubscription = {
  /** Resolves once LISTEN is active, so a read after it cannot miss a later change. */
  ready: Promise<void>;
  signals: SignalChannel;
};

export type RealtimeHub = {
  subscribe(orderId: string): OrderSubscription;
  subscriberCount(): number;
  isListening(): boolean;
  close(): Promise<void>;
};

/**
 * One dedicated LISTEN connection per process, opened on the first
 * subscription. Notifications fan out to the subscribers of that order.
 * After a reconnect every subscriber is woken, because notifications sent
 * while the connection was down are lost and the state may have changed.
 */
export function createRealtimeHub(options: { connectionString: string; logger: Logger }): RealtimeHub {
  const subscribers = new Map<string, Set<SignalChannel>>();
  let client: pg.Client | null = null;
  let connecting: Promise<void> | null = null;
  let closed = false;
  let attempt = 0;

  function wakeAll(): void {
    for (const set of subscribers.values()) for (const channel of set) channel.notify();
  }

  async function connect(): Promise<void> {
    while (!closed) {
      const next = new pg.Client({ connectionString: options.connectionString, application_name: 'ofl-realtime' });
      try {
        await next.connect();
        next.on('notification', (message) => {
          if (message.channel !== ORDER_EVENTS_CHANNEL || !message.payload) return;
          for (const channel of subscribers.get(message.payload) ?? []) channel.notify();
        });
        next.on('error', (error) => {
          options.logger.warn({ err: error }, 'realtime connection error');
        });
        next.on('end', () => {
          if (client !== next || closed) return;
          client = null;
          options.logger.warn('realtime connection lost; reconnecting');
          connecting = connect().then(wakeAll);
        });
        await next.query(`LISTEN ${ORDER_EVENTS_CHANNEL}`);
        if (closed) {
          await next.end();
          return;
        }
        client = next;
        attempt = 0;
        return;
      } catch (error) {
        await next.end().catch(() => undefined);
        const waitMs = backoffDelayMs(attempt, { baseMs: 250, maxMs: 10_000 }) + 100;
        attempt += 1;
        options.logger.warn({ err: error, waitMs }, 'realtime connect failed; retrying');
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }
  }

  function ensureListening(): Promise<void> {
    if (client) return Promise.resolve();
    connecting ??= connect().finally(() => {
      connecting = null;
    });
    return connecting;
  }

  return {
    subscribe(orderId) {
      const set = subscribers.get(orderId) ?? new Set<SignalChannel>();
      subscribers.set(orderId, set);
      const signals = createSignalChannel(() => {
        set.delete(signals);
        if (set.size === 0) subscribers.delete(orderId);
      });
      set.add(signals);
      return { ready: ensureListening(), signals };
    },
    subscriberCount: () => [...subscribers.values()].reduce((sum, set) => sum + set.size, 0),
    isListening: () => client !== null,
    async close() {
      closed = true;
      for (const set of [...subscribers.values()]) for (const channel of [...set]) channel.close();
      const current = client;
      client = null;
      if (current) await current.end().catch(() => undefined);
    },
  };
}
