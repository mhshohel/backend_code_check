import { ProductDetailDocument, UpdateSkuPriceDocument } from '@ofl/graphql-types';
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery } from 'urql';
import { Button, ErrorAlert, Section, SelectField, StatusMessage, TextField } from '../../components';
import { useAppDispatch } from '../../app/store';
import { describeError } from '../../graphql/errors';
import { toastShown } from '../ui/uiSlice';
import { parseMoneyInput } from './parseMoneyInput';

/** Admin price change: find a product by slug, pick a SKU, enter the new price. */
export function PriceUpdateForm() {
  const [slugInput, setSlugInput] = useState('');
  const [slug, setSlug] = useState('');
  const [skuId, setSkuId] = useState('');
  const [price, setPrice] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [{ data, fetching: loadingProduct }] = useQuery({ query: ProductDetailDocument, variables: { slug }, pause: slug === '' });
  const [{ fetching }, updatePrice] = useMutation(UpdateSkuPriceDocument);
  const dispatch = useAppDispatch();
  const product = data?.product ?? null;
  const selectedSku = product?.skus.find((s) => s.id === skuId) ?? product?.skus[0];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const priceMinor = parseMoneyInput(price);
    if (!selectedSku) return setError('Choose a SKU first.');
    if (priceMinor === null) return setError('Enter a price such as 12.50.');
    setError(null);
    const response = await updatePrice({ input: { skuId: selectedSku.id, priceMinor } });
    if (response.error) return setError(describeError(response.error).message);
    const result = response.data?.updateSkuPrice;
    if (result) {
      dispatch(toastShown('success', `${result.sku.code} now costs ${result.sku.price.formatted}.`));
      setPrice('');
    }
  }

  return (
    <Section title="Change a price">
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          setSlug(slugInput.trim());
          setSkuId('');
        }}
      >
        <TextField label="Product slug" value={slugInput} onChange={(e) => setSlugInput(e.target.value)} />
        <Button type="submit">Find product</Button>
      </form>
      <StatusMessage>{loadingProduct ? 'Looking up product…' : slug && data && !product ? 'No product with this slug.' : ''}</StatusMessage>
      {product && selectedSku ? (
        <form className="form" onSubmit={submit} noValidate>
          {error ? <ErrorAlert>{error}</ErrorAlert> : null}
          <SelectField
            label="SKU"
            value={selectedSku.id}
            options={product.skus.map((s) => ({ value: s.id, label: `${s.code} — ${s.label} (${s.price.formatted})` }))}
            onChange={(e) => setSkuId(e.target.value)}
          />
          <TextField label="New price (USD)" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="12.50" />
          <Button type="submit" variant="primary" busy={fetching}>
            Update price
          </Button>
        </form>
      ) : null}
    </Section>
  );
}
