import { getOrderForViewer } from '../../features/orders/operations';
import { findOrder, type OrderRecord } from '../../features/orders/records';
import type { GraphQLContext } from '../context';

export type OrderUpdatedPayload = { order: OrderRecord; occurredAt: string };

/**
 * Authorizes, starts listening, and returns a stream that first emits the
 * current order and then the re-read order after every notification. The
 * notification is only a hint; PostgreSQL is always the source.
 *
 * A hand-written iterator instead of an async generator: return() must end
 * a stream that is waiting for the next notification right away, which a
 * suspended generator cannot do.
 */
export async function subscribeToOrder(ctx: GraphQLContext, orderIdInput: string): Promise<AsyncIterableIterator<OrderUpdatedPayload>> {
  const authorized = await getOrderForViewer(ctx.services, ctx.viewer, orderIdInput);
  const subscription = ctx.services.realtime.subscribe(authorized.id);
  try {
    await subscription.ready;
  } catch (error) {
    subscription.signals.close();
    throw error;
  }

  let first = true;
  const done = (): IteratorResult<OrderUpdatedPayload> => ({ value: undefined, done: true });

  const readCurrent = async (): Promise<IteratorResult<OrderUpdatedPayload>> => {
    // A revoked or expired session ends the stream before any more data is read.
    if (ctx.sessionStillValid && !(await ctx.sessionStillValid())) {
      subscription.signals.close();
      return done();
    }
    // New loaders per event: cached rows from the previous event are stale.
    ctx.dataloaders.reset();
    const order = await findOrder(ctx.services.db, authorized.id);
    if (!order) {
      subscription.signals.close();
      return done();
    }
    return { value: { order, occurredAt: ctx.services.clock.now().toISOString() }, done: false };
  };

  const iterator: AsyncIterableIterator<OrderUpdatedPayload> = {
    async next() {
      if (subscription.signals.closed) return done();
      if (first) {
        first = false;
        return readCurrent();
      }
      const signal = await subscription.signals.next();
      if (signal.done) return done();
      return readCurrent();
    },
    async return() {
      subscription.signals.close();
      return done();
    },
    async throw(error?: unknown) {
      subscription.signals.close();
      throw error;
    },
    [Symbol.asyncIterator]() {
      return iterator;
    },
  };
  return iterator;
}
