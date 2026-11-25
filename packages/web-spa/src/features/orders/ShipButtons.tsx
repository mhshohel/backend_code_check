import { ShipOrderDocument, type WarehouseFieldsFragment } from '@ofl/graphql-types';
import { useMutation } from 'urql';
import { Button } from '../../components';
import { useAppDispatch } from '../../app/store';
import { describeError } from '../../graphql/errors';
import { toastShown } from '../ui/uiSlice';

/** One button per warehouse in allowedActions.shippableWarehouses (staff only, server-computed). */
export function ShipButtons({ orderId, warehouses }: { orderId: string; warehouses: readonly WarehouseFieldsFragment[] }) {
  const [{ fetching }, shipOrder] = useMutation(ShipOrderDocument);
  const dispatch = useAppDispatch();

  async function ship(warehouse: WarehouseFieldsFragment) {
    const response = await shipOrder({ input: { orderId, warehouseId: warehouse.id } });
    if (response.error) {
      dispatch(toastShown('error', describeError(response.error).message));
      return;
    }
    const result = response.data?.shipOrder;
    if (!result) return;
    if (result.__typename === 'ShipmentCreated') {
      dispatch(toastShown('success', `Shipped order ${result.order.number} from ${warehouse.code}, tracking ${result.shipment.trackingCode}.`));
    } else {
      dispatch(toastShown('error', result.message));
    }
  }

  if (warehouses.length === 0) return null;
  return (
    <div className="inline-form">
      {warehouses.map((warehouse) => (
        <Button key={warehouse.id} variant="primary" busy={fetching} onClick={() => void ship(warehouse)}>
          Ship from {warehouse.code}
        </Button>
      ))}
    </div>
  );
}
