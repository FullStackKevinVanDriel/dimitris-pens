/* Dimitris Pens — Express app (Postgres).
 *
 * Imported by server/index.js (local: listens) and api/index.js (Vercel:
 * exported as the serverless function). No app.listen here.
 *
 * Public:
 *   GET    /api/health
 *   GET    /api/settings             public storefront settings (+ field metadata)
 *   GET    /api/products             (sort_order; includes category_name)
 *   GET    /api/categories           (with product_count)
 *   POST   /api/orders/quote         {items, state, ship_method} -> server totals
 *   POST   /api/payments/mock        {amount_cents, currency?, card:{number,...}}
 *   POST   /api/orders               {items, address, ship_method?, payment_id}
 *   POST   /api/admin/login          {password}
 *   POST   /api/admin/logout
 *   GET    /api/admin/session        {admin: bool}
 * Admin (session cookie required, see server/auth.js):
 *   GET    /api/admin/settings       all settings incl. private ones
 *   PUT    /api/settings             {key: value | null(reset)}
 *   POST   /api/products             {name, price_cents, category_id?, description?, inventory?, image_key?, image_data_url?}
 *   PUT    /api/products/reorder     {order: [id, ...]}
 *   PUT    /api/products/:id         (partial)
 *   DELETE /api/products/:id
 *   POST   /api/categories           {name}
 *   PUT    /api/categories/:id       {name}
 *   DELETE /api/categories/:id
 *   GET    /api/alerts               (shipping alert outbox, latest first)
 *   GET    /api/orders               (latest 100, PII decrypted)
 *   GET    /api/orders/:id           (by id or order_number, with items)
 *
 * Money is integer cents. Tax + shipping are computed server-side from the
 * site settings and shipping address — client totals are never trusted, and
 * an order must reference an unused, succeeded payment for exactly the total.
 * Customer name/street/city/zip and alert bodies are encrypted at rest.
 *
 * TODO(live Stripe): the mock endpoint is the seam. For real charges:
 *  1. client: load Stripe.js, set publishable key (see public/payments.js),
 *  2. server: add POST /api/payments/intent {items, state, ship_method} that
 *     computes the total itself, creates a PaymentIntent with the SECRET key,
 *     and records it in `payments`; confirm with stripe.confirmCardPayment().
 *  3. verify succeeded status via webhook (or retrieve the intent) instead of
 *     the mock ledger row, and add js.stripe.com to the CSP below.
 */
"use strict";

const path = require("path");
const express = require("express");
const helmet = require("helmet");
const { pool, uid } = require("./db");
const pii = require("./crypto");
const auth = require("./auth");
const settings = require("./settings");

const app = express();
// Client IP for login rate limiting. Vercel sets a trustworthy
// X-Forwarded-For; behind Caddy on the same host, trust loopback only.
app.set(
  "trust proxy",
  process.env.TRUST_PROXY || (process.env.VERCEL ? true : "loopback"),
);
app.disable("x-powered-by");
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
      },
    },
  }),
);
// Photo uploads arrive as data URLs on product routes; everything else is small.
app.use("/api/products", express.json({ limit: "5mb" }));
app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(__dirname, "public")));

const requireAdmin = auth.requireAdmin;
const wrap = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
const httpError = (status, msg) => Object.assign(new Error(msg), { status });

/* ---------------- pricing (server-side, cents, from settings) ---------------- */
function taxRate(s, state) {
  const r = s.tax_rates[String(state || "").toUpperCase()];
  return r === undefined ? s.default_tax : r;
}
function shipCents(s, method, subtotalCents) {
  if (method === "express") return s.ship_express_cents;
  return s.free_ship_at_cents > 0 && subtotalCents >= s.free_ship_at_cents
    ? 0
    : s.ship_standard_cents;
}
const cents = (n) => "$" + (n / 100).toFixed(2);

/* ---------------- helpers ---------------- */
// Photos: raster images only, base64 data URLs (no SVG — it can carry script).
const IMAGE_DATA_URL =
  /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/;
