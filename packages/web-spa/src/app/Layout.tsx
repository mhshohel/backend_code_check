import { NavLink, Outlet } from 'react-router';
import { useSpaConfig } from '../config';
import { ADMIN_ROLES, hasRole, STAFF_ROLES, useSession } from '../auth/session';
import { Toasts } from '../features/ui/Toasts';
import { useAppSelector } from './store';

export function Layout() {
  const { variantName } = useSpaConfig();
  const { viewer } = useSession();
  const cartCount = useAppSelector((state) => state.cart.lines.reduce((sum, line) => sum + line.quantity, 0));

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <div className="brand">
          Order Fulfillment Lab <span className="variant">{variantName}</span>
        </div>
        <nav aria-label="Main">
          <ul>
            <li>
              <NavLink to="/" end>
                Catalog
              </NavLink>
            </li>
            <li>
              <NavLink to="/cart">
                Cart <span className="count" aria-label={`${cartCount} items`}>{cartCount}</span>
              </NavLink>
            </li>
            {viewer ? (
              <li>
                <NavLink to="/orders">My orders</NavLink>
              </li>
            ) : null}
            {hasRole(viewer, STAFF_ROLES) ? (
              <li>
                <NavLink to="/warehouse">Warehouse</NavLink>
              </li>
            ) : null}
            {hasRole(viewer, ADMIN_ROLES) ? (
              <li>
                <NavLink to="/admin">Operations</NavLink>
              </li>
            ) : null}
          </ul>
        </nav>
        <div className="account">
          {viewer ? (
            <>
              <span>
                {viewer.displayName} <span className="muted">({viewer.role.toLowerCase()})</span>
              </span>
              <NavLink to="/logout">Sign out</NavLink>
            </>
          ) : (
            <NavLink to="/login">Sign in</NavLink>
          )}
        </div>
      </header>
      <main id="main" tabIndex={-1}>
        <Outlet />
      </main>
      <Toasts />
    </>
  );
}

export function NotFoundPage() {
  return (
    <div>
      <h1>Page not found</h1>
      <p>
        <NavLink to="/">Go to the catalog</NavLink>
      </p>
    </div>
  );
}
