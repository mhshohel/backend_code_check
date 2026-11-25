import type { GraphQLResolveInfo, GraphQLScalarType, GraphQLScalarTypeConfig } from 'graphql';
import type { UserModel, CategoryModel, WarehouseModel, ProductModel, SkuModel, BalanceModel, MovementModel, OrderModel, OrderLineModel, ReservationModel, PaymentModel, ShipmentModel, ReturnModel, ReturnLineModel, JobModel, AuditEntryModel, MoneyModel, OperationsSummaryModel, LowStockModel } from '../models';
import type { GraphQLContext } from '../context';
export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type Omit<T, K extends keyof T> = Pick<T, Exclude<keyof T, K>>;
export type RequireFields<T, K extends keyof T> = Omit<T, K> & { [P in K]-?: NonNullable<T[P]> };
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
  /** ISO-8601 timestamp in UTC, for example 2026-11-25T10:00:00.000Z. */
  DateTime: { input: string; output: string; }
};

export type AdjustInventoryInput = {
  kind: StockChangeKind;
  /** RECEIPT requires a positive value. ADJUSTMENT can be negative (shrinkage, damage). */
  quantityDelta: Scalars['Int']['input'];
  reason: Scalars['String']['input'];
  skuId: Scalars['ID']['input'];
  warehouseId: Scalars['ID']['input'];
};

export type AdjustInventoryResult = AdjustmentRejected | InventoryAdjusted;

export type AdjustmentRejected = DomainError & {
  __typename?: 'AdjustmentRejected';
  code: Scalars['String']['output'];
  message: Scalars['String']['output'];
  onHand: Scalars['Int']['output'];
  reserved: Scalars['Int']['output'];
};

export type AuditEntry = {
  __typename?: 'AuditEntry';
  action: Scalars['String']['output'];
  actor?: Maybe<User>;
  correlationId?: Maybe<Scalars['String']['output']>;
  createdAt: Scalars['DateTime']['output'];
  details: Scalars['String']['output'];
  entityId: Scalars['String']['output'];
  entityType: Scalars['String']['output'];
  id: Scalars['ID']['output'];
};

export type AuditEntryConnection = {
  __typename?: 'AuditEntryConnection';
  edges: Array<AuditEntryEdge>;
  pageInfo: PageInfo;
};

export type AuditEntryEdge = {
  __typename?: 'AuditEntryEdge';
  cursor: Scalars['String']['output'];
  node: AuditEntry;
};

export type CancelOrderResult = OrderCancelled | OrderNotCancellable;

export type CancellationReason =
  | 'CUSTOMER_REQUEST'
  | 'OPERATOR_REQUEST'
  | 'PAYMENT_DECLINED'
  | 'RESERVATION_EXPIRED';

export type Category = {
  __typename?: 'Category';
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  slug: Scalars['String']['output'];
};

export type CheckoutInput = {
  /** Client-generated. Retries with the same key return the same result. */
  idempotencyKey: Scalars['String']['input'];
  lines: Array<CheckoutLineInput>;
  /** Simulated card token: tok_approve, tok_decline, or tok_slow_approve. */
  paymentToken: Scalars['String']['input'];
};

export type CheckoutLineInput = {
  /** The price the customer saw. A mismatch returns PriceChanged. */
  expectedUnitPriceMinor: Scalars['Int']['input'];
  quantity: Scalars['Int']['input'];
  skuId: Scalars['ID']['input'];
};

export type CheckoutResult = CheckoutSucceeded | IdempotencyKeyReused | InsufficientStock | PriceChanged;

export type CheckoutSucceeded = {
  __typename?: 'CheckoutSucceeded';
  order: Order;
  /** True when this response replays an earlier request with the same key. */
  replayed: Scalars['Boolean']['output'];
};

export type DailyRevenue = {
  __typename?: 'DailyRevenue';
  /** Running total across the reported window (window function). */
  cumulativeRevenue: Money;
  /** UTC date, YYYY-MM-DD. */
  day: Scalars['String']['output'];
  orders: Scalars['Int']['output'];
  revenue: Money;
};

export type DomainError = {
  code: Scalars['String']['output'];
  message: Scalars['String']['output'];
};

/**
 * Facet bucket. value formats (stable contract):
 * - categories: the category slug.
 * - priceRanges: "<minMinor>-<maxMinor>" in integer minor units, min inclusive,
 *   max exclusive, max empty when open-ended. Buckets: "0-2500", "2500-5000",
 *   "5000-10000", "10000-25000", "25000-". Clients map a selection to
 *   minPriceMinor / maxPriceMinor (maxPriceMinor is exclusive).
 * - availability: "in_stock" | "out_of_stock". "in_stock" maps to inStockOnly: true.
 */
export type FacetBucket = {
  __typename?: 'FacetBucket';
  count: Scalars['Int']['output'];
  label: Scalars['String']['output'];
  selected: Scalars['Boolean']['output'];
  value: Scalars['String']['output'];
};

export type IdempotencyKeyReused = DomainError & {
  __typename?: 'IdempotencyKeyReused';
  code: Scalars['String']['output'];
  message: Scalars['String']['output'];
};

export type InsufficientStock = DomainError & {
  __typename?: 'InsufficientStock';
  code: Scalars['String']['output'];
  lines: Array<InsufficientStockLine>;
  message: Scalars['String']['output'];
};

export type InsufficientStockLine = {
  __typename?: 'InsufficientStockLine';
  available: Scalars['Int']['output'];
  requested: Scalars['Int']['output'];
  skuId: Scalars['ID']['output'];
};

export type InventoryAdjusted = {
  __typename?: 'InventoryAdjusted';
  balance: InventoryBalance;
  movement: InventoryMovement;
};

export type InventoryBalance = {
  __typename?: 'InventoryBalance';
  available: Scalars['Int']['output'];
  onHand: Scalars['Int']['output'];
  reserved: Scalars['Int']['output'];
  sku: Sku;
  updatedAt: Scalars['DateTime']['output'];
  warehouse: Warehouse;
};

export type InventoryBalanceConnection = {
  __typename?: 'InventoryBalanceConnection';
  edges: Array<InventoryBalanceEdge>;
  pageInfo: PageInfo;
};

export type InventoryBalanceEdge = {
  __typename?: 'InventoryBalanceEdge';
  cursor: Scalars['String']['output'];
  node: InventoryBalance;
};

export type InventoryMovement = {
  __typename?: 'InventoryMovement';
  actor?: Maybe<User>;
  createdAt: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  kind: InventoryMovementKind;
  onHandDelta: Scalars['Int']['output'];
  reason?: Maybe<Scalars['String']['output']>;
  referenceId?: Maybe<Scalars['ID']['output']>;
  referenceType?: Maybe<Scalars['String']['output']>;
  reservedDelta: Scalars['Int']['output'];
  sku: Sku;
  warehouse: Warehouse;
};

export type InventoryMovementConnection = {
  __typename?: 'InventoryMovementConnection';
  edges: Array<InventoryMovementEdge>;
  pageInfo: PageInfo;
};

export type InventoryMovementEdge = {
  __typename?: 'InventoryMovementEdge';
  cursor: Scalars['String']['output'];
  node: InventoryMovement;
};

export type InventoryMovementKind =
  | 'ADJUSTMENT'
  | 'RECEIPT'
  | 'RELEASE'
  | 'RESERVE'
  | 'RETURN_RESTOCK'
  | 'SHIP';

export type Job = {
  __typename?: 'Job';
  aggregateId: Scalars['String']['output'];
  aggregateType: Scalars['String']['output'];
  attempts: Scalars['Int']['output'];
  availableAt: Scalars['DateTime']['output'];
  createdAt: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  lastError?: Maybe<Scalars['String']['output']>;
  maxAttempts: Scalars['Int']['output'];
  status: JobStatus;
  topic: Scalars['String']['output'];
};

export type JobConnection = {
  __typename?: 'JobConnection';
  edges: Array<JobEdge>;
  pageInfo: PageInfo;
};

export type JobEdge = {
  __typename?: 'JobEdge';
  cursor: Scalars['String']['output'];
  node: Job;
};

export type JobNotRetryable = DomainError & {
  __typename?: 'JobNotRetryable';
  code: Scalars['String']['output'];
  message: Scalars['String']['output'];
  status: JobStatus;
};

export type JobRetried = {
  __typename?: 'JobRetried';
  job: Job;
};

export type JobStatus =
  | 'DONE'
  | 'FAILED'
  | 'PENDING'
  | 'PROCESSING';

export type LowStockItem = {
  __typename?: 'LowStockItem';
  available: Scalars['Int']['output'];
  sku: Sku;
  warehouse: Warehouse;
};

/** Money in integer minor units (cents). The lab uses one currency: USD. */
export type Money = {
  __typename?: 'Money';
  amountMinor: Scalars['Int']['output'];
  currency: Scalars['String']['output'];
  /** Display string such as $12.50. Formatting only; never parse it. */
  formatted: Scalars['String']['output'];
};

export type Mutation = {
  __typename?: 'Mutation';
  /** Operator. */
  adjustInventory: AdjustInventoryResult;
  /** Owner (PENDING_PAYMENT or CONFIRMED, no shipments) or operator. */
  cancelOrder: CancelOrderResult;
  /** Customer. Validates prices, reserves stock atomically, starts simulated payment. */
  checkout: CheckoutResult;
  /** Operator. Restocks returned units once and starts the simulated refund. */
  receiveReturn: ReceiveReturnResult;
  /** Owner. Partial returns are allowed up to the shipped, not yet returned quantity. */
  requestReturn: RequestReturnResult;
  /** Administrator. Moves a FAILED job back to PENDING. */
  retryJob: RetryJobResult;
  /** Operator. Ships every confirmed reservation of the order in one warehouse. */
  shipOrder: ShipOrderResult;
  /** Administrator. */
  updateSkuPrice: UpdateSkuPriceResult;
};


export type MutationAdjustInventoryArgs = {
  input: AdjustInventoryInput;
};


