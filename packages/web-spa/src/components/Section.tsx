import { useId, type ReactNode } from 'react';

export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="page-header">
      <h1>{title}</h1>
      {children}
    </header>
  );
}

export function Section({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  const headingId = useId();
  return (
    <section className="card" aria-labelledby={headingId}>
      <div className="card-header">
        <h2 id={headingId}>{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function DateTime({ value }: { value: string }) {
  const date = new Date(value);
  return <time dateTime={value}>{Number.isNaN(date.getTime()) ? value : date.toLocaleString()}</time>;
}
