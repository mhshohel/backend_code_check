import type { ReactNode } from 'react';

/** Polite live region for pending/async progress ("Reserving stock…"). */
export function StatusMessage({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p role="status" aria-live="polite" className={['status-message', className].filter(Boolean).join(' ')}>
      {children}
    </p>
  );
}

/** Assertive alert for failures that need attention. */
export function ErrorAlert({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div role="alert" className="alert alert-error">
      {title ? <strong className="alert-title">{title}</strong> : null}
      <div>{children}</div>
    </div>
  );
}

export function Notice({ kind = 'info', children }: { kind?: 'info' | 'success' | 'warning'; children: ReactNode }) {
  return <div className={`alert alert-${kind}`}>{children}</div>;
}

export function Spinner({ label }: { label: string }) {
  return (
    <p role="status" aria-live="polite" className="status-message">
      <span className="spinner" aria-hidden="true" /> {label}
    </p>
  );
}
