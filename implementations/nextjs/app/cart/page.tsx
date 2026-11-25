import type { Metadata } from 'next';
import Link from 'next/link';
import { CartView } from '@/modules/cart/CartView';
import { CheckoutPanel } from '@/modules/checkout/CheckoutPanel';
import { getViewer } from '@/modules/server/session';

export const metadata: Metadata = { title: 'Cart' };

export default async function CartPage() {
  const viewer = await getViewer();
  return (
    <div>
      <h1>Your cart</h1>
      <CartView />
      <section aria-labelledby="checkout-heading">
        <h2 id="checkout-heading">Checkout</h2>
        {!viewer && (
          <p>
            <Link href="/login?next=/cart">Sign in</Link> to place your order.
          </p>
        )}
        {viewer && viewer.role !== 'CUSTOMER' && <p>Checkout is available for customer accounts only.</p>}
        {viewer?.role === 'CUSTOMER' && <CheckoutPanel />}
      </section>
    </div>
  );
}
