import { randomUUID } from 'node:crypto';
import {
  closeServices,
  createServices,
  login,
  reconcileLedger,
  runWorkerUntilIdle,
  type Services,
  type SessionUser,
  type WorkerFaults,
} from '@ofl/server-core';
import { CheckoutDocument, type CheckoutMutation, type CheckoutInput } from '@ofl/graphql-types';
import { resetToFixture } from '@ofl/test-fixtures';
import type { AcceptanceTarget } from '../target';
import { ScenarioDatabase, type SkuRef, type WarehouseIds } from './database';
import { GraphQLHttpClient, sessionCookieForToken, type HttpEndpoints } from './graphql-http';
import { postWebhook, type WebhookResponse } from './webhook';

export const DEMO_ACCOUNTS = {
  customer: { email: 'customer@example.com', password: 'customer-pass-1' },
  customer2: { email: 'customer2@example.com', password: 'customer-pass-2' },
  operator: { email: 'operator@example.com', password: 'operator-pass-1' },
  admin: { email: 'admin@example.com', password: 'admin-pass-1' },
} as const;

type DemoRole = keyof typeof DEMO_ACCOUNTS;
export type Account = { email: string; password: string };
export type CartLine = { sku: SkuRef; quantity: number };
export type PaymentToken = 'tok_approve' | 'tok_decline' | 'tok_slow_approve';
export type CheckoutResult = CheckoutMutation['checkout'];

export function checkoutInput(lines: readonly CartLine[], paymentToken: PaymentToken, idempotencyKey = randomUUID()): CheckoutInput {
  return {
    idempotencyKey,
    paymentToken,
    lines: lines.map(({ sku, quantity }) => ({ skuId: sku.id, quantity, expectedUnitPriceMinor: sku.priceMinor })),
  };
}

export const requestMeta = () => ({ correlationId: randomUUID() });

/** Everything a scenario needs. Built once per suite run. */
export class SuiteContext {
  readonly clients: Record<DemoRole, GraphQLHttpClient>;

  private constructor(
    readonly target: AcceptanceTarget,
    readonly services: Services,
    readonly db: ScenarioDatabase,
    readonly warehouses: WarehouseIds,
  ) {
    this.clients = {
      customer: this.client(),
      customer2: this.client(),
      operator: this.client(),
      admin: this.client(),
    };
  }

  static async start(target: AcceptanceTarget): Promise<SuiteContext> {
    await resetToFixture(target.config, 'contract');
    const services = await createServices(target.config, { role: 'cli' });
    const db = new ScenarioDatabase(target.config.databaseUrl);
    const context = new SuiteContext(target, services, db, await db.warehouseIds());
    for (const role of Object.keys(DEMO_ACCOUNTS) as DemoRole[]) {
      const account = DEMO_ACCOUNTS[role];
      await context.clients[role].login(account.email, account.password);
    }
    return context;
  }

  async stop(): Promise<void> {
    await this.db.close();
    await closeServices(this.services);
  }

  get webhookUrl(): string {
    return new URL(this.target.http.webhookPath, this.target.http.baseUrl).toString();
  }

  /** A client without a session, optionally against another instance of the same variant. */
  client(baseUrl = this.target.http.baseUrl): GraphQLHttpClient {
    const endpoints: HttpEndpoints = { ...this.target.http, baseUrl };
    return new GraphQLHttpClient(endpoints);
  }

  /**
   * A signed-in client whose session is created in-process with server-core
   * login(). The session lives in the shared database, so the HTTP API
   * accepts the cookie; this keeps bulk setup below the login rate limit.
   */
  async sessionClient(account: Account): Promise<{ client: GraphQLHttpClient; user: SessionUser }> {
    const result = await login(this.services, account, requestMeta());
    if (result.kind !== 'ok') throw new Error(`in-process login failed for ${account.email}`);
    const endpoints: HttpEndpoints = { ...this.target.http };
    return { client: new GraphQLHttpClient(endpoints, sessionCookieForToken(result.token)), user: result.user };
  }

  createSku(label: string, priceMinor: number, stock: { east?: number; west?: number }): Promise<SkuRef> {
    return this.db.createSku(label, priceMinor, stock, this.warehouses);
  }

  async checkout(client: GraphQLHttpClient, lines: readonly CartLine[], token: PaymentToken = 'tok_approve'): Promise<CheckoutResult> {
    const data = await client.data(CheckoutDocument, { input: checkoutInput(lines, token) });
    return data.checkout;
  }

  /** Checkout that must succeed. Returns the order as the API reported it. */
  async placeOrder(client: GraphQLHttpClient, lines: readonly CartLine[], token: PaymentToken = 'tok_approve') {
    const result = await this.checkout(client, lines, token);
    if (result.__typename !== 'CheckoutSucceeded') {
      throw new Error(`checkout failed: ${JSON.stringify(result)}`);
    }
    return result.order;
  }

  /** Delivers a signed PAYMENT_SUCCEEDED notification for the order's payment. */
  async confirmPayment(orderId: string, baseUrl = this.target.http.baseUrl): Promise<WebhookResponse> {
    const payment = await this.db.payment(orderId);
    const url = new URL(this.target.http.webhookPath, baseUrl).toString();
    return postWebhook(
      url,
      { providerEventId: `evt_acc_${randomUUID()}`, paymentId: payment.id, kind: 'PAYMENT_SUCCEEDED', amountMinor: payment.amountMinor },
      this.target.config.paymentWebhookSecret,
    );
  }

  /** Runs exactly the given jobs with the shared worker engine. */
  runJobs(jobIds: readonly string[], faults?: WorkerFaults, services: Services = this.services): Promise<number> {
    return runWorkerUntilIdle(services, { workerId: `acceptance-${randomUUID()}`, jobIds: [...jobIds], ...(faults ? { faults } : {}) });
  }

  async ledgerDifferences(): Promise<number> {
    const { differences } = await reconcileLedger(this.services);
    return differences.length;
  }
}
