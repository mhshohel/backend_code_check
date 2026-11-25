import { z } from 'zod';
import type { RequestMeta } from '../features/auth/sessions';
import { expireOrderReservations } from '../features/orders/operations';
import { authorizePayment, processRefund, type SideEffectHook } from '../features/payments/processing';
import type { JobRow } from '../outbox/outbox';
import type { Services } from '../services';

export type HandlerResult = { kind: 'done' } | { kind: 'reschedule'; availableAt: Date };

export type JobHandler = (services: Services, job: JobRow, meta: RequestMeta, afterSideEffect: SideEffectHook) => Promise<HandlerResult>;

/** A malformed payload will never succeed on retry. */
export class PermanentJobError extends Error {
  readonly retryable = false;
  constructor(message: string) {
    super(message);
    this.name = 'PermanentJobError';
  }
}

const uuid = z.uuid();

function parsePayload<T>(schema: z.ZodType<T>, value: unknown, topic: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new PermanentJobError(`Invalid ${topic} payload.`);
  return parsed.data;
}

const DONE: HandlerResult = { kind: 'done' };

export const JOB_HANDLERS: Readonly<Record<string, JobHandler>> = {
  'payment.authorize': async (services, job, meta, afterSideEffect) => {
    const { paymentId } = parsePayload(z.object({ paymentId: uuid }), job.payload, job.topic);
    return authorizePayment(services, paymentId, meta, afterSideEffect);
  },
  'reservation.expire': async (services, job, meta) => {
    const orderId = parsePayload(uuid, job.aggregate_id, job.topic);
    await expireOrderReservations(services, orderId, meta);
    return DONE;
  },
  'refund.process': async (services, job, meta, afterSideEffect) => {
    const refundId = parsePayload(uuid, job.aggregate_id, job.topic);
    await processRefund(services, refundId, meta, afterSideEffect);
    return DONE;
  },
  'search.product_changed': async (services, job, _meta, afterSideEffect) => {
    const productId = parsePayload(uuid, job.aggregate_id, job.topic);
    await services.search.indexProducts(services.db, [productId]);
    await afterSideEffect();
    return DONE;
  },
  // The live hint was sent with pg_notify in the business transaction; the
  // row exists for metrics and audit only.
  'order.changed': async () => DONE,
};
