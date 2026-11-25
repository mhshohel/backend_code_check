'use client';

import { useId, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { addLine, MAX_LINE_QUANTITY, MIN_LINE_QUANTITY } from '../cart/cart-slice';
import { useAppDispatch } from '../store/hooks';
import { toastShown } from '../ui/toast-slice';

export type PurchasableSku = {
  readonly id: string;
  readonly code: string;
  readonly label: string;
  readonly priceMinor: number;
  readonly priceFormatted: string;
  readonly available: number;
};

type Props = {
  readonly productName: string;
  readonly productSlug: string;
  readonly skus: readonly PurchasableSku[];
};

export function AddToCartForm({ productName, productSlug, skus }: Props) {
  const dispatch = useAppDispatch();
  const firstAvailable = skus.find((sku) => sku.available > 0) ?? skus[0];
  const [skuId, setSkuId] = useState(firstAvailable?.id ?? '');
  const [quantity, setQuantity] = useState('1');
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState(false);
  const quantityId = useId();
  const errorId = useId();

  const selected = skus.find((sku) => sku.id === skuId);

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const parsed = Number(quantity);
    if (!selected) {
      setError('Choose an option.');
      return;
    }
    if (!Number.isInteger(parsed) || parsed < MIN_LINE_QUANTITY || parsed > MAX_LINE_QUANTITY) {
      setError(`Enter a whole number from ${MIN_LINE_QUANTITY} to ${MAX_LINE_QUANTITY}.`);
      return;
    }
    setError(null);
    dispatch(
      addLine({
        skuId: selected.id,
        skuCode: selected.code,
        skuLabel: selected.label,
        productName,
        productSlug,
        unitPriceMinor: selected.priceMinor,
        quantity: parsed,
      }),
    );
    setAdded(true);
    dispatch(toastShown({ tone: 'success', message: `Added ${parsed} × ${productName} (${selected.label}) to the cart.` }));
  }

  if (skus.length === 0) return <p>This product has no purchasable options.</p>;

  return (
    <form className="add-to-cart" onSubmit={submit} noValidate>
      <fieldset>
        <legend>Option</legend>
        {skus.map((sku) => (
          <label key={sku.id} className="check">
            <input type="radio" name="sku" value={sku.id} checked={sku.id === skuId} onChange={() => setSkuId(sku.id)} />
            {sku.label} — {sku.priceFormatted}{' '}
            <span className="count">{sku.available > 0 ? `${sku.available} available` : 'out of stock'}</span>
          </label>
        ))}
      </fieldset>
      <div className="field">
        <label htmlFor={quantityId}>Quantity</label>
        <input
          id={quantityId}
          type="number"
          inputMode="numeric"
          min={MIN_LINE_QUANTITY}
          max={MAX_LINE_QUANTITY}
          value={quantity}
          aria-invalid={error !== null}
          aria-describedby={error ? errorId : undefined}
          onChange={(event) => setQuantity(event.target.value)}
        />
      </div>
      {error && (
        <p id={errorId} className="error-text" role="alert">
          {error}
        </p>
      )}
      <button type="submit">Add to cart</button>
      {added && (
        <p>
          <Link href="/cart">Go to cart</Link>
        </p>
      )}
    </form>
  );
}
