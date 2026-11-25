-- 0001: core schema for order-fulfillment-lab.
-- Conventions:
--   * Money is stored as bigint minor units (cents). Never numeric/float.
--   * All timestamps are timestamptz and the application writes UTC.
--   * Status columns use text + CHECK so that the allowed values are visible
--     in one place and migrations can extend them without enum type churn.

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- gen_random_uuid()

-- ---------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL,
  display_name  text NOT NULL,
  password_hash text NOT NULL,
  role          text NOT NULL CHECK (role IN ('CUSTOMER', 'OPERATOR', 'ADMIN')),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_lower_key ON users (lower(email));

-- The cookie holds a random token. Only its SHA-256 hash is stored, so a
-- database leak does not expose usable session tokens.
CREATE TABLE sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash  bytea NOT NULL UNIQUE,
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz
);
CREATE INDEX sessions_user_id_idx ON sessions (user_id);

-- ---------------------------------------------------------------------------
-- Catalog
-- ---------------------------------------------------------------------------
CREATE TABLE categories (
  id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug  text NOT NULL UNIQUE,
  name  text NOT NULL
);

CREATE TABLE products (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         text NOT NULL UNIQUE,
  name         text NOT NULL,
  description  text NOT NULL DEFAULT '',
  category_id  uuid NOT NULL REFERENCES categories (id),
  status       text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  -- Monotonic counter. Incremented on every change that affects the search
  -- document. See docs/database-design.md "Search document version".
  version      bigint NOT NULL DEFAULT 1,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX products_category_id_idx ON products (category_id);

CREATE TABLE skus (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id   uuid NOT NULL REFERENCES products (id),
  code         text NOT NULL UNIQUE,
  label        text NOT NULL,
  price_minor  bigint NOT NULL CHECK (price_minor >= 0),
  currency     char(3) NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  active       boolean NOT NULL DEFAULT true,
  version      bigint NOT NULL DEFAULT 1
);
CREATE INDEX skus_product_id_idx ON skus (product_id);

CREATE TABLE warehouses (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code      text NOT NULL UNIQUE,
  name      text NOT NULL,
  -- Lower value = preferred source during allocation.
  priority  int NOT NULL UNIQUE
);

-- ---------------------------------------------------------------------------
-- Inventory
--   on_hand   = physical units in the warehouse.
--   reserved  = units promised to unshipped orders.
--   available = on_hand - reserved (computed, never stored).
-- ---------------------------------------------------------------------------
CREATE TABLE inventory_balances (
  sku_id        uuid NOT NULL REFERENCES skus (id),
  warehouse_id  uuid NOT NULL REFERENCES warehouses (id),
  on_hand       int NOT NULL CHECK (on_hand >= 0),
  reserved      int NOT NULL CHECK (reserved >= 0),
  version       bigint NOT NULL DEFAULT 1,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (sku_id, warehouse_id),
  CONSTRAINT inventory_reserved_within_on_hand CHECK (reserved <= on_hand)
);
CREATE INDEX inventory_balances_warehouse_idx ON inventory_balances (warehouse_id, sku_id);

-- Append-only ledger. For every (sku, warehouse):
--   SUM(on_hand_delta)  = inventory_balances.on_hand
--   SUM(reserved_delta) = inventory_balances.reserved
CREATE TABLE inventory_movements (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sku_id          uuid NOT NULL REFERENCES skus (id),
  warehouse_id    uuid NOT NULL REFERENCES warehouses (id),
  kind            text NOT NULL CHECK (kind IN ('RECEIPT', 'RESERVE', 'RELEASE', 'SHIP', 'RETURN_RESTOCK', 'ADJUSTMENT')),
  on_hand_delta   int NOT NULL,
  reserved_delta  int NOT NULL,
  reference_type  text,
  reference_id    uuid,
  reason          text,
  actor_user_id   uuid REFERENCES users (id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- Each kind has a fixed sign pattern. This keeps the ledger meaningful.
  CONSTRAINT movement_sign_pattern CHECK (
       (kind = 'RECEIPT'        AND on_hand_delta > 0  AND reserved_delta = 0)
    OR (kind = 'RESERVE'        AND on_hand_delta = 0  AND reserved_delta > 0)
    OR (kind = 'RELEASE'        AND on_hand_delta = 0  AND reserved_delta < 0)
    OR (kind = 'SHIP'           AND on_hand_delta < 0  AND reserved_delta = on_hand_delta)
    OR (kind = 'RETURN_RESTOCK' AND on_hand_delta > 0  AND reserved_delta = 0)
    OR (kind = 'ADJUSTMENT'     AND on_hand_delta <> 0 AND reserved_delta = 0)
  )
);
-- Movement history screen: newest first for one SKU in one warehouse.
CREATE INDEX inventory_movements_sku_wh_idx ON inventory_movements (sku_id, warehouse_id, id DESC);
-- A business event moves stock at most once per (kind, sku, warehouse).
-- This is the database-level guard against duplicate shipment and duplicate restocking.
CREATE UNIQUE INDEX inventory_movements_once_per_reference
  ON inventory_movements (reference_type, reference_id, kind, sku_id, warehouse_id)
  WHERE reference_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------
CREATE TABLE orders (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number                  bigint GENERATED ALWAYS AS IDENTITY (START WITH 100001) UNIQUE,
  customer_id             uuid NOT NULL REFERENCES users (id),
  status                  text NOT NULL CHECK (status IN ('PENDING_PAYMENT', 'CONFIRMED', 'PARTIALLY_SHIPPED', 'SHIPPED', 'CANCELLED')),
  cancellation_reason     text CHECK (cancellation_reason IN ('CUSTOMER_REQUEST', 'PAYMENT_DECLINED', 'RESERVATION_EXPIRED', 'OPERATOR_REQUEST')),
  currency                char(3) NOT NULL DEFAULT 'USD',
  subtotal_minor          bigint NOT NULL CHECK (subtotal_minor >= 0),
  total_minor             bigint NOT NULL CHECK (total_minor >= 0),
  reservation_expires_at  timestamptz NOT NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cancellation_reason_matches_status CHECK ((status = 'CANCELLED') = (cancellation_reason IS NOT NULL))
);
-- Operator order lists use keyset pagination on (created_at, id) per status.
-- The customer "my orders" index is added in 0002 after measurement
-- (see docs/performance.md).
CREATE INDEX orders_customer_id_idx ON orders (customer_id);
CREATE INDEX orders_status_created_idx ON orders (status, created_at DESC, id DESC);

CREATE TABLE order_lines (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id          uuid NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  line_number       int NOT NULL,
  sku_id            uuid NOT NULL REFERENCES skus (id),
  product_name      text NOT NULL,
  sku_code          text NOT NULL,
  quantity          int NOT NULL CHECK (quantity > 0),
  unit_price_minor  bigint NOT NULL CHECK (unit_price_minor >= 0),
  line_total_minor  bigint NOT NULL CHECK (line_total_minor = unit_price_minor * quantity),
  UNIQUE (order_id, line_number),
  UNIQUE (order_id, sku_id)
);

CREATE TABLE reservations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id       uuid NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  order_line_id  uuid NOT NULL REFERENCES order_lines (id) ON DELETE CASCADE,
  sku_id         uuid NOT NULL REFERENCES skus (id),
  warehouse_id   uuid NOT NULL REFERENCES warehouses (id),
  quantity       int NOT NULL CHECK (quantity > 0),
  status         text NOT NULL CHECK (status IN ('ACTIVE', 'CONFIRMED', 'SHIPPED', 'RELEASED')),
  expires_at     timestamptz NOT NULL,
  release_reason text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_line_id, warehouse_id)
);
CREATE INDEX reservations_order_idx ON reservations (order_id);
-- Expiration sweeper only scans live holds.
CREATE INDEX reservations_active_expiry_idx ON reservations (expires_at) WHERE status = 'ACTIVE';
-- Fulfillment queue per warehouse.
CREATE INDEX reservations_confirmed_wh_idx ON reservations (warehouse_id, created_at) WHERE status = 'CONFIRMED';

