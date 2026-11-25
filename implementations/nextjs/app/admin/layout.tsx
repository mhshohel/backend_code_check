import type { ReactNode } from 'react';
import { SubNav } from '@/modules/ui/SubNav';
import { ADMIN_ROLES, requireRole } from '@/modules/server/session';

const LINKS = [
  { href: '/admin', text: 'Overview' },
  { href: '/admin/jobs', text: 'Jobs' },
  { href: '/admin/audit', text: 'Audit log' },
];

export default async function AdminLayout({ children }: { readonly children: ReactNode }) {
  // The segment's loading.tsx is a Suspense boundary: once it streams, the
  // HTTP status is fixed at 200. Checking here (outside that boundary) lets
  // redirect()/forbidden() set a real 307/403. Pages check again because
  // layouts and pages render in parallel.
  await requireRole(ADMIN_ROLES, '/admin');
  return (
    <div className="dashboard">
      <SubNav label="Operations" links={LINKS} />
      <div>{children}</div>
    </div>
  );
}
