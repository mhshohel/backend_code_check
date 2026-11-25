import { ReceiveReturnDocument } from '@ofl/graphql-types';
import { useMutation } from 'urql';
import { Button } from '../../components';
import { useAppDispatch } from '../../app/store';
import { describeError } from '../../graphql/errors';
import { toastShown } from '../ui/uiSlice';

/** Shown for ids in allowedActions.receivableReturnIds (staff only, server-computed). */
export function ReceiveReturnButton({ returnId }: { returnId: string }) {
  const [{ fetching }, receiveReturn] = useMutation(ReceiveReturnDocument);
  const dispatch = useAppDispatch();

  async function receive() {
    const response = await receiveReturn({ returnId });
    if (response.error) {
      dispatch(toastShown('error', describeError(response.error).message));
      return;
    }
    const result = response.data?.receiveReturn;
    if (result?.__typename === 'ReturnReceived') {
      dispatch(toastShown('success', `Return received for order ${result.order.number}; refund started.`));
    } else if (result) {
      dispatch(toastShown('error', result.message));
    }
  }

  return (
    <Button busy={fetching} onClick={() => void receive()}>
      Receive return
    </Button>
  );
}