const IMAGE_KEYS = [
  "classic",
  "forest",
  "midnight",
  "roller",
  "brassrb",
  "pencil",
];

function checkImage(b) {
  if (b.image_data_url && !IMAGE_DATA_URL.test(b.image_data_url))
    throw httpError(422, "image must be a PNG, JPEG, WebP or GIF");
  if (b.image_key && !IMAGE_KEYS.includes(b.image_key))
    throw httpError(422, "unknown image_key");
}

function productRow(p) {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    price_cents: p.price_cents,
    category_id: p.category_id,
    category_name: p.category_name || "Uncategorized",
    image_data_url: p.image_data_url,
    image_key: p.image_key,
    inventory: p.inventory,
    sort_order: p.sort_order,
  };
}
const PRODUCT_SELECT = `SELECT p.*, c.name AS category_name FROM products p
                        LEFT JOIN categories c ON c.id = p.category_id`;

function decryptOrder(o) {
  for (const c of ["customer_name", "street", "city", "zip"])
    o[c] = pii.decrypt(o[c]);
  return o;
}

function alertBody(o, items) {
  return [
    `New paid order ${o.order_number} (${new Date(o.created_at).toISOString()})`,
    "",
    "Items:",
    ...items.map(
      (it) =>
        `  ${it.qty}x ${it.product_name} @ ${cents(it.unit_price_cents)} = ${cents(it.qty * it.unit_price_cents)}`,
    ),
    "",
    `Subtotal:        ${cents(o.subtotal_cents)}`,
    `Tax (est):       ${cents(o.tax_cents)}`,
    `Shipping (${o.ship_method}): ${o.shipping_cents === 0 ? "FREE" : cents(o.shipping_cents)}`,
    `Total charged:   ${cents(o.total_cents)}`,
    "",
    "Ship to:",
    `  ${o.customer_name}`,
    `  ${o.street}`,
    `  ${o.city}, ${o.state} ${o.zip}`,
    "",
    `Payment: ${o.payment_id || "n/a"} (mock/test mode)`,
    "",
    "-- Dimitris Pens",
  ].join("\n");
}

// Shipping alerts: no SMTP in serverless, so paid orders queue their alert
// in the shipping_alerts table (admin Outbox view). The body contains the
// customer's address, so it's encrypted at rest. Graduation path: a
// Resend/Postmark API call where the INSERT below happens.
async function queueShippingAlert(client, order, items, recipient) {
  const subject = `Shipping alert — order ${order.order_number}`;
  await client.query(
    `INSERT INTO shipping_alerts (id, order_id, recipient, subject, body, status)
     VALUES ($1, $2, $3, $4, $5, 'queued')`,
    [
      uid("sa"),
      order.id,
      recipient,
      subject,
      pii.encrypt(alertBody(order, items)),
    ],
  );
  console.log("shipping alert queued for", order.order_number);
}

/* ---------------- health ---------------- */
app.get("/api/health", (req, res) => res.json({ ok: true }));

/* ---------------- admin auth ---------------- */
app.post("/api/admin/login", wrap(auth.login));
app.post("/api/admin/logout", wrap(auth.logout));
app.get("/api/admin/session", wrap(auth.session));

/* ---------------- site settings ---------------- */
app.get(
  "/api/settings",
  wrap(async (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({
      values: await settings.getPublic(),
      fields: settings.fieldMeta(),
      fonts: settings.FONT_STACKS,
    });
  }),
);
app.get(
  "/api/admin/settings",
  requireAdmin,
  wrap(async (req, res) => {
    res.json({
      values: await settings.getAll(),
      fields: settings.fieldMeta(),
      fonts: settings.FONT_STACKS,
    });
  }),
);
app.put(
  "/api/settings",
  requireAdmin,
  wrap(async (req, res) => {
    res.json({ ok: true, values: await settings.update(req.body) });
  }),
);

/* ---------------- products ---------------- */
app.get(
  "/api/products",
  wrap(async (req, res) => {
    const { rows } = await pool.query(
      PRODUCT_SELECT + " ORDER BY p.sort_order, p.name",
    );
    res.json(rows.map(productRow));
  }),
);

