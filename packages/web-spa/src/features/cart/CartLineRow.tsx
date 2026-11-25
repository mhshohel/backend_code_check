import { formatMoney, multiplyMinor } from '@ofl/domain';
import { Link } from 'react-router';
import { Button } from '../../components';
import { useAppDispatch } from '../../app/store';
import { itemRemoved, MAX_QUANTITY_INPUT, quantityChanged, type CartLine } from './cartSlice';

export function CartLineRow({ line }: { line: CartLine }) {
  const dispatch = useAppDispatch();
  const name = `${line.productName} (${line.skuLabel})`;
  return (
    <tr>
      <th scope="row">
        <Link to={`/products/${encodeURIComponent(line.productSlug)}`}>{line.productName}</Link>
        <div className="muted">
          {line.skuLabel} · {line.skuCode}
        </div>
      </th>
      <td>{formatMoney(line.unitPriceMinor)}</td>
      <td>
        <input
          type="number"
          className="qty"
          min={1}
          max={MAX_QUANTITY_INPUT}
          value={line.quantity}
          aria-label={`Quantity for ${name}`}
          onChange={(e) => dispatch(quantityChanged({ skuId: line.skuId, quantity: Number(e.target.value) || 1 }))}
        />
      </td>
      <td>{formatMoney(multiplyMinor(line.unitPriceMinor, line.quantity))}</td>
      <td>
        <Button variant="link" onClick={() => dispatch(itemRemoved({ skuId: line.skuId }))} aria-label={`Remove ${name}`}>
          Remove
        </Button>
      </td>
    </tr>
  );
}
