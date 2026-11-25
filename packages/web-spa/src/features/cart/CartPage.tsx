import { formatMoney, multiplyMinor, sumMinor } from '@ofl/domain';
import { useNavigate } from 'react-router';
import { Button, PageHeader, StatusMessage } from '../../components';
import { useAppDispatch, useAppSelector } from '../../app/store';
import { CUSTOMER_ROLES, hasRole, useSession } from '../../auth/session';
import { CheckoutPanel } from '../checkout/CheckoutPanel';
import { toastShown } from '../ui/uiSlice';
import { CartLineRow } from './CartLineRow';
import { cartCleared } from './cartSlice';

export function CartPage() {
  const lines = useAppSelector((state) => state.cart.lines);
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { viewer } = useSession();
  const estimatedTotal = sumMinor(lines.map((line) => multiplyMinor(line.unitPriceMinor, line.quantity)));

  if (lines.length === 0) {
    return (
      <div>
        <PageHeader title="Your cart" />
        <p>Your cart is empty.</p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Your cart" />
      <table className="table">
        <caption className="visually-hidden">Cart items</caption>
        <thead>
          <tr>
            <th scope="col">Item</th>
            <th scope="col">Unit price</th>
            <th scope="col">Quantity</th>
            <th scope="col">Line total</th>
            <th scope="col">
              <span className="visually-hidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <CartLineRow key={line.skuId} line={line} />
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" colSpan={3}>
              Estimated total
            </th>
            <td colSpan={2}>
              <output aria-label="Estimated total">{formatMoney(estimatedTotal)}</output>
            </td>
          </tr>
        </tfoot>
      </table>
      <p className="field-hint">Prices and stock are checked again when you place the order.</p>
      <Button variant="link" onClick={() => dispatch(cartCleared())}>
        Empty cart
      </Button>
      {hasRole(viewer, CUSTOMER_ROLES) ? (
        <CheckoutPanel
          onSucceeded={(orderId, replayed) => {
            dispatch(toastShown('success', replayed ? 'Your earlier checkout had already been placed.' : 'Order placed. Payment is pending.'));
            navigate(`/orders/${orderId}`);
          }}
        />
      ) : (
        <StatusMessage>
          {viewer ? 'Only customer accounts can check out.' : 'Sign in with a customer account to check out.'}
        </StatusMessage>
      )}
    </div>
  );
}