app.post(
  "/api/products",
  requireAdmin,
  wrap(async (req, res) => {
    const b = req.body || {};
    const name = String(b.name || "")
      .trim()
      .slice(0, 120);
    const price_cents = Math.round(Number(b.price_cents));
    const inventory = Math.max(0, parseInt(b.inventory, 10) || 0);
    if (!name) throw httpError(422, "name required");
    if (!Number.isFinite(price_cents) || price_cents < 0)
      throw httpError(422, "price_cents must be >= 0");
    checkImage(b);
    if (b.category_id) {
      const { rows } = await pool.query(
        "SELECT id FROM categories WHERE id = $1",
        [b.category_id],
      );
      if (!rows.length) throw httpError(422, "unknown category_id");
    }
    const { rows: m } = await pool.query(
      "SELECT COALESCE(MAX(sort_order), -1) AS m FROM products",
    );
    const id = uid("p");
    await pool.query(
      `INSERT INTO products
     (id, name, description, price_cents, category_id, image_data_url, image_key, inventory, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        id,
        name,
        String(b.description || "").slice(0, 500),
        price_cents,
        b.category_id || null,
        b.image_data_url || null,
        b.image_key || null,
        inventory,
        Number(m[0].m) + 1,
      ],
    );
    const { rows: got } = await pool.query(
      PRODUCT_SELECT + " WHERE p.id = $1",
      [id],
    );
    res.status(201).json(productRow(got[0]));
  }),
);

app.put(
  "/api/products/reorder",
  requireAdmin,
  wrap(async (req, res) => {
    const order = (req.body || {}).order;
    if (!Array.isArray(order))
      throw httpError(422, "order must be an array of ids");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (let i = 0; i < order.length; i++) {
        await client.query(
          "UPDATE products SET sort_order = $1 WHERE id = $2",
          [i, String(order[i])],
        );
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
    res.json({ ok: true });
  }),
);

app.put(
  "/api/products/:id",
  requireAdmin,
  wrap(async (req, res) => {
    const { rows: cur } = await pool.query(
      "SELECT * FROM products WHERE id = $1",
      [req.params.id],
    );
    if (!cur.length) throw httpError(404, "not found");
    const c0 = cur[0],
      b = req.body || {};
    checkImage(b);
    const patch = {
      name:
        b.name !== undefined ? String(b.name).trim().slice(0, 120) : c0.name,
      description:
        b.description !== undefined
          ? String(b.description).slice(0, 500)
          : c0.description,
      price_cents:
        b.price_cents !== undefined
          ? Math.round(Number(b.price_cents))
          : c0.price_cents,
      category_id:
        b.category_id !== undefined ? b.category_id || null : c0.category_id,
      image_data_url:
        b.image_data_url !== undefined
          ? b.image_data_url || null
          : c0.image_data_url,
      image_key: b.image_key !== undefined ? b.image_key || null : c0.image_key,
      inventory:
        b.inventory !== undefined
          ? Math.max(0, parseInt(b.inventory, 10) || 0)
          : c0.inventory,
    };
    if (!patch.name) throw httpError(422, "name required");
    if (!Number.isFinite(patch.price_cents) || patch.price_cents < 0)
      throw httpError(422, "price_cents must be >= 0");
    if (patch.category_id) {
      const { rows } = await pool.query(
        "SELECT id FROM categories WHERE id = $1",
        [patch.category_id],
      );
      if (!rows.length) throw httpError(422, "unknown category_id");
    }
    if (b.image_key) patch.image_data_url = null; // icon clears photo
    if (b.image_data_url) patch.image_key = null; // photo clears icon
    await pool.query(
      `UPDATE products SET name=$1, description=$2, price_cents=$3, category_id=$4,
     image_data_url=$5, image_key=$6, inventory=$7 WHERE id=$8`,
      [
        patch.name,
        patch.description,
        patch.price_cents,
        patch.category_id,
        patch.image_data_url,
        patch.image_key,
        patch.inventory,
        c0.id,
      ],
    );
    const { rows: got } = await pool.query(
      PRODUCT_SELECT + " WHERE p.id = $1",
      [c0.id],
    );
    res.json(productRow(got[0]));
  }),
);

app.delete(
  "/api/products/:id",
  requireAdmin,
  wrap(async (req, res) => {
    const { rowCount } = await pool.query(
      "DELETE FROM products WHERE id = $1",
      [req.params.id],
    );
    if (!rowCount) throw httpError(404, "not found");
    res.json({ ok: true });
  }),
);

/* ---------------- categories ---------------- */
app.get(
  "/api/categories",
  wrap(async (req, res) => {
    const { rows } = await pool.query(
      "SELECT * FROM categories ORDER BY sort_order, name",
    );
    const { rows: counts } = await pool.query(
      "SELECT category_id, COUNT(*)::int AS n FROM products GROUP BY category_id",
    );
    const byCat = Object.fromEntries(counts.map((c) => [c.category_id, c.n]));
    res.json(
      rows.map((c) => ({
        id: c.id,
        name: c.name,
        sort_order: c.sort_order,
        product_count: byCat[c.id] || 0,
      })),
    );
  }),
);

app.post(
  "/api/categories",
  requireAdmin,
  wrap(async (req, res) => {
    const name = String((req.body || {}).name || "")
      .trim()
      .slice(0, 60);
    if (!name) throw httpError(422, "name required");
    const { rows: m } = await pool.query(
      "SELECT COALESCE(MAX(sort_order), -1) AS m FROM categories",
    );
    const id = uid("c");
    try {
      await pool.query(
        "INSERT INTO categories (id, name, sort_order) VALUES ($1, $2, $3)",
        [id, name, Number(m[0].m) + 1],
      );
    } catch (e) {
      if (e.code === "23505") throw httpError(409, "category already exists");
      throw e;
    }
    res
      .status(201)
      .json({ id, name, sort_order: Number(m[0].m) + 1, product_count: 0 });
  }),
);

app.put(
  "/api/categories/:id",
  requireAdmin,
  wrap(async (req, res) => {
    const name = String((req.body || {}).name || "")
      .trim()
      .slice(0, 60);
    if (!name) throw httpError(422, "name required");
    try {
      const { rowCount } = await pool.query(
        "UPDATE categories SET name = $1 WHERE id = $2",
        [name, req.params.id],
      );
      if (!rowCount) throw httpError(404, "not found");
    } catch (e) {
      if (e.code === "23505") throw httpError(409, "category already exists");
      throw e;
    }
    res.json({ ok: true, id: req.params.id, name });
  }),
);

app.delete(
  "/api/categories/:id",
  requireAdmin,
  wrap(async (req, res) => {
    const { rowCount } = await pool.query(
      "DELETE FROM categories WHERE id = $1",
      [req.params.id],
    );
    if (!rowCount) throw httpError(404, "not found");
    res.json({ ok: true }); // products' category_id -> NULL via ON DELETE SET NULL
  }),
);

/* ---------------- shipping alert outbox (admin) ---------------- */
app.get(
  "/api/alerts",
  requireAdmin,
  wrap(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT sa.*, o.order_number FROM shipping_alerts sa
     JOIN orders o ON o.id = sa.order_id
     ORDER BY sa.created_at DESC LIMIT 100`,
    );
    res.json(rows.map((r) => ({ ...r, body: pii.decrypt(r.body) })));
  }),
);

