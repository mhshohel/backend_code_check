import { adjustInventoryInputSchema } from '@ofl/domain';
import { AdjustInventoryDocument, type StockChangeKind } from '@ofl/graphql-types';
import { useState, type FormEvent } from 'react';
import { useMutation } from 'urql';
import { Button, ErrorAlert, Section, SelectField, StatusMessage, TextField } from '../../components';
import { useAppDispatch } from '../../app/store';
import { describeError } from '../../graphql/errors';
import { toastShown } from '../ui/uiSlice';

type Errors = Partial<Record<'quantityDelta' | 'reason' | 'form', string>>;

const KIND_OPTIONS: ReadonlyArray<{ value: StockChangeKind; label: string }> = [
  { value: 'RECEIPT', label: 'Receipt (goods arrived)' },
  { value: 'ADJUSTMENT', label: 'Adjustment (count correction, can be negative)' },
];

export function AdjustmentForm({ skuId, warehouseId }: { skuId: string; warehouseId: string }) {
  const [kind, setKind] = useState<StockChangeKind>('RECEIPT');
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [{ fetching }, adjust] = useMutation(AdjustInventoryDocument);
  const dispatch = useAppDispatch();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = { skuId, warehouseId, kind, quantityDelta: Number(delta), reason };
    const parsed = adjustInventoryInputSchema.safeParse(input);
    if (!parsed.success || delta.trim() === '') {
      const next: Errors = delta.trim() === '' ? { quantityDelta: 'Enter a quantity.' } : {};
      for (const issue of parsed.success ? [] : parsed.error.issues) {
        const key = issue.path[0];
        if ((key === 'quantityDelta' || key === 'reason') && !next[key]) next[key] = issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    const response = await adjust({ input });
    if (response.error) return setErrors({ form: describeError(response.error).message });
    const result = response.data?.adjustInventory;
    if (result?.__typename === 'InventoryAdjusted') {
      dispatch(toastShown('success', `${result.balance.sku.code} in ${result.balance.warehouse.code}: on hand now ${result.balance.onHand}.`));
      setDelta('');
      setReason('');
    } else if (result) {
      setErrors({ form: `${result.message} (on hand ${result.onHand}, reserved ${result.reserved})` });
    }
  }

  return (
    <Section title="Adjust stock">
      <form className="form" onSubmit={submit} noValidate>
        {errors.form ? <ErrorAlert>{errors.form}</ErrorAlert> : null}
        <SelectField label="Kind" value={kind} options={KIND_OPTIONS} onChange={(e) => setKind(e.target.value as StockChangeKind)} />
        <TextField
          label="Quantity change"
          type="number"
          inputMode="numeric"
          value={delta}
          onChange={(e) => setDelta(e.target.value)}
          error={errors.quantityDelta}
          hint="Positive adds units; an adjustment may be negative."
        />
        <TextField label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} error={errors.reason} />
        <Button type="submit" variant="primary" busy={fetching}>
          Save change
        </Button>
        <StatusMessage>{fetching ? 'Saving stock change…' : ''}</StatusMessage>
      </form>
    </Section>
  );
}
