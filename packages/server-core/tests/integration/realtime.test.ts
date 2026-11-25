import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { parse, subscribe, type ExecutionResult } from 'graphql';
import { createClient } from 'graphql-ws';
import { useServer } from 'graphql-ws/use/ws';
import WebSocket, { WebSocketServer } from 'ws';
import { OrderUpdatedDocument } from '@ofl/graphql-types';
import { print } from 'graphql';
import { logout, resolveSession, type SessionUser } from '../../src/features/auth/sessions';
import { shipOrder } from '../../src/features/fulfillment/operations';
import { recordPaymentNotification } from '../../src/features/payments/notifications';
import { createGraphQLContext } from '../../src/graphql/context';
import { buildGraphQLSchema } from '../../src/graphql/schema';
import { graphqlWsServerOptions } from '../../src/graphql/ws';
import type { Services } from '../../src/services';
import { closeServices, createSku, meta, resetData, startServices, tokenFor, WAREHOUSE_EAST, type BaseData } from '../helpers/harness';
import { placeOrder, type PlacedOrder } from '../helpers/orders';

let instance1: Services;
let instance2: Services;
let base: BaseData;

beforeAll(async () => {
  instance1 = await startServices();
  instance2 = await startServices();
});
afterAll(async () => {
  await closeServices(instance1);
  await closeServices(instance2);
});
beforeEach(async () => {
  base = await resetData(instance1);
});

const SUBSCRIPTION = parse('subscription ($id: ID!) { orderUpdated(orderId: $id) { occurredAt order { id status } } }');

async function subscribeAs(services: Services, viewer: SessionUser | null, orderId: string) {
  const result = await subscribe({
    schema: buildGraphQLSchema(services),
    document: SUBSCRIPTION,
    variableValues: { id: orderId },
    contextValue: createGraphQLContext(services, viewer, meta()),
  });
  return result;
}

type Event = ExecutionResult<{ orderUpdated: { order: { id: string; status: string } } }>;

async function nextStatus(iterator: AsyncIterator<ExecutionResult>): Promise<string | undefined> {
  const next = await iterator.next();
  return (next.value as Event | undefined)?.data?.orderUpdated.order.status;
}

function isIterator(value: unknown): value is AsyncGenerator<ExecutionResult> {
  return typeof value === 'object' && value !== null && Symbol.asyncIterator in value;
}

async function confirmedOrder(): Promise<PlacedOrder> {
  const sku = await createSku(instance1, base, { east: 5 });
  return placeOrder(instance1, base.customer, [{ sku, quantity: 1 }]);
}

describe('orderUpdated subscription', () => {
  it('S14: emits the current order, then changes made through another instance; reconnect shows the latest state', async () => {
    const order = await confirmedOrder();
    const stream = await subscribeAs(instance1, base.customer, order.orderId);
    if (!isIterator(stream)) throw new Error(JSON.stringify(stream));
    expect(await nextStatus(stream)).toBe('PENDING_PAYMENT');

    await recordPaymentNotification(
      instance2,
      { providerEventId: 'evt_rt_1', paymentId: order.paymentId, kind: 'PAYMENT_SUCCEEDED', amountMinor: order.amountMinor },
      meta(),
    );
    expect(await nextStatus(stream)).toBe('CONFIRMED');
    await stream.return(undefined);
    expect(instance1.realtime.subscriberCount()).toBe(0);

    await shipOrder(instance2, base.operator, { orderId: order.orderId, warehouseId: WAREHOUSE_EAST }, meta());
    const again = await subscribeAs(instance1, base.customer, order.orderId);
    if (!isIterator(again)) throw new Error('expected a stream');
    expect(await nextStatus(again)).toBe('SHIPPED');
    await again.return(undefined);
  });

  it('S11: another customer gets NOT_FOUND; anonymous gets UNAUTHENTICATED', async () => {
    const order = await confirmedOrder();
    const other = await subscribeAs(instance1, base.customer2, order.orderId);
    expect(isIterator(other)).toBe(false);
    expect((other as ExecutionResult).errors?.[0]?.originalError).toMatchObject({ code: 'NOT_FOUND' });
    const anonymous = await subscribeAs(instance1, null, order.orderId);
    expect((anonymous as ExecutionResult).errors?.[0]?.originalError).toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(instance1.realtime.subscriberCount()).toBe(0);
  });

  it('ends a waiting stream immediately on return()', async () => {
    const order = await confirmedOrder();
    const stream = await subscribeAs(instance1, base.operator, order.orderId);
    if (!isIterator(stream)) throw new Error('expected a stream');
    await stream.next();
    const pending = stream.next();
    await stream.return(undefined);
    expect((await pending).done).toBe(true);
  });
});

