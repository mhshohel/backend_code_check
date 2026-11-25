import Link from 'next/link';

export default function OrderNotFound() {
  return (
    <section>
      <h1>Order not found</h1>
      <p>This order does not exist or belongs to another account.</p>
      <p>
        <Link href="/orders">Back to your orders</Link>
      </p>
    </section>
  );
}
