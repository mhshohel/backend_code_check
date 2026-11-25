import type { Queryable } from '../../db/db';

// Simulated payment provider. Its state lives in simulated_gateway_operations
// and the application reaches it only through these two functions, the way
// it would call a real provider's API. Every call is idempotent by key: a
// retry after a crash returns the original result and provider event id.

export type GatewayChargeResult = {
  outcome: 'APPROVED' | 'DECLINED';
  providerEventId: string;
  amountMinor: number;
  declineReason: string | null;
};

export type GatewayRefundResult = { outcome: 'REFUNDED'; providerEventId: string; amountMinor: number };

const DECLINE_REASON = 'card_declined';

export async function gatewayCharge(
  db: Queryable,
  input: { idempotencyKey: string; amountMinor: number; paymentToken: string },
): Promise<GatewayChargeResult> {
  const outcome = input.paymentToken === 'tok_decline' ? 'DECLINED' : 'APPROVED';
  const row = await upsertOperation(db, {
    idempotencyKey: input.idempotencyKey,
    operation: 'CHARGE',
    outcome,
    providerEventId: `evt_charge_${input.idempotencyKey}`,
    amountMinor: input.amountMinor,
  });
  const storedOutcome = row.outcome === 'DECLINED' ? 'DECLINED' : 'APPROVED';
  return {
    outcome: storedOutcome,
    providerEventId: row.provider_event_id,
    amountMinor: row.amount_minor,
    declineReason: storedOutcome === 'DECLINED' ? DECLINE_REASON : null,
  };
}

export async function gatewayRefund(db: Queryable, input: { idempotencyKey: string; amountMinor: number }): Promise<GatewayRefundResult> {
  const row = await upsertOperation(db, {
    idempotencyKey: input.idempotencyKey,
    operation: 'REFUND',
    outcome: 'REFUNDED',
    providerEventId: `evt_refund_${input.idempotencyKey}`,
    amountMinor: input.amountMinor,
  });
  return { outcome: 'REFUNDED', providerEventId: row.provider_event_id, amountMinor: row.amount_minor };
}

type OperationRow = { outcome: string; provider_event_id: string; amount_minor: number };

async function upsertOperation(
  db: Queryable,
  input: { idempotencyKey: string; operation: 'CHARGE' | 'REFUND'; outcome: string; providerEventId: string; amountMinor: number },
): Promise<OperationRow> {
  // DO UPDATE with a no-op assignment makes RETURNING yield the existing row on conflict.
  const result = await db.query<OperationRow>(
    `INSERT INTO simulated_gateway_operations (idempotency_key, operation, outcome, provider_event_id, amount_minor)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (idempotency_key) DO UPDATE SET idempotency_key = EXCLUDED.idempotency_key
     RETURNING outcome, provider_event_id, amount_minor`,
    [input.idempotencyKey, input.operation, input.outcome, input.providerEventId, input.amountMinor],
  );
  const row = result.rows[0];
  if (!row) throw new Error('Gateway operation was not recorded.');
  return row;
}
