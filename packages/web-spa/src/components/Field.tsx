import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

type FieldShellProps = {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: string | undefined;
  children: ReactNode;
};

function FieldShell({ id, label, hint, error, children }: FieldShellProps) {
  return (
    <div className={`field${error ? ' field-invalid' : ''}`}>
      <label htmlFor={id}>{label}</label>
      {children}
      {hint ? (
        <p id={`${id}-hint`} className="field-hint">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="field-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function describedBy(id: string, hint: unknown, error: unknown): string | undefined {
  const ids = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean);
  return ids.length > 0 ? ids.join(' ') : undefined;
}

type CommonProps = { label: ReactNode; hint?: ReactNode; error?: string | undefined };

export function TextField({ label, hint, error, id, ...input }: CommonProps & InputHTMLAttributes<HTMLInputElement>) {
  const generated = useId();
  const fieldId = id ?? generated;
  return (
    <FieldShell id={fieldId} label={label} hint={hint} error={error}>
      <input
        {...input}
        id={fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(fieldId, hint, error)}
      />
    </FieldShell>
  );
}

export function TextAreaField({ label, hint, error, id, ...input }: CommonProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const generated = useId();
  const fieldId = id ?? generated;
  return (
    <FieldShell id={fieldId} label={label} hint={hint} error={error}>
      <textarea
        {...input}
        id={fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(fieldId, hint, error)}
      />
    </FieldShell>
  );
}

export type SelectOption = { value: string; label: string };

export function SelectField({
  label,
  hint,
  error,
  id,
  options,
  ...select
}: CommonProps & SelectHTMLAttributes<HTMLSelectElement> & { options: readonly SelectOption[] }) {
  const generated = useId();
  const fieldId = id ?? generated;
  return (
    <FieldShell id={fieldId} label={label} hint={hint} error={error}>
      <select
        {...select}
        id={fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(fieldId, hint, error)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}