/* ---------------- quote (server totals for display + payment amount) ---------------- */
async function priceItems(db, items, lock) {
  if (!Array.isArray(items) || !items.length) throw httpError(422, "no items");
  if (items.length > 50) throw httpError(422, "too many items");
  let subtotal = 0;
  const lines = [];
  for (const it of items) {
    const qty = parseInt(it.qty, 10);
    if (!qty || qty < 1 || qty > 100) throw httpError(422, "bad qty");
    const { rows } = await db.query(
      "SELECT * FROM products WHERE id = $1" + (lock ? " FOR UPDATE" : ""),
      [String(it.product_id)],
    );
    if (!rows.length) throw httpError(422, "unknown product");
    const p = rows[0];
    if (p.inventory < qty)
      throw httpError(409, "insufficient stock for " + p.name);
    subtotal += p.price_cents * qty;
    lines.push({
      product_id: p.id,
      product_name: p.name,
      qty,
      unit_price_cents: p.price_cents,
    });
  }
  return { subtotal, lines };
}

function totals(s, subtotal, state, method) {
  const rate = taxRate(s, state);
  const tax = Math.round(subtotal * rate);
  const shipping = shipCents(s, method, subtotal);
  return {
    subtotal_cents: subtotal,
    tax_rate: rate,
    tax_cents: tax,
    shipping_cents: shipping,
    total_cents: subtotal + tax + shipping,
  };
}

