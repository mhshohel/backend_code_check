import type { OrderDetailFieldsFragment } from '@ofl/graphql-types';
import { OrderStatusBadge } from '../ui/StatusBadge';
import { formatDateTime, humanize } from '../ui/format';

/** Pure presentation of an order; used inside the live client view. */
export function OrderDetails({ order }: { readonly order: OrderDetailFieldsFragment }) {
  return (
    <div className="order-details">
      <dl className="summary-list">
        <div>
          <dt>Status</dt>
          <dd>
            <OrderStatusBadge status={order.status} />
            {order.cancellationReason && <span className="muted"> ({humanize(order.cancellationReason)})</span>}
          </dd>
        </div>
        <div>
          <dt>Placed</dt>
          <dd>{formatDateTime(order.createdAt)}</dd>
        </div>
        <div>
          <dt>Customer</dt>
          <dd>{order.customer.displayName}</dd>
        </div>
        <div>
          <dt>Total</dt>
          <dd>{order.total.formatted}</dd>
        </div>
        <div>
          <dt>Payment</dt>
          <dd>
            {order.payment ? humanize(order.payment.status) : 'None'}
            {order.payment && order.payment.refunded.amountMinor > 0 && ` · refunded ${order.payment.refunded.formatted}`}
            {order.payment?.declineReason && ` · ${order.payment.declineReason}`}
          </dd>
        </div>
        {order.status === 'PENDING_PAYMENT' && (
          <div>
            <dt>Items held until</dt>
            <dd>{formatDateTime(order.reservationExpiresAt)}</dd>
          </div>
        )}
      </dl>

      <h2>Items</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col">Qty</th>
              <th scope="col">Unit</th>
              <th scope="col">Total</th>
              <th scope="col">Shipped</th>
              <th scope="col">Returned</th>
            </tr>
          </thead>
          <tbody>
            {order.lines.map((line) => (
              <tr key={line.id}>
                <th scope="row">
                  {line.productName} <span className="muted">{line.skuCode}</span>
                </th>
                <td>{line.quantity}</td>
                <td>{line.unitPrice.formatted}</td>
                <td>{line.lineTotal.formatted}</td>
                <td>{line.shippedQuantity}</td>
                <td>{line.returnedQuantity}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {order.reservations.length > 0 && (
        <>
          <h2>Reservations</h2>
          <ul>
            {order.reservations.map((reservation) => (
              <li key={reservation.id}>
                {reservation.quantity} × {reservation.sku.code} in {reservation.warehouse.code}: {humanize(reservation.status)}
              </li>
            ))}
          </ul>
        </>
      )}

      {order.shipments.length > 0 && (
        <>
          <h2>Shipments</h2>
          <ul>
            {order.shipments.map((shipment) => (
              <li key={shipment.id}>
                {shipment.warehouse.code} · {shipment.trackingCode} · {formatDateTime(shipment.shippedAt)} ·{' '}
                {shipment.lines.map((line) => `${line.quantity} × ${line.skuCode}`).join(', ')}
              </li>
            ))}
          </ul>
        </>
      )}

      {order.returns.length > 0 && (
        <>
          <h2>Returns</h2>
          <ul>
            {order.returns.map((entry) => (
              <li key={entry.id}>
                {humanize(entry.status)} · refund {entry.refund.formatted} · {entry.reason} ·{' '}
                {entry.lines.map((line) => `${line.quantity} × ${line.skuCode} to ${line.warehouse.code}`).join(', ')}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
