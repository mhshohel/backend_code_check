import type { CartLine, CartState } from '../features/cart/cartSlice';
import type { CheckoutState, PaymentToken } from '../features/checkout/checkoutSlice';

// Only client-owned state is persisted (cart and the open checkout attempt).
// Server data lives in the urql cache and is never written to storage.
export const STORAGE_KEY = 'ofl.spa.v1';

export type PersistedState = { cart: CartState; checkout: CheckoutState };

/** The subset of Storage we use; lets tests pass an in-memory implementation. */
export type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem'>;

const PAYMENT_TOKENS: readonly PaymentToken[] = ['tok_approve', 'tok_decline', 'tok_slow_approve'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCartLine(value: unknown): value is CartLine {
  if (!isRecord(value)) return false;
  const strings = ['skuId', 'productSlug', 'productName', 'skuCode', 'skuLabel'] as const;
  return (
    strings.every((key) => typeof value[key] === 'string') &&
    Number.isSafeInteger(value.unitPriceMinor) &&
    Number.isSafeInteger(value.quantity) &&
    (value.quantity as number) > 0
  );
}

function parseCheckout(value: unknown): CheckoutState {
  const fallback: CheckoutState = { idempotencyKey: null, paymentToken: 'tok_approve' };
  if (!isRecord(value)) return fallback;
  const token = PAYMENT_TOKENS.find((t) => t === value.paymentToken) ?? fallback.paymentToken;
  const key = typeof value.idempotencyKey === 'string' ? value.idempotencyKey : null;
  return { idempotencyKey: key, paymentToken: token };
}

/** Reads persisted state. Corrupt or foreign data is dropped, never trusted. */
export function loadPersistedState(storage: KeyValueStorage | undefined): PersistedState | undefined {
  if (!storage) return undefined;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return undefined;
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || !isRecord(parsed.cart) || !Array.isArray(parsed.cart.lines)) return undefined;
    return {
      cart: { lines: parsed.cart.lines.filter(isCartLine).slice(0, 50) },
      checkout: parseCheckout(parsed.checkout),
    };
  } catch {
    return undefined;
  }
}

export function savePersistedState(storage: KeyValueStorage | undefined, state: PersistedState): void {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Quota exceeded or storage disabled (private mode): the cart still works in memory.
  }
}

export function browserStorage(): KeyValueStorage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}
