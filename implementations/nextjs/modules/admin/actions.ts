'use server';

import { refresh, revalidateTag } from 'next/cache';
import { UpdateSkuPriceDocument } from '@ofl/graphql-types';
import { getServices } from '../server/services';
import { getRequestMeta, getViewer } from '../server/session';
import { appErrorCode } from '../server/app-error';
import { CATALOG_SEARCH_TAG } from '../server/data/catalog';
import { runOperation } from '../server/data/run-operation';
import { parsePriceToMinor } from './price-input';

export type PriceUpdateState =
  | { status: 'idle' }
  | { status: 'saved'; message: string }
  | { status: 'error'; message: string };

/**
 * Price change as a Server Action (Next's Origin check applies). Authorization
 * stays in the application layer: executeOperation rejects non-admins.
 * Afterwards we mark cached search results stale and refresh the client
 * router so the product page shows the new price immediately.
 */
export async function updateSkuPriceAction(_previous: PriceUpdateState, formData: FormData): Promise<PriceUpdateState> {
  const skuId = String(formData.get('skuId') ?? '');
  const rawPrice = formData.get('price');
  // Validated here, on the server: the form's type=number field is only a hint.
  const parsed = parsePriceToMinor(typeof rawPrice === 'string' ? rawPrice : '');
  if (!parsed.ok) return { status: 'error', message: parsed.message };
  const priceMinor = parsed.priceMinor;

  const [services, viewer, meta] = await Promise.all([getServices(), getViewer(), getRequestMeta()]);
  try {
    const result = await runOperation(services, viewer, meta, UpdateSkuPriceDocument, { input: { skuId, priceMinor } });
    // Search documents are re-indexed by the worker; stale-while-revalidate is enough for them.
    revalidateTag(CATALOG_SEARCH_TAG, 'max');
    refresh();
    return { status: 'saved', message: `Price of ${result.updateSkuPrice.sku.code} is now ${result.updateSkuPrice.sku.price.formatted}.` };
  } catch (error) {
    const code = appErrorCode(error);
    if (code === 'FORBIDDEN' || code === 'UNAUTHENTICATED') return { status: 'error', message: 'Only administrators can change prices.' };
    if (code === 'BAD_USER_INPUT') return { status: 'error', message: 'The price is not valid.' };
    throw error;
  }
}
