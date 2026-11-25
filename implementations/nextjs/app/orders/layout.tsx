import type { ReactNode } from 'react';
import { requireViewer } from '@/modules/server/session';

export default async function OrdersLayout({ children }: { readonly children: ReactNode }) {
  // Runs outside every Suspense boundary (the list's loading.tsx lives in the
  // (list) route group), so redirect() can still send a real 307 and the order
  // page's notFound() a real 404. Pages check again: layouts and pages render
  // in parallel.
  await requireViewer('/orders');
  return <div className="orders-area">{children}</div>;
}
