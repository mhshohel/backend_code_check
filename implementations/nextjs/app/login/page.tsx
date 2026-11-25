import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { LoginForm } from '@/modules/auth/LoginForm';
import { safeReturnPath } from '@/modules/auth/return-path';
import { getViewer } from '@/modules/server/session';

export const metadata: Metadata = { title: 'Sign in' };

type Props = { searchParams: Promise<{ next?: string | string[] }> };

export default async function LoginPage({ searchParams }: Props) {
  const { next } = await searchParams;
  const returnTo = safeReturnPath(Array.isArray(next) ? next[0] : next);
  if (await getViewer()) redirect(returnTo);
  return (
    <section className="narrow">
      <h1>Sign in</h1>
      <LoginForm next={returnTo} />
      <details>
        <summary>Demo accounts</summary>
        <ul>
          <li>customer@example.com / customer-pass-1</li>
          <li>operator@example.com / operator-pass-1</li>
          <li>admin@example.com / admin-pass-1</li>
        </ul>
      </details>
    </section>
  );
}
