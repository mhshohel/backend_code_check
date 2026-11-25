'use client';

import { ErrorPanel } from '@/modules/ui/ErrorPanel';

export default function OrdersError({ error, retry }: { error: unknown; retry: () => void }) {
  return <ErrorPanel title="Orders could not be loaded" error={error} retry={retry} />;
}
