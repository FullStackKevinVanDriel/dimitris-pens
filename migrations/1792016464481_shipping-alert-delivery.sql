-- Up Migration
-- Delivery tracking for shipping alerts sent through Resend.
-- status: queued (no email provider / not yet sent) | sent | failed
ALTER TABLE shipping_alerts ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE shipping_alerts ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;
ALTER TABLE shipping_alerts ADD COLUMN IF NOT EXISTS provider_id TEXT;
ALTER TABLE shipping_alerts ADD COLUMN IF NOT EXISTS last_error TEXT;

-- Down Migration
ALTER TABLE shipping_alerts DROP COLUMN IF EXISTS last_error;
ALTER TABLE shipping_alerts DROP COLUMN IF EXISTS provider_id;
ALTER TABLE shipping_alerts DROP COLUMN IF EXISTS sent_at;
ALTER TABLE shipping_alerts DROP COLUMN IF EXISTS attempts;
