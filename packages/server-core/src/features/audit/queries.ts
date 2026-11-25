import type { Queryable } from '../../db/db';
import { assertCursorId, toPage, type Page, type PageRequest } from '../../db/pagination';

export type AuditEntryRecord = {
  id: string;
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  details: unknown;
  correlationId: string | null;
  createdAt: Date;
};

export async function listAuditEntries(db: Queryable, page: PageRequest): Promise<Page<AuditEntryRecord>> {
  assertCursorId(page, 'bigint');
  const result = await db.query<AuditEntryRecord>(
    `SELECT id::text AS id, actor_user_id AS "actorUserId", action, entity_type AS "entityType", entity_id AS "entityId",
            details, correlation_id AS "correlationId", created_at AS "createdAt"
     FROM audit_log WHERE ($1::bigint IS NULL OR id < $1::bigint)
     ORDER BY id DESC LIMIT $2`,
    [page.after?.id ?? null, page.limit + 1],
  );
  return toPage(result.rows, page.limit, (row) => ({ sortKey: row.id, id: row.id }));
}
