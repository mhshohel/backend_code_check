import type { FieldError } from '../graphql/errors';

/** Server-side validation messages, announced and linked to the form via id. */
export function FieldErrors({ id, errors }: { readonly id: string; readonly errors: readonly FieldError[] }) {
  if (errors.length === 0) return null;
  return (
    <ul id={id} className="field-errors" role="alert">
      {errors.map((error) => (
        <li key={`${error.path}:${error.message}`}>
          {error.path === '(root)' ? error.message : `${error.path}: ${error.message}`}
        </li>
      ))}
    </ul>
  );
}
