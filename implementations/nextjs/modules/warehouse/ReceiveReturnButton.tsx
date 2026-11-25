'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from 'urql';
import { ReceiveReturnDocument, type OrderDetailFieldsFragment } from '@ofl/graphql-types';
import { describeError } from '../graphql/errors';
import { humanize } from '../ui/format';

type Props = {
  readonly returnId: string;
  readonly label: string;
  readonly onReceived?: (order: OrderDetailFieldsFragment) => void;
};

export function ReceiveReturnButton({ returnId, label, onReceived }: Props) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [{ fetching }, receiveReturn] = useMutation(ReceiveReturnDocument);

  async function receive(): Promise<void> {
    const result = await receiveReturn({ returnId });
    if (result.error) {
      setMessage(describeError(result.error).message);
      return;
    }
    const payload = result.data?.receiveReturn;
    if (payload?.__typename === 'ReturnReceived') {
      setMessage('Received and restocked. The refund is being processed.');
      if (onReceived) onReceived(payload.order);
      else router.refresh();
    } else if (payload?.__typename === 'ReturnNotReceivable') {
      setMessage(`Already handled (status: ${humanize(payload.status)}).`);
    }
  }

  return (
    <span className="action-group">
      <button type="button" onClick={() => void receive()} disabled={fetching}>
        {fetching ? 'Receiving…' : `Receive ${label}`}
      </button>
      <span role="status" aria-live="polite">
        {message}
      </span>
    </span>
  );
}