export type MutationCancelOrderArgs = {
  orderId: Scalars['ID']['input'];
};


export type MutationCheckoutArgs = {
  input: CheckoutInput;
};


export type MutationReceiveReturnArgs = {
  returnId: Scalars['ID']['input'];
};


export type MutationRequestReturnArgs = {
  input: RequestReturnInput;
};


export type MutationRetryJobArgs = {
  jobId: Scalars['ID']['input'];
};


export type MutationShipOrderArgs = {
  input: ShipOrderInput;
};


export type MutationUpdateSkuPriceArgs = {
  input: UpdateSkuPriceInput;
};

export type NothingToShip = DomainError & {
  __typename?: 'NothingToShip';
  code: Scalars['String']['output'];
  message: Scalars['String']['output'];
};

export type OperationsSummary = {
  __typename?: 'OperationsSummary';
  dailyRevenue: Array<DailyRevenue>;
  expiredActiveReservations: Scalars['Int']['output'];
  failedJobs: Scalars['Int']['output'];
  lowStock: Array<LowStockItem>;
  /** Age in seconds of the oldest claimable job; 0 when the backlog is empty. */
  oldestPendingJobAgeSeconds: Scalars['Int']['output'];
  ordersByStatus: Array<OrderStatusCount>;
  pendingJobs: Scalars['Int']['output'];
};


export type OperationsSummaryDailyRevenueArgs = {
  days?: InputMaybe<Scalars['Int']['input']>;
};


export type OperationsSummaryLowStockArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  threshold?: InputMaybe<Scalars['Int']['input']>;
};

export type Order = {
  __typename?: 'Order';
  /** Computed on the server from the order state and the viewer's role. */
  allowedActions: OrderActions;
  cancellationReason?: Maybe<CancellationReason>;
  createdAt: Scalars['DateTime']['output'];
  customer: User;
  id: Scalars['ID']['output'];
  lines: Array<OrderLine>;
  /** Human-readable number, for example ORD-100042. */
  number: Scalars['String']['output'];
  payment?: Maybe<Payment>;
  reservationExpiresAt: Scalars['DateTime']['output'];
  reservations: Array<Reservation>;
  returns: Array<Return>;
  shipments: Array<Shipment>;
  status: OrderStatus;
  subtotal: Money;
  total: Money;
  updatedAt: Scalars['DateTime']['output'];
};

export type OrderActions = {
  __typename?: 'OrderActions';
  canCancel: Scalars['Boolean']['output'];
  canRequestReturn: Scalars['Boolean']['output'];
  /** Returns in REQUESTED status that the viewer may receive (operators only; empty for customers). */
  receivableReturnIds: Array<Scalars['ID']['output']>;
  /** Warehouses that have confirmed, unshipped reservations (operators only). */
  shippableWarehouses: Array<Warehouse>;
};

export type OrderCancelled = {
  __typename?: 'OrderCancelled';
  order: Order;
};

export type OrderConnection = {
  __typename?: 'OrderConnection';
  edges: Array<OrderEdge>;
  pageInfo: PageInfo;
};

export type OrderEdge = {
  __typename?: 'OrderEdge';
  cursor: Scalars['String']['output'];
  node: Order;
};

export type OrderFilter = {
  /** Operators only: orders with confirmed, unshipped reservations in this warehouse. */
  awaitingShipmentFromWarehouseId?: InputMaybe<Scalars['ID']['input']>;
  status?: InputMaybe<Array<OrderStatus>>;
  /** Operators only: orders with at least one return in REQUESTED status. */
  withReturnsAwaitingReceipt?: InputMaybe<Scalars['Boolean']['input']>;
};

export type OrderLine = {
  __typename?: 'OrderLine';
  id: Scalars['ID']['output'];
  lineNumber: Scalars['Int']['output'];
  lineTotal: Money;
  productName: Scalars['String']['output'];
  quantity: Scalars['Int']['output'];
  /** shippedQuantity minus quantity on returns (any status). */
  returnableQuantity: Scalars['Int']['output'];
  returnedQuantity: Scalars['Int']['output'];
  shippedQuantity: Scalars['Int']['output'];
  sku: Sku;
  skuCode: Scalars['String']['output'];
  unitPrice: Money;
};

export type OrderNotCancellable = DomainError & {
  __typename?: 'OrderNotCancellable';
  code: Scalars['String']['output'];
  message: Scalars['String']['output'];
  status: OrderStatus;
};

export type OrderNotReturnable = DomainError & {
  __typename?: 'OrderNotReturnable';
  code: Scalars['String']['output'];
  message: Scalars['String']['output'];
  status: OrderStatus;
};

export type OrderNotShippable = DomainError & {
  __typename?: 'OrderNotShippable';
  code: Scalars['String']['output'];
  message: Scalars['String']['output'];
  status: OrderStatus;
};

export type OrderStatus =
  | 'CANCELLED'
  | 'CONFIRMED'
  | 'PARTIALLY_SHIPPED'
  | 'PENDING_PAYMENT'
  | 'SHIPPED';

export type OrderStatusCount = {
  __typename?: 'OrderStatusCount';
  count: Scalars['Int']['output'];
  status: OrderStatus;
};

export type OrderStatusEvent = {
  __typename?: 'OrderStatusEvent';
  occurredAt: Scalars['DateTime']['output'];
  /** Always re-read from PostgreSQL after the notification. */
  order: Order;
};

export type PageInfo = {
  __typename?: 'PageInfo';
  endCursor?: Maybe<Scalars['String']['output']>;
  hasNextPage: Scalars['Boolean']['output'];
};

export type Payment = {
  __typename?: 'Payment';
  amount: Money;
  declineReason?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  refunded: Money;
  status: PaymentStatus;
};

export type PaymentStatus =
  | 'CAPTURED'
  | 'DECLINED'
  | 'PARTIALLY_REFUNDED'
  | 'PENDING'
  | 'REFUNDED';

export type PriceChanged = DomainError & {
  __typename?: 'PriceChanged';
  code: Scalars['String']['output'];
  lines: Array<PriceChangedLine>;
  message: Scalars['String']['output'];
};

export type PriceChangedLine = {
  __typename?: 'PriceChangedLine';
  currentUnitPrice: Money;
  expectedUnitPriceMinor: Scalars['Int']['output'];
  skuId: Scalars['ID']['output'];
};

export type Product = {
  __typename?: 'Product';
  /** Sum of available units across all SKUs and warehouses (PostgreSQL, authoritative). */
  availableQuantity: Scalars['Int']['output'];
  category: Category;
  description: Scalars['String']['output'];
  /** Lowest active SKU price. */
  fromPrice: Money;
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  skus: Array<Sku>;
  slug: Scalars['String']['output'];
};

export type ProductSearchConnection = {
  __typename?: 'ProductSearchConnection';
  edges: Array<ProductSearchEdge>;
  facets: SearchFacets;
  pageInfo: PageInfo;
  /** Exact up to 10000, then a lower bound. */
  totalCount: Scalars['Int']['output'];
};

export type ProductSearchEdge = {
  __typename?: 'ProductSearchEdge';
  cursor: Scalars['String']['output'];
  node: ProductSearchHit;
};

export type ProductSearchHit = {
  __typename?: 'ProductSearchHit';
  categoryName: Scalars['String']['output'];
  categorySlug: Scalars['String']['output'];
  fromPrice: Money;
  /** Snapshot from the search index. Checkout always rechecks PostgreSQL. */
  inStock: Scalars['Boolean']['output'];
  name: Scalars['String']['output'];
  productId: Scalars['ID']['output'];
  score?: Maybe<Scalars['Float']['output']>;
  slug: Scalars['String']['output'];
};

export type ProductSearchInput = {
  categorySlugs?: InputMaybe<Array<Scalars['String']['input']>>;
  inStockOnly?: InputMaybe<Scalars['Boolean']['input']>;
  /** Exclusive. */
  maxPriceMinor?: InputMaybe<Scalars['Int']['input']>;
  /** Inclusive. */
  minPriceMinor?: InputMaybe<Scalars['Int']['input']>;
  sort?: InputMaybe<ProductSort>;
  /** Free text. Empty means match all. */
  text?: InputMaybe<Scalars['String']['input']>;
};

export type ProductSort =
  | 'NEWEST'
  | 'PRICE_ASC'
  | 'PRICE_DESC'
  | 'RELEVANCE';

export type ProductSuggestion = {
  __typename?: 'ProductSuggestion';
  name: Scalars['String']['output'];
  productId: Scalars['ID']['output'];
  slug: Scalars['String']['output'];
};

export type Query = {
  __typename?: 'Query';
  /** Administrator. */
  auditLog: AuditEntryConnection;
  categories: Array<Category>;
  /** Operator or administrator. */
  inventory: InventoryBalanceConnection;
  /** Operator or administrator. Newest first. */
  inventoryMovements: InventoryMovementConnection;
  /** Administrator. */
  jobs: JobConnection;
  /** Orders of the signed-in customer, newest first. first is limited to 1..50. */
  myOrders: OrderConnection;
  /** Administrator. */
  operationsSummary: OperationsSummary;
  /** Owner, operator, or administrator. NOT_FOUND for other customers. */
  order?: Maybe<Order>;
  /** Operator or administrator. All orders, newest first. */
  orders: OrderConnection;
  product?: Maybe<Product>;
  /** Elasticsearch autocomplete. limit is limited to 1..10. */
  productSuggestions: Array<ProductSuggestion>;
  /** Elasticsearch. first is limited to 1..50. */
  searchProducts: ProductSearchConnection;
  /** Null when not signed in. */
  viewer?: Maybe<User>;
  warehouses: Array<Warehouse>;
};


export type QueryAuditLogArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
};


export type QueryInventoryArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  lowStockOnly?: InputMaybe<Scalars['Boolean']['input']>;
  warehouseId?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryInventoryMovementsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  skuId: Scalars['ID']['input'];
  warehouseId?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryJobsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  status?: InputMaybe<JobStatus>;
};


