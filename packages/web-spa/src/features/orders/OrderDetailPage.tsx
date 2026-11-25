import { Link, useParams } from 'react-router';
import { DateTime, ErrorAlert, ErrorFor, PageHeader, Section, Spinner, StatusBadge, StatusMessage, humanize } from '../../components';
import { useAppSelector } from '../../app/store';
import { CancelOrderButton } from './CancelOrderButton';
import { ReceiveReturnButton } from './ReceiveReturnButton';
import { ReturnRequestForm } from './ReturnRequestForm';
import { ShipButtons } from './ShipButtons';
import { useLiveOrder, type OrderDetail } from './useLiveOrder';

export function OrderDetailPage() {
  const { orderId = '' } = useParams();
  const { order, fetching, error, liveError } = useLiveOrder(orderId);

  if (order === undefined) {
    return error ? <ErrorFor error={error} /> : fetching ? <Spinner label="Loading order…" /> : null;
  }
  if (order === null) {
    return (
      <ErrorAlert title="Order not found">
        We could not find this order. <Link to="/orders">Back to my orders</Link>.
      </ErrorAlert>
    );
  }
  return <OrderDetailView order={order} liveUnavailable={Boolean(liveError)} />;
}

function LiveStatus({ order, liveUnavailable }: { order: OrderDetail; liveUnavailable: boolean }) {
  const connection = useAppSelector((state) => state.ui.liveConnection);
  const statusText =
    order.status === 'PENDING_PAYMENT'
      ? `Payment pending. Stock is reserved until ${new Date(order.reservationExpiresAt).toLocaleTimeString()}.`
      : `Order status: ${humanize(order.status)}${order.cancellationReason ? ` (${humanize(order.cancellationReason)})` : ''}.`;
  return (
    <div className="live-status">
      <StatusMessage>{statusText}</StatusMessage>
      <p className="muted">
        {liveUnavailable
          ? 'Live updates are unavailable; reload to see changes.'
          : connection === 'reconnecting'
            ? 'Reconnecting to live updates…'
            : 'Live updates on.'}
      </p>
    </div>
  );
}

function OrderDetailView({ order, liveUnavailable }: { order: OrderDetail; liveUnavailable: boolean }) {
  const actions = order.allowedActions;
  return (
    <article>
      <PageHeader title={`Order ${order.number}`}>
        <StatusBadge status={order.status} />
      </PageHeader>
      <LiveStatus order={order} liveUnavailable={liveUnavailable} />
      <div className="actions">
        {actions.canCancel ? <CancelOrderButton orderId={order.id} orderNumber={order.number} /> : null}
        <ShipButtons orderId={order.id} warehouses={actions.shippableWarehouses} />
      </div>

      <Section title="Items">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col">Quantity</th>
              <th scope="col">Unit price</th>
              <th scope="col">Total</th>
              <th scope="col">Shipped</th>
              <th scope="col">Returned</th>
            </tr>
          </thead>
          <tbody>
            {order.lines.map((line) => (
              <tr key={line.id}>
                <th scope="row">
                  <Link to={`/products/${encodeURIComponent(line.sku.product.slug)}`}>{line.productName}</Link>
                  <div className="muted">{line.skuCode}</div>
                </th>
                <td>{line.quantity}</td>
                <td>{line.unitPrice.formatted}</td>
                <td>{line.lineTotal.formatted}</td>
                <td>{line.shippedQuantity}</td>
                <td>{line.returnedQuantity}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={3}>
                Total
              </th>
              <td colSpan={3}>{order.total.formatted}</td>
            </tr>
          </tfoot>
        </table>
      </Section>

      <Section title="Payment">
        {order.payment ? (
          <dl className="facts">
            <dt>Status</dt>
            <dd>
              <StatusBadge status={order.payment.status} />
            </dd>
            <dt>Amount</dt>
            <dd>{order.payment.amount.formatted}</dd>
            <dt>Refunded</dt>
            <dd>{order.payment.refunded.formatted}</dd>
            {order.payment.declineReason ? (
              <>
                <dt>Decline reason</dt>
                <dd>{order.payment.declineReason}</dd>
              </>
            ) : null}
          </dl>
        ) : (
          <p>No payment yet.</p>
        )}
      </Section>

      <Section title="Shipments">
        {order.shipments.length === 0 ? (
          <p>Nothing has shipped yet.</p>
        ) : (
          <ul>
            {order.shipments.map((shipment) => (
              <li key={shipment.id}>
                {shipment.warehouse.name}: tracking {shipment.trackingCode}, shipped <DateTime value={shipment.shippedAt} /> (
                {shipment.lines.map((l) => `${l.skuCode} × ${l.quantity}`).join(', ')})
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Returns">
        {order.returns.length === 0 ? <p>No returns.</p> : null}
        <ul>
          {order.returns.map((ret) => (
            <li key={ret.id} className="return-item">
              <StatusBadge status={ret.status} /> {ret.lines.map((l) => `${l.skuCode} × ${l.quantity}`).join(', ')} — refund{' '}
              {ret.refund.formatted}. Reason: {ret.reason}
              {actions.receivableReturnIds.includes(ret.id) ? <ReceiveReturnButton returnId={ret.id} /> : null}
            </li>
          ))}
        </ul>
        {actions.canRequestReturn ? <ReturnRequestForm order={order} /> : null}
      </Section>
    </article>
  );
}
