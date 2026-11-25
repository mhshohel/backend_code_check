'use client';

import { useActionState, useId } from 'react';
import { loginAction, type LoginFormState } from './actions';

export function LoginForm({ next }: { readonly next: string }) {
  const [state, formAction, pending] = useActionState<LoginFormState, FormData>(loginAction, { error: null, email: '' });
  const emailId = useId();
  const passwordId = useId();
  const errorId = useId();
  return (
    <form action={formAction} className="login-form" aria-describedby={state.error ? errorId : undefined}>
      <input type="hidden" name="next" value={next} />
      <div className="field">
        <label htmlFor={emailId}>Email</label>
        <input id={emailId} name="email" type="email" autoComplete="username" required defaultValue={state.email} aria-invalid={state.error !== null} />
      </div>
      <div className="field">
        <label htmlFor={passwordId}>Password</label>
        <input id={passwordId} name="password" type="password" autoComplete="current-password" required aria-invalid={state.error !== null} />
      </div>
      {state.error && (
        <p id={errorId} className="error-text" role="alert">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
