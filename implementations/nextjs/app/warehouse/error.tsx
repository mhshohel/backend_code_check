'use client';

import { ErrorPanel } from '@/modules/ui/ErrorPanel';

export default function WarehouseError({ error, retry }: { error: unknown; retry: () => void }) {
  return <ErrorPanel title="Warehouse data could not be loaded" error={error} retry={retry} />;
}
