import type { RouteObject } from 'react-router';
import { LoginPage } from '../auth/LoginPage';
import { LogoutPage } from '../auth/LogoutPage';
import { RequireRole } from '../auth/RequireRole';
import { ADMIN_ROLES, STAFF_ROLES } from '../auth/session';
import { CartPage } from '../features/cart/CartPage';
import { CatalogPage } from '../features/catalog/CatalogPage';
import { ProductDetailPage } from '../features/catalog/ProductDetailPage';
import { MyOrdersPage } from '../features/orders/MyOrdersPage';
import { OrderDetailPage } from '../features/orders/OrderDetailPage';
import { Layout, NotFoundPage } from './Layout';

// Data comes from urql hooks inside the pages, so routes have no loaders.
// Staff dashboards are split into their own chunks: customers never load them.
async function warehouseRoute() {
  const { WarehousePage } = await import('../features/warehouse/WarehousePage');
  return { element: <RequireRole roles={STAFF_ROLES}><WarehousePage /></RequireRole> };
}

async function adminRoute() {
  const { AdminPage } = await import('../features/admin/AdminPage');
  return { element: <RequireRole roles={ADMIN_ROLES}><AdminPage /></RequireRole> };
}

export const appRoutes: RouteObject[] = [
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <CatalogPage /> },
      { path: 'products/:slug', element: <ProductDetailPage /> },
      { path: 'cart', element: <CartPage /> },
      { path: 'login', element: <LoginPage /> },
      { path: 'logout', element: <LogoutPage /> },
      { path: 'orders', element: <RequireRole><MyOrdersPage /></RequireRole> },
      { path: 'orders/:orderId', element: <RequireRole><OrderDetailPage /></RequireRole> },
      { path: 'warehouse', lazy: warehouseRoute },
      { path: 'admin', lazy: adminRoute },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