app.post(
  "/api/orders/quote",
  wrap(async (req, res) => {
    const b = req.body || {};
    const s = await settings.getAll();
    const method = b.ship_method === "express" ? "express" : "standard";
    const { subtotal } = await priceItems(pool, b.items, false);
    res.json({
      ok: true,
      ship_method: method,
      ...totals(s, subtotal, b.state, method),
    });
  }),
);

/* ---------------- mock payments (server-side seam) ---------------- */
function mockDelay() {
  return 1000 + Math.random() * 1000;
}

app.post(
  "/api/payments/mock",
  wrap(async (req, res) => {
    const b = req.body || {};
    const amount_cents = Math.round(Number(b.amount_cents));
    const card = b.card || {};
    if (
      !Number.isFinite(amount_cents) ||
      amount_cents <= 0 ||
      amount_cents > 10000000
    )
      return res
        .status(422)
        .json({
          ok: false,
          code: "invalid_amount",
          message: "Amount must be positive.",
        });
    const digits = String(card.number || "").replace(/\D/g, "");
    if (digits.length < 13)
      return res
        .status(422)
        .json({
          ok: false,
          code: "invalid_card",
          message: "Card number looks wrong.",
        });
    await new Promise((r) => setTimeout(r, mockDelay()));
    // Classic Stripe test pattern: cards ending 0002 are declined.
    // Card data is never stored or logged; only the outcome is recorded.
    if (/0002$/.test(digits))
      return res
        .status(402)
        .json({
          ok: false,
          code: "card_declined",
          message: "Your card was declined. Try a different card.",
        });
    const id = "pi_mock_" + pii.randomToken(12);
    const currency = /^[a-z]{3}$/.test(b.currency || "") ? b.currency : "usd";
    await pool.query(
      "INSERT INTO payments (id, amount_cents, currency, status) VALUES ($1, $2, $3, 'succeeded')",
      [id, amount_cents, currency],
    );
    res.json({ ok: true, id, status: "succeeded", amount_cents, currency });
  }),
);

