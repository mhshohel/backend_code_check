import type { Tx } from '../../db/db';

export type AuditInput = {
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  details: Record<string, unknown>;
  correlationId: string | null;
};

export async function writeAudit(tx: Tx, entry: AuditInput): Promise<void> {
  await tx.query(
    `INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, details, correlation_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [entry.actorUserId, entry.action, entry.entityType, entry.entityId, JSON.stringify(entry.details), entry.correlationId],
  );
}
