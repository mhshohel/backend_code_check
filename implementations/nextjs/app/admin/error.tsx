'use client';

import { ErrorPanel } from '@/modules/ui/ErrorPanel';

export default function AdminError({ error, retry }: { error: unknown; retry: () => void }) {
  return <ErrorPanel title="Operations data could not be loaded" error={error} retry={retry} />;
}
