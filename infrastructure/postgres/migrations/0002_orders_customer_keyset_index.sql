-- 0002: keyset index for "my orders".
-- Measured in docs/performance.md: with only orders_customer_id_idx, PostgreSQL
-- fetches every order of the customer and sorts them before applying LIMIT.
-- This composite index returns rows already in (created_at DESC, id DESC)
-- order, so the LIMIT stops the scan early.
CREATE INDEX orders_customer_created_idx ON orders (customer_id, created_at DESC, id DESC);
DROP INDEX orders_customer_id_idx;
