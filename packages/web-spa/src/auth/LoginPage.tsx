import { loginInputSchema } from '@ofl/domain';
import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { Button, ErrorAlert, PageHeader, StatusMessage, TextField } from '../components';
import { useSession } from './session';

type FieldErrors = Partial<Record<'email' | 'password', string>>;

function safeNext(value: string | null): string {
  // Only same-app paths; never an absolute URL (open redirect).
  return value && value.startsWith('/') && !value.startsWith('//') ? value : '/';
}

export function LoginPage() {
  const { viewer, signIn } = useSession();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const next = safeNext(searchParams.get('next'));

  if (viewer && !submitting) return <Navigate to={next} replace />;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const parsed = loginInputSchema.safeParse({ email, password });
    if (!parsed.success) {
      const errors: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if ((key === 'email' || key === 'password') && !errors[key]) errors[key] = issue.message;
      }
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});
    setSubmitting(true);
    const outcome = await signIn(parsed.data.email, parsed.data.password);
    setSubmitting(false);
    if (outcome.kind === 'ok') navigate(next, { replace: true });
    else setFormError(outcome.message);
  }

  return (
    <div className="narrow">
      <PageHeader title="Sign in" />
      <form className="card form" onSubmit={handleSubmit} noValidate>
        {formError ? <ErrorAlert>{formError}</ErrorAlert> : null}
        <TextField
          label="Email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={fieldErrors.email}
          required
        />
        <TextField
          label="Password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={fieldErrors.password}
          required
        />
        <Button type="submit" variant="primary" busy={submitting}>
          Sign in
        </Button>
        {submitting ? <StatusMessage>Signing in…</StatusMessage> : null}
        <p className="field-hint">Demo accounts: customer@example.com / customer-pass-1, operator@example.com / operator-pass-1, admin@example.com / admin-pass-1.</p>
      </form>
    </div>
  );
}
