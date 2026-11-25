import Link from 'next/link';

export default function ProductNotFound() {
  return (
    <section>
      <h1>Product not found</h1>
      <p>It may have been removed or renamed.</p>
      <p>
        <Link href="/">Search the catalog</Link>
      </p>
    </section>
  );
}
