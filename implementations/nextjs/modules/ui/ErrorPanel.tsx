'use client';

import { useEffect } from 'react';

type Props = { readonly title: string; readonly error: unknown; readonly retry: () => void };

/** Shared body for error.tsx boundaries. Server error messages are masked in production; we show the digest for support. */
export function ErrorPanel({ title, error, retry }: Props) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  const digest = error instanceof Error && 'digest' in error ? String((error as Error & { digest?: string }).digest ?? '') : '';
  return (
    <section role="alert" className="error-panel">
      <h1>{title}</h1>
      <p>The page could not be loaded. You can try again; if it keeps failing, contact support.</p>
      {digest && <p className="muted">Reference: {digest}</p>}
      <button type="button" onClick={() => retry()}>
        Try again
      </button>
    </section>
  );
}
