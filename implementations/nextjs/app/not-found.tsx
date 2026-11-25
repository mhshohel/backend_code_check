import Link from 'next/link';

export default function NotFound() {
  return (
    <section>
      <h1>Not found</h1>
      <p>This page does not exist or is not visible to your account.</p>
      <p>
        <Link href="/">Back to the catalog</Link>
      </p>
    </section>
  );
}
