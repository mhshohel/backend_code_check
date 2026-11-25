import { InventoryDocument } from '@ofl/graphql-types';
import { useCallback } from 'react';
import { useSearchParams } from 'react-router';
import { Button, CursorPages, DateTime, Section } from '../../components';
import { updateParams, useUrlCursors } from '../../app/useUrlCursors';
import { CURSOR_PARAMS, WAREHOUSE_PARAMS } from './warehouseParams';

export function InventoryPanel({ warehouseId }: { warehouseId: string }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const lowStockOnly = searchParams.get(WAREHOUSE_PARAMS.lowStock) === '1';
  const { cursors, loadMore } = useUrlCursors(CURSOR_PARAMS.inventory);
  const variablesFor = useCallback(
    (after: string | null) => ({ warehouseId, lowStockOnly, first: 20, after }),
    [warehouseId, lowStockOnly],
  );

  function select(skuId: string, skuWarehouseId: string) {
    setSearchParams(
      updateParams(
        searchParams,
        { [WAREHOUSE_PARAMS.sku]: skuId, [WAREHOUSE_PARAMS.skuWarehouse]: skuWarehouseId },
        [CURSOR_PARAMS.movements],
      ),
    );
  }

  return (
    <Section
      title="Inventory"
      actions={
        <label className="checkbox">
          <input
            type="checkbox"
            checked={lowStockOnly}
            onChange={(e) =>
              setSearchParams(
                updateParams(searchParams, { [WAREHOUSE_PARAMS.lowStock]: e.target.checked ? '1' : null }, [CURSOR_PARAMS.inventory]),
              )
            }
          />
          Low stock only
        </label>
      }
    >
      <CursorPages
        query={InventoryDocument}
        variablesFor={variablesFor}
        select={(data) => data.inventory}
        cursors={cursors}
        onLoadMore={loadMore}
        empty={<p>No inventory rows match.</p>}
        renderEdges={(edges) => (
          <table className="table">
            <thead>
              <tr>
                <th scope="col">SKU</th>
                <th scope="col">On hand</th>
                <th scope="col">Reserved</th>
                <th scope="col">Available</th>
                <th scope="col">Updated</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {edges.map(({ cursor, node }) => (
                <tr key={cursor}>
                  <th scope="row">
                    {node.sku.code}
                    <div className="muted">
                      {node.sku.product.name} · {node.sku.label}
                    </div>
                  </th>
                  <td>{node.onHand}</td>
                  <td>{node.reserved}</td>
                  <td>{node.available}</td>
                  <td>
                    <DateTime value={node.updatedAt} />
                  </td>
                  <td>
                    <Button variant="link" onClick={() => select(node.sku.id, node.warehouse.id)}>
                      Adjust / history<span className="visually-hidden"> for {node.sku.code}</span>
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      />
    </Section>
  );
}
