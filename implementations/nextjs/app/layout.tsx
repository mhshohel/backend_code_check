import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { Providers } from '@/modules/store/Providers';
import { CartLink } from '@/modules/cart/CartLink';
import { LogoutButton } from '@/modules/auth/LogoutButton';
import { ADMIN_ROLES, STAFF_ROLES, getViewer, hasRole } from '@/modules/server/session';
import { realtimeUrlForRequest } from '@/modules/server/realtime-url';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Order Fulfillment Lab', template: '%s · Order Fulfillment Lab' },
  description: 'Catalog, checkout, and fulfillment demo (Next.js variant).',
};

// The root layout reads the session cookie, so every route is rendered per
// request. Public catalog data is still cached at the data layer
// (modules/server/data/catalog.ts); per-user data never is.
export default async function RootLayout({ children }: { readonly children: ReactNode }) {
  const [viewer, realtimeUrl] = await Promise.all([getViewer(), realtimeUrlForRequest()]);
  const isStaff = hasRole(viewer, STAFF_ROLES);
  const isAdmin = hasRole(viewer, ADMIN_ROLES);

  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        {/* The WebSocket is lazy: it opens only when a page subscribes, and it reads the cookie at connect time. */}
        <Providers realtimeUrl={realtimeUrl}>
          <header className="site-header">
            <Link href="/" className="brand">
              Order Fulfillment Lab
            </Link>
            <nav aria-label="Main">
              <ul>
                <li>
                  <Link href="/">Catalog</Link>
                </li>
                <li>
                  <CartLink />
                </li>
                {viewer && (
                  <li>
                    <Link href="/orders">My orders</Link>
                  </li>
                )}
                {isStaff && (
                  <li>
                    <Link href="/warehouse">Warehouse</Link>
                  </li>
                )}
                {isAdmin && (
                  <li>
                    <Link href="/admin">Operations</Link>
                  </li>
                )}
              </ul>
            </nav>
            <div className="session">
              {viewer ? (
                <>
                  <span>
                    {viewer.displayName} <span className="muted">({viewer.role.toLowerCase()})</span>
                  </span>
                  <LogoutButton />
                </>
              ) : (
                <Link href="/login">Sign in</Link>
              )}
            </div>
          </header>
          <main id="main" tabIndex={-1}>
            {children}
          </main>
        </Providers>
      </body>
    </html>
  );
}
