// Parent object shapes for the GraphQL resolvers (codegen "mappers").
// They are the records the feature queries return; resolvers derive the
// remaining fields through request-scoped DataLoaders.
import type { SessionUser } from '../features/auth/sessions';
import type { AuditEntryRecord } from '../features/audit/queries';
import type { CategoryRecord, ProductRecord, SkuRecord, WarehouseRecord } from '../features/catalog/records';
import type { BalanceRecord, MovementRecord } from '../features/inventory/queries';
import type {
  OrderLineRecord,
  OrderRecord,
  PaymentRecord,
  ReservationRecord,
  ReturnLineRecord,
  ReturnRecord,
  ShipmentRecord,
} from '../features/orders/records';
import type { LowStockRow } from '../features/operations/queries';
import type { JobRow } from '../outbox/outbox';

export type UserModel = SessionUser;
export type CategoryModel = CategoryRecord;
export type WarehouseModel = WarehouseRecord;
export type ProductModel = ProductRecord;
export type SkuModel = SkuRecord;
export type BalanceModel = Omit<BalanceRecord, 'updatedAt'> & { updatedAt: Date };
export type MovementModel = MovementRecord;
export type OrderModel = OrderRecord;
export type OrderLineModel = OrderLineRecord;
export type ReservationModel = ReservationRecord;
export type PaymentModel = PaymentRecord;
export type ShipmentModel = ShipmentRecord;
export type ReturnModel = ReturnRecord;
export type ReturnLineModel = ReturnLineRecord;
export type JobModel = JobRow;
export type AuditEntryModel = AuditEntryRecord;
/** Money travels as integer minor units; Money resolvers add currency and formatting. */
export type MoneyModel = { amountMinor: number };
/** Each OperationsSummary field runs its own query when selected. */
export type OperationsSummaryModel = { now: Date };
export type LowStockModel = LowStockRow;
