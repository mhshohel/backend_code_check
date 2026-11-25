import { WarehousesDocument } from '@ofl/graphql-types';
import { useSearchParams } from 'react-router';
import { useQuery } from 'urql';
import { PageHeader, SelectField } from '../../components';
import { updateParams } from '../../app/useUrlCursors';
import { AdjustmentForm } from './AdjustmentForm';
import { AwaitingShipment } from './AwaitingShipment';
import { InventoryPanel } from './InventoryPanel';
import { MovementHistory } from './MovementHistory';
import { ReturnsAwaitingReceipt } from './ReturnsAwaitingReceipt';
import { ALL_CURSOR_PARAMS, CURSOR_PARAMS, WAREHOUSE_PARAMS } from './warehouseParams';

export function WarehousePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [{ data }] = useQuery({ query: WarehousesDocument });
  const warehouses = data?.warehouses ?? [];
  const warehouseId = searchParams.get(WAREHOUSE_PARAMS.warehouse) ?? warehouses[0]?.id ?? null;
  const skuId = searchParams.get(WAREHOUSE_PARAMS.sku);
  const skuWarehouseId = searchParams.get(WAREHOUSE_PARAMS.skuWarehouse);

  return (
    <div>
      <PageHeader title="Warehouse">
        {warehouses.length > 0 ? (
          <SelectField
            label="Warehouse"
            value={warehouseId ?? ''}
            options={warehouses.map((w) => ({ value: w.id, label: `${w.code} — ${w.name}` }))}
            onChange={(e) =>
              setSearchParams(updateParams(searchParams, { [WAREHOUSE_PARAMS.warehouse]: e.target.value }, ALL_CURSOR_PARAMS))
            }
          />
        ) : null}
      </PageHeader>
      <div className="dashboard-grid">
        {warehouseId ? <AwaitingShipment warehouseId={warehouseId} /> : null}
        <ReturnsAwaitingReceipt />
        {warehouseId ? <InventoryPanel warehouseId={warehouseId} /> : null}
        {skuId && skuWarehouseId ? (
          <>
            <AdjustmentForm key={`${skuId}:${skuWarehouseId}`} skuId={skuId} warehouseId={skuWarehouseId} />
            <MovementHistory skuId={skuId} warehouseId={skuWarehouseId} cursorParam={CURSOR_PARAMS.movements} />
          </>
        ) : null}
      </div>
    </div>
  );
}