export type QueryMyOrdersArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  filter?: InputMaybe<OrderFilter>;
  first?: InputMaybe<Scalars['Int']['input']>;
};


export type QueryOrderArgs = {
  id: Scalars['ID']['input'];
};


export type QueryOrdersArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  filter?: InputMaybe<OrderFilter>;
  first?: InputMaybe<Scalars['Int']['input']>;
};


export type QueryProductArgs = {
  slug: Scalars['String']['input'];
};


export type QueryProductSuggestionsArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  prefix: Scalars['String']['input'];
};


export type QuerySearchProductsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  input?: InputMaybe<ProductSearchInput>;
};

export type ReceiveReturnResult = ReturnNotReceivable | ReturnReceived;

export type RequestReturnInput = {
  lines: Array<ReturnLineInput>;
  orderId: Scalars['ID']['input'];
  reason: Scalars['String']['input'];
};

export type RequestReturnResult = OrderNotReturnable | ReturnQuantityExceeded | ReturnRequested;

export type Reservation = {
  __typename?: 'Reservation';
  expiresAt: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  quantity: Scalars['Int']['output'];
  sku: Sku;
  status: ReservationStatus;
  warehouse: Warehouse;
};

export type ReservationStatus =
  | 'ACTIVE'
  | 'CONFIRMED'
  | 'RELEASED'
  | 'SHIPPED';

export type RetryJobResult = JobNotRetryable | JobRetried;

export type Return = {
  __typename?: 'Return';
  createdAt: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  lines: Array<ReturnLine>;
  reason: Scalars['String']['output'];
  receivedAt?: Maybe<Scalars['DateTime']['output']>;
  refund: Money;
  refundedAt?: Maybe<Scalars['DateTime']['output']>;
  status: ReturnStatus;
};

export type ReturnLine = {
  __typename?: 'ReturnLine';
  orderLineId: Scalars['ID']['output'];
  quantity: Scalars['Int']['output'];
  skuCode: Scalars['String']['output'];
  warehouse: Warehouse;
};

export type ReturnLineInput = {
  orderLineId: Scalars['ID']['input'];
  quantity: Scalars['Int']['input'];
};

export type ReturnNotReceivable = DomainError & {
  __typename?: 'ReturnNotReceivable';
  code: Scalars['String']['output'];
  message: Scalars['String']['output'];
  status: ReturnStatus;
};

export type ReturnQuantityExceeded = DomainError & {
  __typename?: 'ReturnQuantityExceeded';
  code: Scalars['String']['output'];
  lines: Array<ReturnQuantityExceededLine>;
  message: Scalars['String']['output'];
};

export type ReturnQuantityExceededLine = {
  __typename?: 'ReturnQuantityExceededLine';
  orderLineId: Scalars['ID']['output'];
  requested: Scalars['Int']['output'];
  returnable: Scalars['Int']['output'];
};

export type ReturnReceived = {
  __typename?: 'ReturnReceived';
  order: Order;
  return: Return;
};

export type ReturnRequested = {
  __typename?: 'ReturnRequested';
  order: Order;
  return: Return;
};

export type ReturnStatus =
  | 'RECEIVED'
  | 'REFUNDED'
  | 'REQUESTED';

export type Role =
  | 'ADMIN'
  | 'CUSTOMER'
  | 'OPERATOR';

/**
 * Facet counts. For each dimension, counts apply every active filter except
 * the filter of that same dimension (disjunctive faceting), so users can see
 * how many results another choice in the same group would give.
 */
export type SearchFacets = {
  __typename?: 'SearchFacets';
  availability: Array<FacetBucket>;
  categories: Array<FacetBucket>;
  priceRanges: Array<FacetBucket>;
};

export type ShipOrderInput = {
  orderId: Scalars['ID']['input'];
  trackingCode?: InputMaybe<Scalars['String']['input']>;
  warehouseId: Scalars['ID']['input'];
};

export type ShipOrderResult = NothingToShip | OrderNotShippable | ShipmentCreated;

export type Shipment = {
  __typename?: 'Shipment';
  id: Scalars['ID']['output'];
  lines: Array<ShipmentLine>;
  shippedAt: Scalars['DateTime']['output'];
  trackingCode: Scalars['String']['output'];
  warehouse: Warehouse;
};

export type ShipmentCreated = {
  __typename?: 'ShipmentCreated';
  order: Order;
  shipment: Shipment;
};

export type ShipmentLine = {
  __typename?: 'ShipmentLine';
  orderLineId: Scalars['ID']['output'];
  quantity: Scalars['Int']['output'];
  skuCode: Scalars['String']['output'];
};

export type Sku = {
  __typename?: 'Sku';
  availableQuantity: Scalars['Int']['output'];
  code: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  label: Scalars['String']['output'];
  price: Money;
  product: Product;
  /** Per-warehouse availability. Read from PostgreSQL. */
  stock: Array<StockLevel>;
};

export type SkuPriceUpdated = {
  __typename?: 'SkuPriceUpdated';
  sku: Sku;
};

export type StockChangeKind =
  | 'ADJUSTMENT'
  | 'RECEIPT';

export type StockLevel = {
  __typename?: 'StockLevel';
  available: Scalars['Int']['output'];
  onHand: Scalars['Int']['output'];
  reserved: Scalars['Int']['output'];
  warehouse: Warehouse;
};

export type Subscription = {
  __typename?: 'Subscription';
  /** Owner, operator, or administrator. Emits the current order once on subscribe, then on every change. */
  orderUpdated: OrderStatusEvent;
};


export type SubscriptionOrderUpdatedArgs = {
  orderId: Scalars['ID']['input'];
};

export type UpdateSkuPriceInput = {
  priceMinor: Scalars['Int']['input'];
  skuId: Scalars['ID']['input'];
};

export type UpdateSkuPriceResult = SkuPriceUpdated;

export type User = {
  __typename?: 'User';
  displayName: Scalars['String']['output'];
  email: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  role: Role;
};

export type Warehouse = {
  __typename?: 'Warehouse';
  code: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
};



export type ResolverTypeWrapper<T> = Promise<T> | T;


export type ResolverWithResolve<TResult, TParent, TContext, TArgs> = {
  resolve: ResolverFn<TResult, TParent, TContext, TArgs>;
};
export type Resolver<TResult, TParent = Record<PropertyKey, never>, TContext = Record<PropertyKey, never>, TArgs = Record<PropertyKey, never>> = ResolverFn<TResult, TParent, TContext, TArgs> | ResolverWithResolve<TResult, TParent, TContext, TArgs>;

