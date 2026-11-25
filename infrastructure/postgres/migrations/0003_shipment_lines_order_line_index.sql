-- 0003: index shipment_lines by order line.
-- Measured in docs/performance.md: the shippedQuantity loader and the return
-- request look up shipment_lines by order_line_id. The primary key starts with
-- shipment_id, so PostgreSQL scanned the whole table (300k rows in the bench
-- data set) for every order detail, including the checkout response.
CREATE INDEX shipment_lines_order_line_idx ON shipment_lines (order_line_id);
