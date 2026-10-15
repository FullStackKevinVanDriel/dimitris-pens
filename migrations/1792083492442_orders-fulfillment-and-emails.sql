-- Up Migration
-- #29 fulfillment status on orders, #30 customer email + customer-facing
-- emails in the same outbox as shipping alerts.

-- Customer email (PII: stored encrypted, like the address). Nullable for
-- orders placed before this change.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_email TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_number TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipped_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check
  CHECK (status IN ('paid', 'shipped', 'delivered', 'cancelled'));
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status, created_at DESC);

-- The outbox now holds every email: the shop's shipping alert plus the
-- customer's confirmation / shipped notice. recipient becomes PII for
-- customer emails, so it's encrypted for all rows (boot backfill handles
-- existing ones).
ALTER TABLE shipping_alerts ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'shipping_alert';

-- Down Migration
ALTER TABLE shipping_alerts DROP COLUMN IF EXISTS kind;
DROP INDEX IF EXISTS idx_orders_status;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders DROP COLUMN IF EXISTS cancelled_at;
ALTER TABLE orders DROP COLUMN IF EXISTS delivered_at;
ALTER TABLE orders DROP COLUMN IF EXISTS shipped_at;
ALTER TABLE orders DROP COLUMN IF EXISTS tracking_number;
ALTER TABLE orders DROP COLUMN IF EXISTS customer_email;