export type ResolverFn<TResult, TParent, TContext, TArgs> = (
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => Promise<TResult> | TResult;

export type SubscriptionSubscribeFn<TResult, TParent, TContext, TArgs> = (
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => AsyncIterable<TResult> | Promise<AsyncIterable<TResult>>;

export type SubscriptionResolveFn<TResult, TParent, TContext, TArgs> = (
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => TResult | Promise<TResult>;

export interface SubscriptionSubscriberObject<TResult, TKey extends string, TParent, TContext, TArgs> {
  subscribe: SubscriptionSubscribeFn<{ [key in TKey]: TResult }, TParent, TContext, TArgs>;
  resolve?: SubscriptionResolveFn<TResult, { [key in TKey]: TResult }, TContext, TArgs>;
}

export interface SubscriptionResolverObject<TResult, TParent, TContext, TArgs> {
  subscribe: SubscriptionSubscribeFn<any, TParent, TContext, TArgs>;
  resolve: SubscriptionResolveFn<TResult, any, TContext, TArgs>;
}

export type SubscriptionObject<TResult, TKey extends string, TParent, TContext, TArgs> =
  | SubscriptionSubscriberObject<TResult, TKey, TParent, TContext, TArgs>
  | SubscriptionResolverObject<TResult, TParent, TContext, TArgs>;

export type SubscriptionResolver<TResult, TKey extends string, TParent = Record<PropertyKey, never>, TContext = Record<PropertyKey, never>, TArgs = Record<PropertyKey, never>> =
  | ((...args: any[]) => SubscriptionObject<TResult, TKey, TParent, TContext, TArgs>)
  | SubscriptionObject<TResult, TKey, TParent, TContext, TArgs>;

export type TypeResolveFn<TTypes, TParent = Record<PropertyKey, never>, TContext = Record<PropertyKey, never>> = (
  parent: TParent,
  context: TContext,
  info: GraphQLResolveInfo
) => Maybe<TTypes> | Promise<Maybe<TTypes>>;

export type IsTypeOfResolverFn<T = Record<PropertyKey, never>, TContext = Record<PropertyKey, never>> = (obj: T, context: TContext, info: GraphQLResolveInfo) => boolean | Promise<boolean>;

export type NextResolverFn<T> = () => Promise<T>;

export type DirectiveResolverFn<TResult = Record<PropertyKey, never>, TParent = Record<PropertyKey, never>, TContext = Record<PropertyKey, never>, TArgs = Record<PropertyKey, never>> = (
  next: NextResolverFn<TResult>,
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => TResult | Promise<TResult>;



/** Mapping of union types */
export type ResolversUnionTypes<_RefType extends Record<string, unknown>> = {
  AdjustInventoryResult:
    | ( AdjustmentRejected )
    | ( Omit<InventoryAdjusted, 'balance' | 'movement'> & { balance: _RefType['InventoryBalance'], movement: _RefType['InventoryMovement'] } )
  ;
  CancelOrderResult:
    | ( Omit<OrderCancelled, 'order'> & { order: _RefType['Order'] } )
    | ( OrderNotCancellable )
  ;
  CheckoutResult:
    | ( Omit<CheckoutSucceeded, 'order'> & { order: _RefType['Order'] } )
    | ( IdempotencyKeyReused )
    | ( InsufficientStock )
    | ( Omit<PriceChanged, 'lines'> & { lines: Array<_RefType['PriceChangedLine']> } )
  ;
  ReceiveReturnResult:
    | ( ReturnNotReceivable )
    | ( Omit<ReturnReceived, 'order' | 'return'> & { order: _RefType['Order'], return: _RefType['Return'] } )
  ;
  RequestReturnResult:
    | ( OrderNotReturnable )
    | ( ReturnQuantityExceeded )
    | ( Omit<ReturnRequested, 'order' | 'return'> & { order: _RefType['Order'], return: _RefType['Return'] } )
  ;
  RetryJobResult:
    | ( JobNotRetryable )
    | ( Omit<JobRetried, 'job'> & { job: _RefType['Job'] } )
  ;
  ShipOrderResult:
    | ( NothingToShip )
    | ( OrderNotShippable )
    | ( Omit<ShipmentCreated, 'order' | 'shipment'> & { order: _RefType['Order'], shipment: _RefType['Shipment'] } )
  ;
  UpdateSkuPriceResult: ( Omit<SkuPriceUpdated, 'sku'> & { sku: _RefType['Sku'] } );
};

/** Mapping of interface types */
export type ResolversInterfaceTypes<_RefType extends Record<string, unknown>> = {
  DomainError:
    | ( AdjustmentRejected )
    | ( IdempotencyKeyReused )
    | ( InsufficientStock )
    | ( JobNotRetryable )
    | ( NothingToShip )
    | ( OrderNotCancellable )
    | ( OrderNotReturnable )
    | ( OrderNotShippable )
    | ( Omit<PriceChanged, 'lines'> & { lines: Array<_RefType['PriceChangedLine']> } )
    | ( ReturnNotReceivable )
    | ( ReturnQuantityExceeded )
  ;
};

/** Mapping between all available schema types and the resolvers types */
export type ResolversTypes = {
  AdjustInventoryInput: AdjustInventoryInput;
  AdjustInventoryResult: ResolverTypeWrapper<ResolversUnionTypes<ResolversTypes>['AdjustInventoryResult']>;
  AdjustmentRejected: ResolverTypeWrapper<AdjustmentRejected>;
  AuditEntry: ResolverTypeWrapper<AuditEntryModel>;
  AuditEntryConnection: ResolverTypeWrapper<Omit<AuditEntryConnection, 'edges'> & { edges: Array<ResolversTypes['AuditEntryEdge']> }>;
  AuditEntryEdge: ResolverTypeWrapper<Omit<AuditEntryEdge, 'node'> & { node: ResolversTypes['AuditEntry'] }>;
  Boolean: ResolverTypeWrapper<Scalars['Boolean']['output']>;
  CancelOrderResult: ResolverTypeWrapper<ResolversUnionTypes<ResolversTypes>['CancelOrderResult']>;
  CancellationReason: CancellationReason;
  Category: ResolverTypeWrapper<CategoryModel>;
  CheckoutInput: CheckoutInput;
  CheckoutLineInput: CheckoutLineInput;
  CheckoutResult: ResolverTypeWrapper<ResolversUnionTypes<ResolversTypes>['CheckoutResult']>;
  CheckoutSucceeded: ResolverTypeWrapper<Omit<CheckoutSucceeded, 'order'> & { order: ResolversTypes['Order'] }>;
  DailyRevenue: ResolverTypeWrapper<Omit<DailyRevenue, 'cumulativeRevenue' | 'revenue'> & { cumulativeRevenue: ResolversTypes['Money'], revenue: ResolversTypes['Money'] }>;
  DateTime: ResolverTypeWrapper<Scalars['DateTime']['output']>;
  DomainError: ResolverTypeWrapper<ResolversInterfaceTypes<ResolversTypes>['DomainError']>;
  FacetBucket: ResolverTypeWrapper<FacetBucket>;
  Float: ResolverTypeWrapper<Scalars['Float']['output']>;
  ID: ResolverTypeWrapper<Scalars['ID']['output']>;
  IdempotencyKeyReused: ResolverTypeWrapper<IdempotencyKeyReused>;
  InsufficientStock: ResolverTypeWrapper<InsufficientStock>;
  InsufficientStockLine: ResolverTypeWrapper<InsufficientStockLine>;
  Int: ResolverTypeWrapper<Scalars['Int']['output']>;
  InventoryAdjusted: ResolverTypeWrapper<Omit<InventoryAdjusted, 'balance' | 'movement'> & { balance: ResolversTypes['InventoryBalance'], movement: ResolversTypes['InventoryMovement'] }>;
  InventoryBalance: ResolverTypeWrapper<BalanceModel>;
  InventoryBalanceConnection: ResolverTypeWrapper<Omit<InventoryBalanceConnection, 'edges'> & { edges: Array<ResolversTypes['InventoryBalanceEdge']> }>;
  InventoryBalanceEdge: ResolverTypeWrapper<Omit<InventoryBalanceEdge, 'node'> & { node: ResolversTypes['InventoryBalance'] }>;
  InventoryMovement: ResolverTypeWrapper<MovementModel>;
  InventoryMovementConnection: ResolverTypeWrapper<Omit<InventoryMovementConnection, 'edges'> & { edges: Array<ResolversTypes['InventoryMovementEdge']> }>;
  InventoryMovementEdge: ResolverTypeWrapper<Omit<InventoryMovementEdge, 'node'> & { node: ResolversTypes['InventoryMovement'] }>;
  InventoryMovementKind: InventoryMovementKind;
  Job: ResolverTypeWrapper<JobModel>;
  JobConnection: ResolverTypeWrapper<Omit<JobConnection, 'edges'> & { edges: Array<ResolversTypes['JobEdge']> }>;
  JobEdge: ResolverTypeWrapper<Omit<JobEdge, 'node'> & { node: ResolversTypes['Job'] }>;
  JobNotRetryable: ResolverTypeWrapper<JobNotRetryable>;
  JobRetried: ResolverTypeWrapper<Omit<JobRetried, 'job'> & { job: ResolversTypes['Job'] }>;
  JobStatus: JobStatus;
  LowStockItem: ResolverTypeWrapper<LowStockModel>;
  Money: ResolverTypeWrapper<MoneyModel>;
  Mutation: ResolverTypeWrapper<Record<PropertyKey, never>>;
  NothingToShip: ResolverTypeWrapper<NothingToShip>;
  OperationsSummary: ResolverTypeWrapper<OperationsSummaryModel>;
  Order: ResolverTypeWrapper<OrderModel>;
  OrderActions: ResolverTypeWrapper<Omit<OrderActions, 'shippableWarehouses'> & { shippableWarehouses: Array<ResolversTypes['Warehouse']> }>;
  OrderCancelled: ResolverTypeWrapper<Omit<OrderCancelled, 'order'> & { order: ResolversTypes['Order'] }>;
  OrderConnection: ResolverTypeWrapper<Omit<OrderConnection, 'edges'> & { edges: Array<ResolversTypes['OrderEdge']> }>;
  OrderEdge: ResolverTypeWrapper<Omit<OrderEdge, 'node'> & { node: ResolversTypes['Order'] }>;
  OrderFilter: OrderFilter;
  OrderLine: ResolverTypeWrapper<OrderLineModel>;
  OrderNotCancellable: ResolverTypeWrapper<OrderNotCancellable>;
  OrderNotReturnable: ResolverTypeWrapper<OrderNotReturnable>;
  OrderNotShippable: ResolverTypeWrapper<OrderNotShippable>;
  OrderStatus: OrderStatus;
  OrderStatusCount: ResolverTypeWrapper<OrderStatusCount>;
  OrderStatusEvent: ResolverTypeWrapper<Omit<OrderStatusEvent, 'order'> & { order: ResolversTypes['Order'] }>;
  PageInfo: ResolverTypeWrapper<PageInfo>;
  Payment: ResolverTypeWrapper<PaymentModel>;
  PaymentStatus: PaymentStatus;
  PriceChanged: ResolverTypeWrapper<Omit<PriceChanged, 'lines'> & { lines: Array<ResolversTypes['PriceChangedLine']> }>;
  PriceChangedLine: ResolverTypeWrapper<Omit<PriceChangedLine, 'currentUnitPrice'> & { currentUnitPrice: ResolversTypes['Money'] }>;
  Product: ResolverTypeWrapper<ProductModel>;
  ProductSearchConnection: ResolverTypeWrapper<Omit<ProductSearchConnection, 'edges'> & { edges: Array<ResolversTypes['ProductSearchEdge']> }>;
  ProductSearchEdge: ResolverTypeWrapper<Omit<ProductSearchEdge, 'node'> & { node: ResolversTypes['ProductSearchHit'] }>;
  ProductSearchHit: ResolverTypeWrapper<Omit<ProductSearchHit, 'fromPrice'> & { fromPrice: ResolversTypes['Money'] }>;
  ProductSearchInput: ProductSearchInput;
  ProductSort: ProductSort;
  ProductSuggestion: ResolverTypeWrapper<ProductSuggestion>;
  Query: ResolverTypeWrapper<Record<PropertyKey, never>>;
  ReceiveReturnResult: ResolverTypeWrapper<ResolversUnionTypes<ResolversTypes>['ReceiveReturnResult']>;
  RequestReturnInput: RequestReturnInput;
  RequestReturnResult: ResolverTypeWrapper<ResolversUnionTypes<ResolversTypes>['RequestReturnResult']>;
  Reservation: ResolverTypeWrapper<ReservationModel>;
  ReservationStatus: ReservationStatus;
  RetryJobResult: ResolverTypeWrapper<ResolversUnionTypes<ResolversTypes>['RetryJobResult']>;
  Return: ResolverTypeWrapper<ReturnModel>;
  ReturnLine: ResolverTypeWrapper<ReturnLineModel>;
  ReturnLineInput: ReturnLineInput;
  ReturnNotReceivable: ResolverTypeWrapper<ReturnNotReceivable>;
  ReturnQuantityExceeded: ResolverTypeWrapper<ReturnQuantityExceeded>;
  ReturnQuantityExceededLine: ResolverTypeWrapper<ReturnQuantityExceededLine>;
  ReturnReceived: ResolverTypeWrapper<Omit<ReturnReceived, 'order' | 'return'> & { order: ResolversTypes['Order'], return: ResolversTypes['Return'] }>;
  ReturnRequested: ResolverTypeWrapper<Omit<ReturnRequested, 'order' | 'return'> & { order: ResolversTypes['Order'], return: ResolversTypes['Return'] }>;
  ReturnStatus: ReturnStatus;
  Role: Role;
  SearchFacets: ResolverTypeWrapper<SearchFacets>;
  ShipOrderInput: ShipOrderInput;
  ShipOrderResult: ResolverTypeWrapper<ResolversUnionTypes<ResolversTypes>['ShipOrderResult']>;
  Shipment: ResolverTypeWrapper<ShipmentModel>;
  ShipmentCreated: ResolverTypeWrapper<Omit<ShipmentCreated, 'order' | 'shipment'> & { order: ResolversTypes['Order'], shipment: ResolversTypes['Shipment'] }>;
  ShipmentLine: ResolverTypeWrapper<ShipmentLine>;
  Sku: ResolverTypeWrapper<SkuModel>;
  SkuPriceUpdated: ResolverTypeWrapper<Omit<SkuPriceUpdated, 'sku'> & { sku: ResolversTypes['Sku'] }>;
  StockChangeKind: StockChangeKind;
  StockLevel: ResolverTypeWrapper<BalanceModel>;
  String: ResolverTypeWrapper<Scalars['String']['output']>;
  Subscription: ResolverTypeWrapper<Record<PropertyKey, never>>;
  UpdateSkuPriceInput: UpdateSkuPriceInput;
  UpdateSkuPriceResult: ResolverTypeWrapper<ResolversUnionTypes<ResolversTypes>['UpdateSkuPriceResult']>;
  User: ResolverTypeWrapper<UserModel>;
  Warehouse: ResolverTypeWrapper<WarehouseModel>;
};

/** Mapping between all available schema types and the resolvers parents */
export type ResolversParentTypes = {
  AdjustInventoryInput: AdjustInventoryInput;
  AdjustInventoryResult: ResolversUnionTypes<ResolversParentTypes>['AdjustInventoryResult'];
  AdjustmentRejected: AdjustmentRejected;
  AuditEntry: AuditEntryModel;
  AuditEntryConnection: Omit<AuditEntryConnection, 'edges'> & { edges: Array<ResolversParentTypes['AuditEntryEdge']> };
  AuditEntryEdge: Omit<AuditEntryEdge, 'node'> & { node: ResolversParentTypes['AuditEntry'] };
  Boolean: Scalars['Boolean']['output'];
  CancelOrderResult: ResolversUnionTypes<ResolversParentTypes>['CancelOrderResult'];
  Category: CategoryModel;
  CheckoutInput: CheckoutInput;
  CheckoutLineInput: CheckoutLineInput;
  CheckoutResult: ResolversUnionTypes<ResolversParentTypes>['CheckoutResult'];
  CheckoutSucceeded: Omit<CheckoutSucceeded, 'order'> & { order: ResolversParentTypes['Order'] };
  DailyRevenue: Omit<DailyRevenue, 'cumulativeRevenue' | 'revenue'> & { cumulativeRevenue: ResolversParentTypes['Money'], revenue: ResolversParentTypes['Money'] };
  DateTime: Scalars['DateTime']['output'];
  DomainError: ResolversInterfaceTypes<ResolversParentTypes>['DomainError'];
  FacetBucket: FacetBucket;
  Float: Scalars['Float']['output'];
  ID: Scalars['ID']['output'];
  IdempotencyKeyReused: IdempotencyKeyReused;
  InsufficientStock: InsufficientStock;
  InsufficientStockLine: InsufficientStockLine;
  Int: Scalars['Int']['output'];
  InventoryAdjusted: Omit<InventoryAdjusted, 'balance' | 'movement'> & { balance: ResolversParentTypes['InventoryBalance'], movement: ResolversParentTypes['InventoryMovement'] };
  InventoryBalance: BalanceModel;
  InventoryBalanceConnection: Omit<InventoryBalanceConnection, 'edges'> & { edges: Array<ResolversParentTypes['InventoryBalanceEdge']> };
  InventoryBalanceEdge: Omit<InventoryBalanceEdge, 'node'> & { node: ResolversParentTypes['InventoryBalance'] };
  InventoryMovement: MovementModel;
  InventoryMovementConnection: Omit<InventoryMovementConnection, 'edges'> & { edges: Array<ResolversParentTypes['InventoryMovementEdge']> };
  InventoryMovementEdge: Omit<InventoryMovementEdge, 'node'> & { node: ResolversParentTypes['InventoryMovement'] };
  Job: JobModel;
  JobConnection: Omit<JobConnection, 'edges'> & { edges: Array<ResolversParentTypes['JobEdge']> };
  JobEdge: Omit<JobEdge, 'node'> & { node: ResolversParentTypes['Job'] };
  JobNotRetryable: JobNotRetryable;
  JobRetried: Omit<JobRetried, 'job'> & { job: ResolversParentTypes['Job'] };
  LowStockItem: LowStockModel;
  Money: MoneyModel;
  Mutation: Record<PropertyKey, never>;
  NothingToShip: NothingToShip;
  OperationsSummary: OperationsSummaryModel;
  Order: OrderModel;
  OrderActions: Omit<OrderActions, 'shippableWarehouses'> & { shippableWarehouses: Array<ResolversParentTypes['Warehouse']> };
  OrderCancelled: Omit<OrderCancelled, 'order'> & { order: ResolversParentTypes['Order'] };
  OrderConnection: Omit<OrderConnection, 'edges'> & { edges: Array<ResolversParentTypes['OrderEdge']> };
  OrderEdge: Omit<OrderEdge, 'node'> & { node: ResolversParentTypes['Order'] };
  OrderFilter: OrderFilter;
  OrderLine: OrderLineModel;
  OrderNotCancellable: OrderNotCancellable;
  OrderNotReturnable: OrderNotReturnable;
  OrderNotShippable: OrderNotShippable;
  OrderStatusCount: OrderStatusCount;
  OrderStatusEvent: Omit<OrderStatusEvent, 'order'> & { order: ResolversParentTypes['Order'] };
  PageInfo: PageInfo;
  Payment: PaymentModel;
  PriceChanged: Omit<PriceChanged, 'lines'> & { lines: Array<ResolversParentTypes['PriceChangedLine']> };
  PriceChangedLine: Omit<PriceChangedLine, 'currentUnitPrice'> & { currentUnitPrice: ResolversParentTypes['Money'] };
  Product: ProductModel;
  ProductSearchConnection: Omit<ProductSearchConnection, 'edges'> & { edges: Array<ResolversParentTypes['ProductSearchEdge']> };
  ProductSearchEdge: Omit<ProductSearchEdge, 'node'> & { node: ResolversParentTypes['ProductSearchHit'] };
  ProductSearchHit: Omit<ProductSearchHit, 'fromPrice'> & { fromPrice: ResolversParentTypes['Money'] };
  ProductSearchInput: ProductSearchInput;
  ProductSuggestion: ProductSuggestion;
  Query: Record<PropertyKey, never>;
  ReceiveReturnResult: ResolversUnionTypes<ResolversParentTypes>['ReceiveReturnResult'];
  RequestReturnInput: RequestReturnInput;
  RequestReturnResult: ResolversUnionTypes<ResolversParentTypes>['RequestReturnResult'];
  Reservation: ReservationModel;
  RetryJobResult: ResolversUnionTypes<ResolversParentTypes>['RetryJobResult'];
  Return: ReturnModel;
  ReturnLine: ReturnLineModel;
  ReturnLineInput: ReturnLineInput;
  ReturnNotReceivable: ReturnNotReceivable;
  ReturnQuantityExceeded: ReturnQuantityExceeded;
  ReturnQuantityExceededLine: ReturnQuantityExceededLine;
  ReturnReceived: Omit<ReturnReceived, 'order' | 'return'> & { order: ResolversParentTypes['Order'], return: ResolversParentTypes['Return'] };
  ReturnRequested: Omit<ReturnRequested, 'order' | 'return'> & { order: ResolversParentTypes['Order'], return: ResolversParentTypes['Return'] };
  SearchFacets: SearchFacets;
  ShipOrderInput: ShipOrderInput;
  ShipOrderResult: ResolversUnionTypes<ResolversParentTypes>['ShipOrderResult'];
  Shipment: ShipmentModel;
  ShipmentCreated: Omit<ShipmentCreated, 'order' | 'shipment'> & { order: ResolversParentTypes['Order'], shipment: ResolversParentTypes['Shipment'] };
  ShipmentLine: ShipmentLine;
  Sku: SkuModel;
  SkuPriceUpdated: Omit<SkuPriceUpdated, 'sku'> & { sku: ResolversParentTypes['Sku'] };
  StockLevel: BalanceModel;
  String: Scalars['String']['output'];
  Subscription: Record<PropertyKey, never>;
  UpdateSkuPriceInput: UpdateSkuPriceInput;
  UpdateSkuPriceResult: ResolversUnionTypes<ResolversParentTypes>['UpdateSkuPriceResult'];
  User: UserModel;
  Warehouse: WarehouseModel;
};

export type AdjustInventoryResultResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['AdjustInventoryResult'] = ResolversParentTypes['AdjustInventoryResult']> = {
  __resolveType: TypeResolveFn<'AdjustmentRejected' | 'InventoryAdjusted', ParentType, ContextType>;
};

export type AdjustmentRejectedResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['AdjustmentRejected'] = ResolversParentTypes['AdjustmentRejected']> = {
  code?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  message?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  onHand?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  reserved?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type AuditEntryResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['AuditEntry'] = ResolversParentTypes['AuditEntry']> = {
  action?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  actor?: Resolver<Maybe<ResolversTypes['User']>, ParentType, ContextType>;
  correlationId?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  details?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  entityId?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  entityType?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
};

export type AuditEntryConnectionResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['AuditEntryConnection'] = ResolversParentTypes['AuditEntryConnection']> = {
  edges?: Resolver<Array<ResolversTypes['AuditEntryEdge']>, ParentType, ContextType>;
  pageInfo?: Resolver<ResolversTypes['PageInfo'], ParentType, ContextType>;
};

export type AuditEntryEdgeResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['AuditEntryEdge'] = ResolversParentTypes['AuditEntryEdge']> = {
  cursor?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  node?: Resolver<ResolversTypes['AuditEntry'], ParentType, ContextType>;
};

export type CancelOrderResultResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['CancelOrderResult'] = ResolversParentTypes['CancelOrderResult']> = {
  __resolveType: TypeResolveFn<'OrderCancelled' | 'OrderNotCancellable', ParentType, ContextType>;
};

export type CategoryResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Category'] = ResolversParentTypes['Category']> = {
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  slug?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type CheckoutResultResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['CheckoutResult'] = ResolversParentTypes['CheckoutResult']> = {
  __resolveType: TypeResolveFn<'CheckoutSucceeded' | 'IdempotencyKeyReused' | 'InsufficientStock' | 'PriceChanged', ParentType, ContextType>;
};

export type CheckoutSucceededResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['CheckoutSucceeded'] = ResolversParentTypes['CheckoutSucceeded']> = {
  order?: Resolver<ResolversTypes['Order'], ParentType, ContextType>;
  replayed?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type DailyRevenueResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['DailyRevenue'] = ResolversParentTypes['DailyRevenue']> = {
  cumulativeRevenue?: Resolver<ResolversTypes['Money'], ParentType, ContextType>;
  day?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  orders?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  revenue?: Resolver<ResolversTypes['Money'], ParentType, ContextType>;
};

export interface DateTimeScalarConfig extends GraphQLScalarTypeConfig<ResolversTypes['DateTime'], any> {
  name: 'DateTime';
}

export type DomainErrorResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['DomainError'] = ResolversParentTypes['DomainError']> = {
  __resolveType: TypeResolveFn<'AdjustmentRejected' | 'IdempotencyKeyReused' | 'InsufficientStock' | 'JobNotRetryable' | 'NothingToShip' | 'OrderNotCancellable' | 'OrderNotReturnable' | 'OrderNotShippable' | 'PriceChanged' | 'ReturnNotReceivable' | 'ReturnQuantityExceeded', ParentType, ContextType>;
};

export type FacetBucketResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['FacetBucket'] = ResolversParentTypes['FacetBucket']> = {
  count?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  label?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  selected?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  value?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type IdempotencyKeyReusedResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['IdempotencyKeyReused'] = ResolversParentTypes['IdempotencyKeyReused']> = {
  code?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  message?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type InsufficientStockResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['InsufficientStock'] = ResolversParentTypes['InsufficientStock']> = {
  code?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  lines?: Resolver<Array<ResolversTypes['InsufficientStockLine']>, ParentType, ContextType>;
  message?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type InsufficientStockLineResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['InsufficientStockLine'] = ResolversParentTypes['InsufficientStockLine']> = {
  available?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  requested?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  skuId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
};

export type InventoryAdjustedResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['InventoryAdjusted'] = ResolversParentTypes['InventoryAdjusted']> = {
  balance?: Resolver<ResolversTypes['InventoryBalance'], ParentType, ContextType>;
  movement?: Resolver<ResolversTypes['InventoryMovement'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type InventoryBalanceResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['InventoryBalance'] = ResolversParentTypes['InventoryBalance']> = {
  available?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  onHand?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  reserved?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  sku?: Resolver<ResolversTypes['Sku'], ParentType, ContextType>;
  updatedAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  warehouse?: Resolver<ResolversTypes['Warehouse'], ParentType, ContextType>;
};

export type InventoryBalanceConnectionResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['InventoryBalanceConnection'] = ResolversParentTypes['InventoryBalanceConnection']> = {
  edges?: Resolver<Array<ResolversTypes['InventoryBalanceEdge']>, ParentType, ContextType>;
  pageInfo?: Resolver<ResolversTypes['PageInfo'], ParentType, ContextType>;
};

export type InventoryBalanceEdgeResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['InventoryBalanceEdge'] = ResolversParentTypes['InventoryBalanceEdge']> = {
  cursor?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  node?: Resolver<ResolversTypes['InventoryBalance'], ParentType, ContextType>;
};

export type InventoryMovementResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['InventoryMovement'] = ResolversParentTypes['InventoryMovement']> = {
  actor?: Resolver<Maybe<ResolversTypes['User']>, ParentType, ContextType>;
  createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  kind?: Resolver<ResolversTypes['InventoryMovementKind'], ParentType, ContextType>;
  onHandDelta?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  reason?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  referenceId?: Resolver<Maybe<ResolversTypes['ID']>, ParentType, ContextType>;
  referenceType?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  reservedDelta?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  sku?: Resolver<ResolversTypes['Sku'], ParentType, ContextType>;
  warehouse?: Resolver<ResolversTypes['Warehouse'], ParentType, ContextType>;
};

export type InventoryMovementConnectionResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['InventoryMovementConnection'] = ResolversParentTypes['InventoryMovementConnection']> = {
  edges?: Resolver<Array<ResolversTypes['InventoryMovementEdge']>, ParentType, ContextType>;
  pageInfo?: Resolver<ResolversTypes['PageInfo'], ParentType, ContextType>;
};

export type InventoryMovementEdgeResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['InventoryMovementEdge'] = ResolversParentTypes['InventoryMovementEdge']> = {
  cursor?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  node?: Resolver<ResolversTypes['InventoryMovement'], ParentType, ContextType>;
};

export type JobResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Job'] = ResolversParentTypes['Job']> = {
  aggregateId?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  aggregateType?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  attempts?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  availableAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  lastError?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  maxAttempts?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  status?: Resolver<ResolversTypes['JobStatus'], ParentType, ContextType>;
  topic?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type JobConnectionResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['JobConnection'] = ResolversParentTypes['JobConnection']> = {
  edges?: Resolver<Array<ResolversTypes['JobEdge']>, ParentType, ContextType>;
  pageInfo?: Resolver<ResolversTypes['PageInfo'], ParentType, ContextType>;
};

export type JobEdgeResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['JobEdge'] = ResolversParentTypes['JobEdge']> = {
  cursor?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  node?: Resolver<ResolversTypes['Job'], ParentType, ContextType>;
};

export type JobNotRetryableResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['JobNotRetryable'] = ResolversParentTypes['JobNotRetryable']> = {
  code?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  message?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  status?: Resolver<ResolversTypes['JobStatus'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type JobRetriedResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['JobRetried'] = ResolversParentTypes['JobRetried']> = {
  job?: Resolver<ResolversTypes['Job'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type LowStockItemResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['LowStockItem'] = ResolversParentTypes['LowStockItem']> = {
  available?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  sku?: Resolver<ResolversTypes['Sku'], ParentType, ContextType>;
  warehouse?: Resolver<ResolversTypes['Warehouse'], ParentType, ContextType>;
};

export type MoneyResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Money'] = ResolversParentTypes['Money']> = {
  amountMinor?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  currency?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  formatted?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type MutationResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Mutation'] = ResolversParentTypes['Mutation']> = {
  adjustInventory?: Resolver<ResolversTypes['AdjustInventoryResult'], ParentType, ContextType, RequireFields<MutationAdjustInventoryArgs, 'input'>>;
  cancelOrder?: Resolver<ResolversTypes['CancelOrderResult'], ParentType, ContextType, RequireFields<MutationCancelOrderArgs, 'orderId'>>;
  checkout?: Resolver<ResolversTypes['CheckoutResult'], ParentType, ContextType, RequireFields<MutationCheckoutArgs, 'input'>>;
  receiveReturn?: Resolver<ResolversTypes['ReceiveReturnResult'], ParentType, ContextType, RequireFields<MutationReceiveReturnArgs, 'returnId'>>;
  requestReturn?: Resolver<ResolversTypes['RequestReturnResult'], ParentType, ContextType, RequireFields<MutationRequestReturnArgs, 'input'>>;
  retryJob?: Resolver<ResolversTypes['RetryJobResult'], ParentType, ContextType, RequireFields<MutationRetryJobArgs, 'jobId'>>;
  shipOrder?: Resolver<ResolversTypes['ShipOrderResult'], ParentType, ContextType, RequireFields<MutationShipOrderArgs, 'input'>>;
  updateSkuPrice?: Resolver<ResolversTypes['UpdateSkuPriceResult'], ParentType, ContextType, RequireFields<MutationUpdateSkuPriceArgs, 'input'>>;
};

export type NothingToShipResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['NothingToShip'] = ResolversParentTypes['NothingToShip']> = {
  code?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  message?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type OperationsSummaryResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['OperationsSummary'] = ResolversParentTypes['OperationsSummary']> = {
  dailyRevenue?: Resolver<Array<ResolversTypes['DailyRevenue']>, ParentType, ContextType, RequireFields<OperationsSummaryDailyRevenueArgs, 'days'>>;
  expiredActiveReservations?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  failedJobs?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  lowStock?: Resolver<Array<ResolversTypes['LowStockItem']>, ParentType, ContextType, RequireFields<OperationsSummaryLowStockArgs, 'limit' | 'threshold'>>;
  oldestPendingJobAgeSeconds?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  ordersByStatus?: Resolver<Array<ResolversTypes['OrderStatusCount']>, ParentType, ContextType>;
  pendingJobs?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
};

export type OrderResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Order'] = ResolversParentTypes['Order']> = {
  allowedActions?: Resolver<ResolversTypes['OrderActions'], ParentType, ContextType>;
  cancellationReason?: Resolver<Maybe<ResolversTypes['CancellationReason']>, ParentType, ContextType>;
  createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  customer?: Resolver<ResolversTypes['User'], ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  lines?: Resolver<Array<ResolversTypes['OrderLine']>, ParentType, ContextType>;
  number?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  payment?: Resolver<Maybe<ResolversTypes['Payment']>, ParentType, ContextType>;
  reservationExpiresAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  reservations?: Resolver<Array<ResolversTypes['Reservation']>, ParentType, ContextType>;
  returns?: Resolver<Array<ResolversTypes['Return']>, ParentType, ContextType>;
  shipments?: Resolver<Array<ResolversTypes['Shipment']>, ParentType, ContextType>;
  status?: Resolver<ResolversTypes['OrderStatus'], ParentType, ContextType>;
  subtotal?: Resolver<ResolversTypes['Money'], ParentType, ContextType>;
  total?: Resolver<ResolversTypes['Money'], ParentType, ContextType>;
  updatedAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
};

export type OrderActionsResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['OrderActions'] = ResolversParentTypes['OrderActions']> = {
  canCancel?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  canRequestReturn?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  receivableReturnIds?: Resolver<Array<ResolversTypes['ID']>, ParentType, ContextType>;
  shippableWarehouses?: Resolver<Array<ResolversTypes['Warehouse']>, ParentType, ContextType>;
};

export type OrderCancelledResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['OrderCancelled'] = ResolversParentTypes['OrderCancelled']> = {
  order?: Resolver<ResolversTypes['Order'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type OrderConnectionResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['OrderConnection'] = ResolversParentTypes['OrderConnection']> = {
  edges?: Resolver<Array<ResolversTypes['OrderEdge']>, ParentType, ContextType>;
  pageInfo?: Resolver<ResolversTypes['PageInfo'], ParentType, ContextType>;
};

export type OrderEdgeResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['OrderEdge'] = ResolversParentTypes['OrderEdge']> = {
  cursor?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  node?: Resolver<ResolversTypes['Order'], ParentType, ContextType>;
};

export type OrderLineResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['OrderLine'] = ResolversParentTypes['OrderLine']> = {
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  lineNumber?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  lineTotal?: Resolver<ResolversTypes['Money'], ParentType, ContextType>;
  productName?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  quantity?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  returnableQuantity?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  returnedQuantity?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  shippedQuantity?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  sku?: Resolver<ResolversTypes['Sku'], ParentType, ContextType>;
  skuCode?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  unitPrice?: Resolver<ResolversTypes['Money'], ParentType, ContextType>;
};

export type OrderNotCancellableResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['OrderNotCancellable'] = ResolversParentTypes['OrderNotCancellable']> = {
  code?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  message?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  status?: Resolver<ResolversTypes['OrderStatus'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type OrderNotReturnableResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['OrderNotReturnable'] = ResolversParentTypes['OrderNotReturnable']> = {
  code?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  message?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  status?: Resolver<ResolversTypes['OrderStatus'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type OrderNotShippableResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['OrderNotShippable'] = ResolversParentTypes['OrderNotShippable']> = {
  code?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  message?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  status?: Resolver<ResolversTypes['OrderStatus'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type OrderStatusCountResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['OrderStatusCount'] = ResolversParentTypes['OrderStatusCount']> = {
  count?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  status?: Resolver<ResolversTypes['OrderStatus'], ParentType, ContextType>;
};

export type OrderStatusEventResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['OrderStatusEvent'] = ResolversParentTypes['OrderStatusEvent']> = {
  occurredAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  order?: Resolver<ResolversTypes['Order'], ParentType, ContextType>;
};

export type PageInfoResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['PageInfo'] = ResolversParentTypes['PageInfo']> = {
  endCursor?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  hasNextPage?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
};

export type PaymentResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Payment'] = ResolversParentTypes['Payment']> = {
  amount?: Resolver<ResolversTypes['Money'], ParentType, ContextType>;
  declineReason?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  refunded?: Resolver<ResolversTypes['Money'], ParentType, ContextType>;
  status?: Resolver<ResolversTypes['PaymentStatus'], ParentType, ContextType>;
};

export type PriceChangedResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['PriceChanged'] = ResolversParentTypes['PriceChanged']> = {
  code?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  lines?: Resolver<Array<ResolversTypes['PriceChangedLine']>, ParentType, ContextType>;
  message?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type PriceChangedLineResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['PriceChangedLine'] = ResolversParentTypes['PriceChangedLine']> = {
  currentUnitPrice?: Resolver<ResolversTypes['Money'], ParentType, ContextType>;
  expectedUnitPriceMinor?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  skuId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
};

export type ProductResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Product'] = ResolversParentTypes['Product']> = {
  availableQuantity?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  category?: Resolver<ResolversTypes['Category'], ParentType, ContextType>;
  description?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  fromPrice?: Resolver<ResolversTypes['Money'], ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  skus?: Resolver<Array<ResolversTypes['Sku']>, ParentType, ContextType>;
  slug?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type ProductSearchConnectionResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ProductSearchConnection'] = ResolversParentTypes['ProductSearchConnection']> = {
  edges?: Resolver<Array<ResolversTypes['ProductSearchEdge']>, ParentType, ContextType>;
  facets?: Resolver<ResolversTypes['SearchFacets'], ParentType, ContextType>;
  pageInfo?: Resolver<ResolversTypes['PageInfo'], ParentType, ContextType>;
  totalCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
};

export type ProductSearchEdgeResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ProductSearchEdge'] = ResolversParentTypes['ProductSearchEdge']> = {
  cursor?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  node?: Resolver<ResolversTypes['ProductSearchHit'], ParentType, ContextType>;
};

export type ProductSearchHitResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ProductSearchHit'] = ResolversParentTypes['ProductSearchHit']> = {
  categoryName?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  categorySlug?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  fromPrice?: Resolver<ResolversTypes['Money'], ParentType, ContextType>;
  inStock?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  productId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  score?: Resolver<Maybe<ResolversTypes['Float']>, ParentType, ContextType>;
  slug?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type ProductSuggestionResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ProductSuggestion'] = ResolversParentTypes['ProductSuggestion']> = {
  name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  productId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  slug?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type QueryResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Query'] = ResolversParentTypes['Query']> = {
  auditLog?: Resolver<ResolversTypes['AuditEntryConnection'], ParentType, ContextType, RequireFields<QueryAuditLogArgs, 'first'>>;
  categories?: Resolver<Array<ResolversTypes['Category']>, ParentType, ContextType>;
  inventory?: Resolver<ResolversTypes['InventoryBalanceConnection'], ParentType, ContextType, RequireFields<QueryInventoryArgs, 'first' | 'lowStockOnly'>>;
  inventoryMovements?: Resolver<ResolversTypes['InventoryMovementConnection'], ParentType, ContextType, RequireFields<QueryInventoryMovementsArgs, 'first' | 'skuId'>>;
  jobs?: Resolver<ResolversTypes['JobConnection'], ParentType, ContextType, RequireFields<QueryJobsArgs, 'first' | 'status'>>;
  myOrders?: Resolver<ResolversTypes['OrderConnection'], ParentType, ContextType, RequireFields<QueryMyOrdersArgs, 'first'>>;
  operationsSummary?: Resolver<ResolversTypes['OperationsSummary'], ParentType, ContextType>;
  order?: Resolver<Maybe<ResolversTypes['Order']>, ParentType, ContextType, RequireFields<QueryOrderArgs, 'id'>>;
  orders?: Resolver<ResolversTypes['OrderConnection'], ParentType, ContextType, RequireFields<QueryOrdersArgs, 'first'>>;
  product?: Resolver<Maybe<ResolversTypes['Product']>, ParentType, ContextType, RequireFields<QueryProductArgs, 'slug'>>;
  productSuggestions?: Resolver<Array<ResolversTypes['ProductSuggestion']>, ParentType, ContextType, RequireFields<QueryProductSuggestionsArgs, 'limit' | 'prefix'>>;
  searchProducts?: Resolver<ResolversTypes['ProductSearchConnection'], ParentType, ContextType, RequireFields<QuerySearchProductsArgs, 'first'>>;
  viewer?: Resolver<Maybe<ResolversTypes['User']>, ParentType, ContextType>;
  warehouses?: Resolver<Array<ResolversTypes['Warehouse']>, ParentType, ContextType>;
};

export type ReceiveReturnResultResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ReceiveReturnResult'] = ResolversParentTypes['ReceiveReturnResult']> = {
  __resolveType: TypeResolveFn<'ReturnNotReceivable' | 'ReturnReceived', ParentType, ContextType>;
};

export type RequestReturnResultResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['RequestReturnResult'] = ResolversParentTypes['RequestReturnResult']> = {
  __resolveType: TypeResolveFn<'OrderNotReturnable' | 'ReturnQuantityExceeded' | 'ReturnRequested', ParentType, ContextType>;
};

export type ReservationResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Reservation'] = ResolversParentTypes['Reservation']> = {
  expiresAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  quantity?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  sku?: Resolver<ResolversTypes['Sku'], ParentType, ContextType>;
  status?: Resolver<ResolversTypes['ReservationStatus'], ParentType, ContextType>;
  warehouse?: Resolver<ResolversTypes['Warehouse'], ParentType, ContextType>;
};

export type RetryJobResultResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['RetryJobResult'] = ResolversParentTypes['RetryJobResult']> = {
  __resolveType: TypeResolveFn<'JobNotRetryable' | 'JobRetried', ParentType, ContextType>;
};

export type ReturnResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Return'] = ResolversParentTypes['Return']> = {
  createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  lines?: Resolver<Array<ResolversTypes['ReturnLine']>, ParentType, ContextType>;
  reason?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  receivedAt?: Resolver<Maybe<ResolversTypes['DateTime']>, ParentType, ContextType>;
  refund?: Resolver<ResolversTypes['Money'], ParentType, ContextType>;
  refundedAt?: Resolver<Maybe<ResolversTypes['DateTime']>, ParentType, ContextType>;
  status?: Resolver<ResolversTypes['ReturnStatus'], ParentType, ContextType>;
};

export type ReturnLineResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ReturnLine'] = ResolversParentTypes['ReturnLine']> = {
  orderLineId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  quantity?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  skuCode?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  warehouse?: Resolver<ResolversTypes['Warehouse'], ParentType, ContextType>;
};

export type ReturnNotReceivableResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ReturnNotReceivable'] = ResolversParentTypes['ReturnNotReceivable']> = {
  code?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  message?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  status?: Resolver<ResolversTypes['ReturnStatus'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type ReturnQuantityExceededResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ReturnQuantityExceeded'] = ResolversParentTypes['ReturnQuantityExceeded']> = {
  code?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  lines?: Resolver<Array<ResolversTypes['ReturnQuantityExceededLine']>, ParentType, ContextType>;
  message?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type ReturnQuantityExceededLineResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ReturnQuantityExceededLine'] = ResolversParentTypes['ReturnQuantityExceededLine']> = {
  orderLineId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  requested?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  returnable?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
};

export type ReturnReceivedResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ReturnReceived'] = ResolversParentTypes['ReturnReceived']> = {
  order?: Resolver<ResolversTypes['Order'], ParentType, ContextType>;
  return?: Resolver<ResolversTypes['Return'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type ReturnRequestedResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ReturnRequested'] = ResolversParentTypes['ReturnRequested']> = {
  order?: Resolver<ResolversTypes['Order'], ParentType, ContextType>;
  return?: Resolver<ResolversTypes['Return'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type SearchFacetsResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['SearchFacets'] = ResolversParentTypes['SearchFacets']> = {
  availability?: Resolver<Array<ResolversTypes['FacetBucket']>, ParentType, ContextType>;
  categories?: Resolver<Array<ResolversTypes['FacetBucket']>, ParentType, ContextType>;
  priceRanges?: Resolver<Array<ResolversTypes['FacetBucket']>, ParentType, ContextType>;
};

export type ShipOrderResultResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ShipOrderResult'] = ResolversParentTypes['ShipOrderResult']> = {
  __resolveType: TypeResolveFn<'NothingToShip' | 'OrderNotShippable' | 'ShipmentCreated', ParentType, ContextType>;
};

export type ShipmentResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Shipment'] = ResolversParentTypes['Shipment']> = {
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  lines?: Resolver<Array<ResolversTypes['ShipmentLine']>, ParentType, ContextType>;
  shippedAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  trackingCode?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  warehouse?: Resolver<ResolversTypes['Warehouse'], ParentType, ContextType>;
};

export type ShipmentCreatedResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ShipmentCreated'] = ResolversParentTypes['ShipmentCreated']> = {
  order?: Resolver<ResolversTypes['Order'], ParentType, ContextType>;
  shipment?: Resolver<ResolversTypes['Shipment'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type ShipmentLineResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ShipmentLine'] = ResolversParentTypes['ShipmentLine']> = {
  orderLineId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  quantity?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  skuCode?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type SkuResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Sku'] = ResolversParentTypes['Sku']> = {
  availableQuantity?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  code?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  label?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  price?: Resolver<ResolversTypes['Money'], ParentType, ContextType>;
  product?: Resolver<ResolversTypes['Product'], ParentType, ContextType>;
  stock?: Resolver<Array<ResolversTypes['StockLevel']>, ParentType, ContextType>;
};

export type SkuPriceUpdatedResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['SkuPriceUpdated'] = ResolversParentTypes['SkuPriceUpdated']> = {
  sku?: Resolver<ResolversTypes['Sku'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type StockLevelResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['StockLevel'] = ResolversParentTypes['StockLevel']> = {
  available?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  onHand?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  reserved?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  warehouse?: Resolver<ResolversTypes['Warehouse'], ParentType, ContextType>;
};

export type SubscriptionResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Subscription'] = ResolversParentTypes['Subscription']> = {
  orderUpdated?: SubscriptionResolver<ResolversTypes['OrderStatusEvent'], "orderUpdated", ParentType, ContextType, RequireFields<SubscriptionOrderUpdatedArgs, 'orderId'>>;
};

export type UpdateSkuPriceResultResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['UpdateSkuPriceResult'] = ResolversParentTypes['UpdateSkuPriceResult']> = {
  __resolveType: TypeResolveFn<'SkuPriceUpdated', ParentType, ContextType>;
};

export type UserResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['User'] = ResolversParentTypes['User']> = {
  displayName?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  email?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  role?: Resolver<ResolversTypes['Role'], ParentType, ContextType>;
};

export type WarehouseResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Warehouse'] = ResolversParentTypes['Warehouse']> = {
  code?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type Resolvers<ContextType = GraphQLContext> = {
  AdjustInventoryResult?: AdjustInventoryResultResolvers<ContextType>;
  AdjustmentRejected?: AdjustmentRejectedResolvers<ContextType>;
  AuditEntry?: AuditEntryResolvers<ContextType>;
  AuditEntryConnection?: AuditEntryConnectionResolvers<ContextType>;
  AuditEntryEdge?: AuditEntryEdgeResolvers<ContextType>;
  CancelOrderResult?: CancelOrderResultResolvers<ContextType>;
  Category?: CategoryResolvers<ContextType>;
  CheckoutResult?: CheckoutResultResolvers<ContextType>;
  CheckoutSucceeded?: CheckoutSucceededResolvers<ContextType>;
  DailyRevenue?: DailyRevenueResolvers<ContextType>;
  DateTime?: GraphQLScalarType;
  DomainError?: DomainErrorResolvers<ContextType>;
  FacetBucket?: FacetBucketResolvers<ContextType>;
  IdempotencyKeyReused?: IdempotencyKeyReusedResolvers<ContextType>;
  InsufficientStock?: InsufficientStockResolvers<ContextType>;
  InsufficientStockLine?: InsufficientStockLineResolvers<ContextType>;
  InventoryAdjusted?: InventoryAdjustedResolvers<ContextType>;
  InventoryBalance?: InventoryBalanceResolvers<ContextType>;
  InventoryBalanceConnection?: InventoryBalanceConnectionResolvers<ContextType>;
  InventoryBalanceEdge?: InventoryBalanceEdgeResolvers<ContextType>;
  InventoryMovement?: InventoryMovementResolvers<ContextType>;
  InventoryMovementConnection?: InventoryMovementConnectionResolvers<ContextType>;
  InventoryMovementEdge?: InventoryMovementEdgeResolvers<ContextType>;
  Job?: JobResolvers<ContextType>;
  JobConnection?: JobConnectionResolvers<ContextType>;
  JobEdge?: JobEdgeResolvers<ContextType>;
  JobNotRetryable?: JobNotRetryableResolvers<ContextType>;
  JobRetried?: JobRetriedResolvers<ContextType>;
  LowStockItem?: LowStockItemResolvers<ContextType>;
  Money?: MoneyResolvers<ContextType>;
  Mutation?: MutationResolvers<ContextType>;
  NothingToShip?: NothingToShipResolvers<ContextType>;
  OperationsSummary?: OperationsSummaryResolvers<ContextType>;
  Order?: OrderResolvers<ContextType>;
  OrderActions?: OrderActionsResolvers<ContextType>;
  OrderCancelled?: OrderCancelledResolvers<ContextType>;
  OrderConnection?: OrderConnectionResolvers<ContextType>;
  OrderEdge?: OrderEdgeResolvers<ContextType>;
  OrderLine?: OrderLineResolvers<ContextType>;
  OrderNotCancellable?: OrderNotCancellableResolvers<ContextType>;
  OrderNotReturnable?: OrderNotReturnableResolvers<ContextType>;
  OrderNotShippable?: OrderNotShippableResolvers<ContextType>;
  OrderStatusCount?: OrderStatusCountResolvers<ContextType>;
  OrderStatusEvent?: OrderStatusEventResolvers<ContextType>;
  PageInfo?: PageInfoResolvers<ContextType>;
  Payment?: PaymentResolvers<ContextType>;
  PriceChanged?: PriceChangedResolvers<ContextType>;
  PriceChangedLine?: PriceChangedLineResolvers<ContextType>;
  Product?: ProductResolvers<ContextType>;
  ProductSearchConnection?: ProductSearchConnectionResolvers<ContextType>;
  ProductSearchEdge?: ProductSearchEdgeResolvers<ContextType>;
  ProductSearchHit?: ProductSearchHitResolvers<ContextType>;
  ProductSuggestion?: ProductSuggestionResolvers<ContextType>;
  Query?: QueryResolvers<ContextType>;
  ReceiveReturnResult?: ReceiveReturnResultResolvers<ContextType>;
  RequestReturnResult?: RequestReturnResultResolvers<ContextType>;
  Reservation?: ReservationResolvers<ContextType>;
  RetryJobResult?: RetryJobResultResolvers<ContextType>;
  Return?: ReturnResolvers<ContextType>;
  ReturnLine?: ReturnLineResolvers<ContextType>;
  ReturnNotReceivable?: ReturnNotReceivableResolvers<ContextType>;
  ReturnQuantityExceeded?: ReturnQuantityExceededResolvers<ContextType>;
  ReturnQuantityExceededLine?: ReturnQuantityExceededLineResolvers<ContextType>;
  ReturnReceived?: ReturnReceivedResolvers<ContextType>;
  ReturnRequested?: ReturnRequestedResolvers<ContextType>;
  SearchFacets?: SearchFacetsResolvers<ContextType>;
  ShipOrderResult?: ShipOrderResultResolvers<ContextType>;
  Shipment?: ShipmentResolvers<ContextType>;
  ShipmentCreated?: ShipmentCreatedResolvers<ContextType>;
  ShipmentLine?: ShipmentLineResolvers<ContextType>;
  Sku?: SkuResolvers<ContextType>;
  SkuPriceUpdated?: SkuPriceUpdatedResolvers<ContextType>;
  StockLevel?: StockLevelResolvers<ContextType>;
  Subscription?: SubscriptionResolvers<ContextType>;
  UpdateSkuPriceResult?: UpdateSkuPriceResultResolvers<ContextType>;
  User?: UserResolvers<ContextType>;
  Warehouse?: WarehouseResolvers<ContextType>;
};

