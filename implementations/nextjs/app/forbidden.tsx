import Link from 'next/link';

export default function Forbidden() {
  return (
    <section>
      <h1>Access denied</h1>
      <p>Your account does not have permission to view this page.</p>
      <p>
        <Link href="/">Back to the catalog</Link>
      </p>
    </section>
  );
}
