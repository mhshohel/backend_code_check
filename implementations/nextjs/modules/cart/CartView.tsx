'use client';

import Link from 'next/link';
import { useEffect, useId, useState } from 'react';
import { cartEstimatedTotalMinor, MAX_LINE_QUANTITY, MIN_LINE_QUANTITY, removeLine, setQuantity, type CartLine } from './cart-slice';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { formatMinor } from '../ui/format';

function CartLineRow({ line }: { readonly line: CartLine }) {
  const dispatch = useAppDispatch();
  const quantityId = useId();
  // Local draft so the field can be empty while typing; only valid values reach the store.
  const [draft, setDraft] = useState(String(line.quantity));
  useEffect(() => setDraft(String(line.quantity)), [line.quantity]);
  return (
    <tr>
      <th scope="row">
        <Link href={`/products/${encodeURIComponent(line.productSlug)}`}>{line.productName}</Link>
        <div className="muted">
          {line.skuLabel} · {line.skuCode}
        </div>
      </th>
      <td>{formatMinor(line.unitPriceMinor)}</td>
      <td>
        <label htmlFor={quantityId} className="visually-hidden">
          Quantity of {line.productName} {line.skuLabel}
        </label>
        <input
          id={quantityId}
          className="quantity-input"
          type="number"
          inputMode="numeric"
          min={MIN_LINE_QUANTITY}
          max={MAX_LINE_QUANTITY}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            const value = Number(event.target.value);
            if (event.target.value !== '' && Number.isInteger(value) && value >= MIN_LINE_QUANTITY) {
              dispatch(setQuantity({ skuId: line.skuId, quantity: value }));
            }
          }}
          onBlur={() => setDraft(String(line.quantity))}
        />
      </td>
      <td>{formatMinor(line.unitPriceMinor * line.quantity)}</td>
      <td>
        <button type="button" className="link-button" onClick={() => dispatch(removeLine({ skuId: line.skuId }))}>
          Remove<span className="visually-hidden"> {line.productName} {line.skuLabel}</span>
        </button>
      </td>
    </tr>
  );
}

export function CartView() {
  const cart = useAppSelector((state) => state.cart);
  if (cart.lines.length === 0) {
    return (
      <p>
        Your cart is empty. <Link href="/">Browse the catalog</Link>.
      </p>
    );
  }
  return (
    <div className="table-wrap">
      <table>
        <caption className="visually-hidden">Items in your cart</caption>
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
          {cart.lines.map((line) => (
            <CartLineRow key={line.skuId} line={line} />
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" colSpan={3}>
              Estimated total
            </th>
            <td colSpan={2}>{formatMinor(cartEstimatedTotalMinor(cart))}</td>
          </tr>
        </tfoot>
      </table>
      <p className="muted">Prices and stock are confirmed when you place the order.</p>
    </div>
  );
}
