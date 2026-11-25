import { z } from 'zod';
import { badInput, type FieldError } from './errors';

// Runtime validation for business inputs. GraphQL already checks types;
// these schemas check ranges, sizes, and formats.

const id = z.uuid({ message: 'Must be a valid ID.' });
const quantity = z.number().int().min(1, 'Must be at least 1.').max(100, 'Must be at most 100.');

export const checkoutInputSchema = z.object({
  idempotencyKey: z.string().trim().min(8, 'Must be at least 8 characters.').max(100),
  lines: z
    .array(
      z.object({
        skuId: id,
        quantity,
        expectedUnitPriceMinor: z.number().int().min(0),
      }),
    )
    .min(1, 'The cart is empty.')
    .max(20, 'A cart can hold at most 20 lines.')
    .refine((lines) => new Set(lines.map((l) => l.skuId)).size === lines.length, 'Each SKU can appear once.'),
  paymentToken: z.enum(['tok_approve', 'tok_decline', 'tok_slow_approve'], { message: 'Unknown payment token.' }),
});
export type CheckoutInput = z.infer<typeof checkoutInputSchema>;

export const requestReturnInputSchema = z.object({
  orderId: id,
  reason: z.string().trim().min(3, 'Give a short reason.').max(500),
  lines: z
    .array(z.object({ orderLineId: id, quantity }))
    .min(1, 'Select at least one item.')
    .refine((lines) => new Set(lines.map((l) => l.orderLineId)).size === lines.length, 'Each line can appear once.'),
});
export type RequestReturnInput = z.infer<typeof requestReturnInputSchema>;

export const adjustInventoryInputSchema = z
  .object({
    skuId: id,
    warehouseId: id,
    kind: z.enum(['RECEIPT', 'ADJUSTMENT']),
    quantityDelta: z.number().int().min(-10000).max(10000).refine((v) => v !== 0, 'Must not be zero.'),
    reason: z.string().trim().min(3, 'Give a short reason.').max(500),
  })
  .refine((input) => input.kind !== 'RECEIPT' || input.quantityDelta > 0, {
    message: 'A receipt must add stock.',
    path: ['quantityDelta'],
  });
export type AdjustInventoryInput = z.infer<typeof adjustInventoryInputSchema>;

export const shipOrderInputSchema = z.object({
  orderId: id,
  warehouseId: id,
  trackingCode: z.string().trim().min(4).max(64).optional().nullable(),
});
export type ShipOrderInput = z.infer<typeof shipOrderInputSchema>;

export const updateSkuPriceInputSchema = z.object({
  skuId: id,
  priceMinor: z.number().int().min(0).max(10_000_000),
});

export const loginInputSchema = z.object({
  email: z.email({ message: 'Enter a valid email address.' }).max(254),
  password: z.string().min(1, 'Enter your password.').max(200),
});
export type LoginInput = z.infer<typeof loginInputSchema>;

export const uuidSchema = id;

/** Parses input or throws BAD_USER_INPUT with one message per invalid field. */
export function parseInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;

  const fieldErrors: FieldError[] = result.error.issues.map((issue) => ({
    path: issue.path.join('.') || '(root)',
    message: issue.message,
  }));
  throw badInput('The input is not valid.', fieldErrors);
}

/** Clamps a connection page size to 1..max. Null or undefined gives the default. */
export function pageSize(first: number | null | undefined, defaultSize = 20, max = 50): number {
  if (first === null || first === undefined) return defaultSize;
  if (!Number.isInteger(first) || first < 1 || first > max) {
    throw badInput(`first must be between 1 and ${max}.`, [{ path: 'first', message: `Must be between 1 and ${max}.` }]);
  }
  return first;
}
