'use client';

import { ErrorPanel } from '@/modules/ui/ErrorPanel';

export default function RootError({ error, retry }: { error: unknown; retry: () => void }) {
  return <ErrorPanel title="Something went wrong" error={error} retry={retry} />;
}