/* ---------------- orders ---------------- */
async function createOrder(input) {
  const a = input.address || {};
  const addr = {};
  for (const f of ["name", "street", "city", "state", "zip"]) {
    addr[f] = String(a[f] || "")
      .trim()
      .slice(0, 200);
    if (!addr[f]) throw httpError(422, "address." + f + " required");
  }
  addr.state = addr.state.toUpperCase();
  if (!/^[A-Z]{2}$/.test(addr.state))
    throw httpError(422, "address.state must be a 2-letter code");
  const method = input.ship_method === "express" ? "express" : "standard";
  const paymentId = String(input.payment_id || "");
  if (!paymentId) throw httpError(402, "payment required");
  const s = await settings.getAll();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { subtotal, lines } = await priceItems(client, input.items, true);
    const t = totals(s, subtotal, addr.state, method);

    // The payment must exist, have succeeded, be unused, and match the total.
    const { rows: pay } = await client.query(
      "SELECT * FROM payments WHERE id = $1 FOR UPDATE",
      [paymentId],
    );
    if (!pay.length || pay[0].status !== "succeeded")
      throw httpError(402, "payment not found");
    if (pay[0].order_id) throw httpError(409, "payment already used");
    if (pay[0].amount_cents !== t.total_cents)
      throw httpError(409, "payment amount does not match order total");

    for (const l of lines) {
      await client.query(
        "UPDATE products SET inventory = inventory - $1 WHERE id = $2",
        [l.qty, l.product_id],
      );
    }
    const id = uid("o");
    const order_number =
      "DP-" +
      pii.randomToken(6).replace(/[-_]/g, "X").toUpperCase().slice(0, 8);
    const { rows: orows } = await client.query(
      `INSERT INTO orders
       (id, order_number, customer_name, street, city, state, zip,
        subtotal_cents, tax_cents, shipping_cents, total_cents,
        ship_method, payment_id, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'paid') RETURNING *`,
      [
        id,
        order_number,
        pii.encrypt(addr.name),
        pii.encrypt(addr.street),
        pii.encrypt(addr.city),
        addr.state,
        pii.encrypt(addr.zip),
        t.subtotal_cents,
        t.tax_cents,
        t.shipping_cents,
        t.total_cents,
        method,
        paymentId,
      ],
    );
    await client.query("UPDATE payments SET order_id = $1 WHERE id = $2", [
      id,
      paymentId,
    ]);
    for (const l of lines) {
      await client.query(
        "INSERT INTO order_items (id, order_id, product_id, product_name, qty, unit_price_cents) VALUES ($1,$2,$3,$4,$5,$6)",
        [
          uid("oi"),
          id,
          l.product_id,
          l.product_name,
          l.qty,
          l.unit_price_cents,
        ],
      );
    }
    // Queue the shipping alert in the same transaction — no SMTP in serverless.
    await queueShippingAlert(
      client,
      decryptOrder(orows[0]),
      lines,
      s.alert_recipient,
    );
    await client.query("COMMIT");

    return {
      id,
      order_number,
      status: "paid",
      subtotal_cents: t.subtotal_cents,
      tax_cents: t.tax_cents,
      shipping_cents: t.shipping_cents,
      total_cents: t.total_cents,
      ship_method: method,
      payment_id: paymentId,
      address: addr,
      items: lines,
    };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

app.post(
  "/api/orders",
  wrap(async (req, res) => {
    const order = await createOrder(req.body || {});
    res.status(201).json({ ok: true, order });
  }),
);

app.get(
  "/api/orders",
  requireAdmin,
  wrap(async (req, res) => {
    const { rows } = await pool.query(
      "SELECT * FROM orders ORDER BY created_at DESC LIMIT 100",
    );
    res.json(rows.map(decryptOrder));
  }),
);

app.get(
  "/api/orders/:id",
  requireAdmin,
  wrap(async (req, res) => {
    const { rows } = await pool.query(
      "SELECT * FROM orders WHERE id = $1 OR order_number = $1",
      [req.params.id],
    );
    if (!rows.length) throw httpError(404, "not found");
    const o = decryptOrder(rows[0]);
    const { rows: items } = await pool.query(
      "SELECT product_id, product_name, qty, unit_price_cents FROM order_items WHERE order_id = $1",
      [o.id],
    );
    o.items = items;
    res.json(o);
  }),
);

/* ---------------- fallback + errors ---------------- */
app.all("/api/*", (req, res) =>
  res.status(404).json({ ok: false, error: "not found" }),
);
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  // Expected errors carry a status and a safe message; anything else is a
  // 500 with a generic message so DB/internal details never leak.
  if (err.type === "entity.too.large")
    return res.status(413).json({ ok: false, error: "request too large" });
  if (err.type === "entity.parse.failed")
    return res.status(400).json({ ok: false, error: "invalid JSON" });
  if (err.status && err.status < 500)
    return res.status(err.status).json({ ok: false, error: err.message });
  console.error("api error:", err.message);
  res.status(500).json({ ok: false, error: "internal error" });
});

module.exports = app;
