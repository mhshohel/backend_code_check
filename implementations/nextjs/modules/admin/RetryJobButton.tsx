'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from 'urql';
import { RetryJobDocument } from '@ofl/graphql-types';
import { describeError } from '../graphql/errors';
import { humanize } from '../ui/format';

export function RetryJobButton({ jobId, topic }: { readonly jobId: string; readonly topic: string }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [{ fetching }, retryJob] = useMutation(RetryJobDocument);

  async function retry(): Promise<void> {
    const result = await retryJob({ jobId });
    if (result.error) {
      setMessage(describeError(result.error).message);
      return;
    }
    const payload = result.data?.retryJob;
    if (payload?.__typename === 'JobRetried') {
      setMessage(`Queued again (${humanize(payload.job.status)}).`);
      router.refresh();
    } else if (payload?.__typename === 'JobNotRetryable') {
      setMessage(`Not retryable: ${humanize(payload.status)}.`);
    }
  }

  return (
    <span className="action-group">
      <button type="button" onClick={() => void retry()} disabled={fetching}>
        {fetching ? 'Retrying…' : 'Retry'}
        <span className="visually-hidden"> job {topic}</span>
      </button>
      <span role="status" aria-live="polite">
        {message}
      </span>
    </span>
  );
}