describe('graphql-ws transport', () => {
  let server: Server;
  let url: string;
  let dispose: () => Promise<void>;

  beforeAll(async () => {
    server = createServer();
    const wss = new WebSocketServer({ server, path: '/graphql' });
    const schema = buildGraphQLSchema(instance1);
    const disposable = useServer(
      graphqlWsServerOptions(instance1, schema, async (request) => {
        const token = /ofl_session=([^;]+)/.exec(request.headers.cookie ?? '')?.[1];
        return resolveSession(instance1, token);
      }),
      wss,
    );
    dispose = async () => {
      await disposable.dispose();
    };
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/graphql`;
  });
  afterAll(async () => {
    await dispose();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  function client(token: string | null) {
    return createClient({
      url,
      webSocketImpl: class extends WebSocket {
        constructor(address: string, protocols?: string | string[]) {
          super(address, protocols, token ? { headers: { cookie: `ofl_session=${token}` } } : {});
        }
      },
      retryAttempts: 0,
    });
  }

  it('authenticates the connection from the cookie and authorizes each subscription', async () => {
    const order = await confirmedOrder();
    const owner = client(await tokenFor(instance1, base.customer));
    const statuses: string[] = [];
    const done = new Promise<void>((resolve, reject) => {
      const unsubscribe = owner.subscribe<{ orderUpdated: { order: { status: string } } }>(
        { query: print(OrderUpdatedDocument), variables: { orderId: order.orderId } },
        {
          next: (value) => {
            const status = value.data?.orderUpdated.order.status;
            if (status) statuses.push(status);
            if (status === 'PENDING_PAYMENT') {
              void recordPaymentNotification(
                instance2,
                { providerEventId: 'evt_ws_1', paymentId: order.paymentId, kind: 'PAYMENT_SUCCEEDED', amountMinor: order.amountMinor },
                meta(),
              );
            }
            if (status === 'CONFIRMED') {
              unsubscribe();
              resolve();
            }
          },
          error: reject,
          complete: () => undefined,
        },
      );
    });
    await done;
    expect(statuses).toEqual(['PENDING_PAYMENT', 'CONFIRMED']);
    await owner.dispose();

    const stranger = client(await tokenFor(instance1, base.customer2));
    // A subscription that fails authorization yields one result with errors, then completes.
    const rejected = await new Promise<unknown>((resolve) => {
      stranger.subscribe({ query: print(OrderUpdatedDocument), variables: { orderId: order.orderId } }, { next: resolve, error: resolve, complete: () => resolve(null) });
    });
    expect(rejected).toMatchObject({ errors: [{ extensions: { code: 'NOT_FOUND' } }] });
    expect(JSON.stringify(rejected)).not.toContain(order.paymentId);
    await stranger.dispose();
  });

  it('F3: serves subscriptions only and ends live updates when the session is revoked', async () => {
    const order = await confirmedOrder();
    const token = await tokenFor(instance1, base.customer);
    const ws = client(token);

    const firstResult = (query: string, variables: Record<string, unknown>) =>
      new Promise<unknown>((resolve) => {
        ws.subscribe({ query, variables }, { next: resolve, error: resolve, complete: () => resolve('complete') });
      });
    const queryOverWs = await firstResult('{ viewer { id } }', {});
    expect(JSON.stringify(queryOverWs)).toContain('Only subscriptions');
    const mutationOverWs = await firstResult(`mutation { cancelOrder(orderId: "${order.orderId}") { __typename } }`, {});
    expect(JSON.stringify(mutationOverWs)).toContain('Only subscriptions');

    const statuses: string[] = [];
    const ended = new Promise<void>((resolve, reject) => {
      ws.subscribe<{ orderUpdated: { order: { status: string } } }>(
        { query: print(OrderUpdatedDocument), variables: { orderId: order.orderId } },
        {
          next: (value) => {
            const status = value.data?.orderUpdated.order.status;
            if (!status) return;
            statuses.push(status);
            if (status === 'PENDING_PAYMENT') {
              // Log out, then change the order: the open subscription must not deliver it.
              void logout(instance1, token).then(() =>
                recordPaymentNotification(
                  instance2,
                  { providerEventId: 'evt_ws_logout', paymentId: order.paymentId, kind: 'PAYMENT_SUCCEEDED', amountMinor: order.amountMinor },
                  meta(),
                ),
              );
            }
          },
          error: reject,
          complete: resolve,
        },
      );
    });
    await ended;
    expect(statuses).toEqual(['PENDING_PAYMENT']);

    // A new subscription on the same socket is now anonymous.
    const afterLogout = await firstResult(print(OrderUpdatedDocument), { orderId: order.orderId });
    expect(afterLogout).toMatchObject({ errors: [{ extensions: { code: 'UNAUTHENTICATED' } }] });
    await ws.dispose();
  });
});
