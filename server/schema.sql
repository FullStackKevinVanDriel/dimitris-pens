-- Dimitris Pens — Postgres schema.
-- Applied on boot (CREATE TABLE IF NOT EXISTS, idempotent).
-- Prices are integer cents. Timestamps default to NOW().

CREATE TABLE IF NOT EXISTS categories (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS products (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  price_cents    INTEGER NOT NULL CHECK (price_cents >= 0),
  category_id    TEXT REFERENCES categories(id) ON DELETE SET NULL,
  image_data_url TEXT,              -- uploaded photo (data URL), takes precedence
  image_key      TEXT,              -- built-in icon key (see frontend ICONS)
  inventory      INTEGER NOT NULL DEFAULT 0 CHECK (inventory >= 0),
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_sort ON products(sort_order);

CREATE TABLE IF NOT EXISTS orders (
  id             TEXT PRIMARY KEY,
  order_number   TEXT NOT NULL UNIQUE,
  customer_name  TEXT NOT NULL,
  street         TEXT NOT NULL,
  city           TEXT NOT NULL,
  state          TEXT NOT NULL,
  zip            TEXT NOT NULL,
  subtotal_cents INTEGER NOT NULL,
  tax_cents      INTEGER NOT NULL,
  shipping_cents INTEGER NOT NULL,
  total_cents    INTEGER NOT NULL,
  ship_method    TEXT NOT NULL DEFAULT 'standard',
  payment_id     TEXT,
  status         TEXT NOT NULL DEFAULT 'paid',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_orders_number ON orders(order_number);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC);

CREATE TABLE IF NOT EXISTS order_items (
  id               TEXT PRIMARY KEY,
  order_id         TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id       TEXT,
  product_name     TEXT NOT NULL,
  qty              INTEGER NOT NULL CHECK (qty > 0),
  unit_price_cents INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_items_order ON order_items(order_id);

-- Shipping alerts. There is no SMTP in serverless, so paid orders queue
-- their alert here (status 'queued') and the admin Outbox view lists them.
-- Graduation path: a Resend/Postmark API call where the INSERT happens.
CREATE TABLE IF NOT EXISTS shipping_alerts (
  id         TEXT PRIMARY KEY,
  order_id   TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  recipient  TEXT NOT NULL,
  subject    TEXT NOT NULL,
  body       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'queued',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_alerts_order ON shipping_alerts(order_id);
CREATE INDEX IF NOT EXISTS idx_alerts_created ON shipping_alerts(created_at DESC);

-- ---------------- v3: auth, payments ledger, site settings ----------------

-- PII columns (orders.customer_name/street/city/zip, shipping_alerts.body)
-- hold AES-256-GCM ciphertext ("enc:v1:..."); see server/crypto.js.

-- Admin sessions: only the sha256 of the cookie token is stored, so a DB
-- leak doesn't hand out live sessions. Deleting a row revokes the session.
CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash TEXT PRIMARY KEY,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Failed admin logins, keyed by sha256(client IP). DB-backed because
-- serverless instances don't share memory.
CREATE TABLE IF NOT EXISTS login_failures (
  id         BIGSERIAL PRIMARY KEY,
  ip_hash    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_login_failures_ip ON login_failures(ip_hash, created_at);

-- Server-side payment ledger. An order must reference a succeeded, unused
-- payment whose amount equals the server-computed total.
CREATE TABLE IF NOT EXISTS payments (
  id           TEXT PRIMARY KEY,
  amount_cents INTEGER NOT NULL,
  currency     TEXT NOT NULL DEFAULT 'usd',
  status       TEXT NOT NULL,
  order_id     TEXT REFERENCES orders(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Editable storefront content/theme/pricing (see server/settings.js).
CREATE TABLE IF NOT EXISTS site_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
