import type { ReactNode } from 'react';
import { SubNav } from '@/modules/ui/SubNav';
import { STAFF_ROLES, requireRole } from '@/modules/server/session';

const LINKS = [
  { href: '/warehouse', text: 'Shipping queue' },
  { href: '/warehouse/returns', text: 'Returns to receive' },
  { href: '/warehouse/inventory', text: 'Inventory' },
];

export default async function WarehouseLayout({ children }: { readonly children: ReactNode }) {
  // The segment's loading.tsx is a Suspense boundary: once it streams, the
  // HTTP status is fixed at 200. Checking here (outside that boundary) lets
  // redirect()/forbidden() set a real 307/403. Pages check again because
  // layouts and pages render in parallel.
  await requireRole(STAFF_ROLES, '/warehouse');
  return (
    <div className="dashboard">
      <SubNav label="Warehouse" links={LINKS} />
      <div>{children}</div>
    </div>
  );
}