-- ---------------------------------------------------------------------------
-- Checkout idempotency
-- ---------------------------------------------------------------------------
CREATE TABLE checkout_requests (
  customer_id      uuid NOT NULL REFERENCES users (id),
  idempotency_key  text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 100),
  request_hash     text NOT NULL,
  result           jsonb NOT NULL,
  order_id         uuid REFERENCES orders (id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (customer_id, idempotency_key)
);

-- ---------------------------------------------------------------------------
-- Payments (simulated provider)
-- ---------------------------------------------------------------------------
CREATE TABLE payments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        uuid NOT NULL UNIQUE REFERENCES orders (id) ON DELETE CASCADE,
  status          text NOT NULL CHECK (status IN ('PENDING', 'CAPTURED', 'DECLINED', 'PARTIALLY_REFUNDED', 'REFUNDED')),
  amount_minor    bigint NOT NULL CHECK (amount_minor >= 0),
  refunded_minor  bigint NOT NULL DEFAULT 0 CHECK (refunded_minor >= 0),
  payment_token   text NOT NULL,
  decline_reason  text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT refund_within_amount CHECK (refunded_minor <= amount_minor)
);

-- Every provider notification is stored once. The unique provider_event_id
-- turns duplicate deliveries into no-ops.
CREATE TABLE payment_events (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  payment_id         uuid NOT NULL REFERENCES payments (id) ON DELETE CASCADE,
  provider_event_id  text NOT NULL UNIQUE,
  kind               text NOT NULL CHECK (kind IN ('PAYMENT_SUCCEEDED', 'PAYMENT_DECLINED', 'REFUND_SUCCEEDED')),
  amount_minor       bigint NOT NULL,
  outcome            text NOT NULL,
  received_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payment_events_payment_idx ON payment_events (payment_id);

CREATE TABLE refunds (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id    uuid NOT NULL REFERENCES payments (id) ON DELETE CASCADE,
  -- Exactly one refund per return, and at most one cancellation/late-payment refund per payment.
  return_id     uuid UNIQUE,
  reason        text NOT NULL CHECK (reason IN ('RETURN', 'CANCELLATION', 'LATE_PAYMENT')),
  amount_minor  bigint NOT NULL CHECK (amount_minor > 0),
  status        text NOT NULL CHECK (status IN ('PENDING', 'SUCCEEDED')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz
);
CREATE UNIQUE INDEX refunds_one_non_return_per_payment ON refunds (payment_id) WHERE return_id IS NULL;

-- The simulated payment provider's own state. It stands in for an external
-- system, so the application only reaches it through payment-gateway.ts.
CREATE TABLE simulated_gateway_operations (
  idempotency_key    text PRIMARY KEY,
  operation          text NOT NULL CHECK (operation IN ('CHARGE', 'REFUND')),
  outcome            text NOT NULL,
  provider_event_id  text NOT NULL UNIQUE,
  amount_minor       bigint NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Fulfillment and returns
-- ---------------------------------------------------------------------------
CREATE TABLE shipments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id       uuid NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  warehouse_id   uuid NOT NULL REFERENCES warehouses (id),
  tracking_code  text NOT NULL,
  shipped_by     uuid REFERENCES users (id),
  shipped_at     timestamptz NOT NULL DEFAULT now(),
  -- One shipment per warehouse per order: a second "ship" is a duplicate.
  UNIQUE (order_id, warehouse_id)
);

CREATE TABLE shipment_lines (
  shipment_id    uuid NOT NULL REFERENCES shipments (id) ON DELETE CASCADE,
  order_line_id  uuid NOT NULL REFERENCES order_lines (id) ON DELETE CASCADE,
  quantity       int NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (shipment_id, order_line_id)
);

CREATE TABLE returns (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      uuid NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  status        text NOT NULL CHECK (status IN ('REQUESTED', 'RECEIVED', 'REFUNDED')),
  reason        text NOT NULL,
  refund_minor  bigint NOT NULL CHECK (refund_minor >= 0),
  requested_by  uuid NOT NULL REFERENCES users (id),
  received_by   uuid REFERENCES users (id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  received_at   timestamptz,
  refunded_at   timestamptz
);
CREATE INDEX returns_order_idx ON returns (order_id);
CREATE INDEX returns_requested_idx ON returns (created_at) WHERE status = 'REQUESTED';

CREATE TABLE return_lines (
  return_id      uuid NOT NULL REFERENCES returns (id) ON DELETE CASCADE,
  order_line_id  uuid NOT NULL REFERENCES order_lines (id) ON DELETE CASCADE,
  -- Returned units go back to the warehouse that shipped them.
  warehouse_id   uuid NOT NULL REFERENCES warehouses (id),
  quantity       int NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (return_id, order_line_id, warehouse_id)
);
CREATE INDEX return_lines_order_line_idx ON return_lines (order_line_id);

-- ---------------------------------------------------------------------------
-- Transactional outbox and job queue
-- ---------------------------------------------------------------------------
CREATE TABLE outbox_events (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  topic            text NOT NULL,
  aggregate_type   text NOT NULL,
  aggregate_id     text NOT NULL,
  payload          jsonb NOT NULL DEFAULT '{}'::jsonb,
  status           text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'DONE', 'FAILED')),
  attempts         int NOT NULL DEFAULT 0,
  max_attempts     int NOT NULL DEFAULT 8,
  available_at     timestamptz NOT NULL DEFAULT now(),
  locked_by        text,
  lease_expires_at timestamptz,
  last_error       text,
  correlation_id   text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  processed_at     timestamptz
);
-- The claim query scans only unfinished rows. DONE rows (the vast majority)
-- stay out of this index.
CREATE INDEX outbox_claimable_idx ON outbox_events (available_at, id) WHERE status IN ('PENDING', 'PROCESSING');
CREATE INDEX outbox_failed_idx ON outbox_events (id DESC) WHERE status = 'FAILED';

-- ---------------------------------------------------------------------------
-- Search index lifecycle (alias switching during rebuild)
-- ---------------------------------------------------------------------------
CREATE TABLE search_index_state (
  alias           text PRIMARY KEY,
  active_index    text,
  building_index  text,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Audit
-- ---------------------------------------------------------------------------
CREATE TABLE audit_log (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_user_id   uuid REFERENCES users (id),
  action          text NOT NULL,
  entity_type     text NOT NULL,
  entity_id       text NOT NULL,
  details         jsonb NOT NULL DEFAULT '{}'::jsonb,
  correlation_id  text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_entity_idx ON audit_log (entity_type, entity_id, id DESC);
