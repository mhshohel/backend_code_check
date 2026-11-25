import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { startNext, type RunningNext } from '../support/next-process';
import { testEnv } from '../support/test-env';
import { resetTestData } from '../support/reset-data';

// Async Server Components cannot be rendered by Jest/RTL, so these tests
// fetch HTML from the production server (`next start`) and assert on it.

const env = testEnv();
let app: RunningNext;

async function page(path: string, cookie?: string): Promise<Response> {
  return fetch(`${app.baseUrl}${path}`, { redirect: 'manual', headers: cookie ? { cookie } : {} });
}

/** HTML without React's `<!-- -->` text separators, so assertions can match visible text. */
async function html(response: Response): Promise<string> {
  return (await response.text()).replaceAll('<!-- -->', '');
}

async function signIn(email: string, password: string): Promise<string> {
  const response = await fetch(`${app.baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-ofl-csrf': '1' },
    body: JSON.stringify({ email, password }),
  });
  expect(response.status).toBe(200);
  return (response.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
}

function firstProductPath(html: string): string {
  const match = /href="(\/products\/[^"]+)"/.exec(html);
  if (!match?.[1]) throw new Error('no product link in catalog HTML');
  return match[1];
}

beforeAll(async () => {
  await resetTestData(env);
  app = await startNext(env);
}, 180_000);

afterAll(async () => {
  await app?.stop();
});

describe('server-rendered catalog', () => {
  it('renders search results, facets, and security headers', async () => {
    const response = await page('/');
    expect(response.status).toBe(200);
    const body = await html(response);
    expect(body).toContain('<h1>Catalog</h1>');
    expect(body).toMatch(/\d+ products?/);
    expect(body).toContain('<legend>Category</legend>');
    expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-powered-by')).toBeNull();
  });

  it('applies URL filters on the server', async () => {
    const body = await html(await page('/?stock=in_stock&sort=PRICE_ASC'));
    expect(body).toMatch(/<option value="PRICE_ASC" selected=""/);
    expect(body).toMatch(/name="stock" checked=""/);
  });

  it('renders product detail with per-warehouse stock from PostgreSQL', async () => {
    const path = firstProductPath(await html(await page('/')));
    const response = await page(path);
    expect(response.status).toBe(200);
    const body = await html(response);
    expect(body).toContain('Availability by warehouse');
    expect(body).toMatch(/WH-EAST|East/);
  });

  it('returns 404 for an unknown product', async () => {
    const response = await page('/products/does-not-exist');
    expect(response.status).toBe(404);
    expect(await response.text()).toContain('Product not found');
  });
});

describe('user-specific pages', () => {
  it('redirects anonymous visitors to login with a return path', async () => {
    const response = await page('/orders');
    expect([303, 307]).toContain(response.status);
    expect(response.headers.get('location')).toContain('/login?next=%2Forders');
  });

  it('renders the signed-in customer’s orders and is never cacheable', async () => {
    const cookie = await signIn('customer@example.com', 'customer-pass-1');
    const response = await page('/orders', cookie);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('<h1>My orders</h1>');
    const cacheControl = response.headers.get('cache-control') ?? '';
    expect(cacheControl).toContain('no-store');
    expect(cacheControl).toContain('private');
  });

  it('shows the forbidden page to customers on staff dashboards', async () => {
    const cookie = await signIn('customer@example.com', 'customer-pass-1');
    const response = await page('/admin', cookie);
    expect(response.status).toBe(403);
    expect(await response.text()).toContain('Access denied');
  });

  it('renders the warehouse dashboard for operators and the operations dashboard for admins', async () => {
    const operator = await signIn('operator@example.com', 'operator-pass-1');
    const warehouse = await page('/warehouse/inventory', operator);
    expect(warehouse.status).toBe(200);
    expect(await warehouse.text()).toContain('<h1>Inventory</h1>');
    expect((await page('/admin', operator)).status).toBe(403);

    const admin = await signIn('admin@example.com', 'admin-pass-1');
    const operations = await page('/admin', admin);
    expect(operations.status).toBe(200);
    const body = await html(operations);
    expect(body).toContain('Orders by status');
    expect(body).toContain('Daily revenue');
  });

  it('renders the customer’s own order with the live view after a checkout over /api/graphql', async () => {
    const cookie = await signIn('customer@example.com', 'customer-pass-1');
    const gql = async (query: string, variables: Record<string, unknown>) => {
      const response = await fetch(`${app.baseUrl}/api/graphql`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-ofl-csrf': '1', cookie },
        body: JSON.stringify({ query, variables }),
      });
      return (await response.json()) as { data: Record<string, unknown> };
    };
    const slug = firstProductPath(await html(await page('/'))).replace('/products/', '');
    const product = await gql('query($s:String!){product(slug:$s){skus{id availableQuantity price{amountMinor}}}}', { s: decodeURIComponent(slug) });
    const skus = (product.data.product as { skus: Array<{ id: string; availableQuantity: number; price: { amountMinor: number } }> }).skus;
    const sku = skus.find((candidate) => candidate.availableQuantity > 0);
    if (!sku) throw new Error('fixture product has no stock');
    const checkout = await gql('mutation($i:CheckoutInput!){checkout(input:$i){__typename ... on CheckoutSucceeded{order{id number}}}}', {
      i: { idempotencyKey: crypto.randomUUID(), paymentToken: 'tok_approve', lines: [{ skuId: sku.id, quantity: 1, expectedUnitPriceMinor: sku.price.amountMinor }] },
    });
    const order = (checkout.data.checkout as { order: { id: string; number: string } }).order;

    const response = await page(`/orders/${order.id}`, cookie);
    expect(response.status).toBe(200);
    const body = await html(response);
    expect(body).toContain(`Order ${order.number}`);
    expect(body).toContain('Pending payment');
    expect(body).toContain('Cancel order');

    const other = await signIn('customer2@example.com', 'customer-pass-2');
    expect((await page(`/orders/${order.id}`, other)).status).toBe(404);
  });

  it('hides another customer’s order as not found', async () => {
    const cookie = await signIn('customer2@example.com', 'customer-pass-2');
    const response = await page('/orders/00000000-0000-4000-8000-000000000000', cookie);
    expect(response.status).toBe(404);
  });
});
