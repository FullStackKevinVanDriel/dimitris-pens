/* Dimitris Pens — Express app (Postgres).
 *
 * Imported by server/index.js (local: listens) and api/index.js (Vercel:
 * exported as the serverless function). No app.listen here.
 *
 *   GET    /api/health
 *   GET    /api/products            (sort_order; includes category_name)
 *   POST   /api/products            {name, price_cents, category_id?, description?, inventory?, image_key?, image_data_url?}
 *   PUT    /api/products/reorder    {order: [id, ...]}
 *   PUT    /api/products/:id        (partial)
 *   DELETE /api/products/:id
 *   GET    /api/categories          (with product_count)
 *   POST   /api/categories          {name}
 *   PUT    /api/categories/:id      {name}
 *   DELETE /api/categories/:id
 *   GET    /api/alerts              (shipping alert outbox, latest first)
 *   POST   /api/payments/mock       {amount_cents, currency?, card:{number,...}}
 *   POST   /api/orders              {items:[{product_id,qty}], address, ship_method?, payment_id?}
 *   GET    /api/orders              (latest 100)
 *   GET    /api/orders/:id          (by id or order_number, with items)
 *
 * Money is integer cents. Tax + shipping are computed server-side from the
 * shipping address — client totals are never trusted.
 *
 * TODO(live Stripe): the mock endpoint is the seam. For real charges:
 *  1. client: load Stripe.js, set publishable key (see public/payments.js),
 *  2. server: add POST /api/payments/intent {amount_cents, currency} ->
 *     {client_secret} (created with the SECRET key server-side), then the
 *     client confirms with stripe.confirmCardPayment(client_secret).
 */
"use strict";

const path = require("path");
const express = require("express");
const { pool, uid } = require("./db");

const app = express();
app.use(express.json({ limit: "6mb" })); // data-URL photo uploads
app.use(express.static(path.join(__dirname, "public")));

/* ---------------- pricing (server-side, cents) ---------------- */
const TAX_RATES = { WA: 0.065, CA: 0.0725, OR: 0, NY: 0.08, TX: 0.0625 };
const DEFAULT_TAX = 0.05;
const SHIP_STANDARD = 695;   // $6.95
const SHIP_EXPRESS = 1495;    // $14.95
const FREE_SHIP_AT = 7500;   // $75

function taxRate(state) {
  const r = TAX_RATES[String(state || "").toUpperCase()];
  return r === undefined ? DEFAULT_TAX : r;
}
function shipCents(method, subtotalCents) {
  if (method === "express") return SHIP_EXPRESS;
  return subtotalCents >= FREE_SHIP_AT ? 0 : SHIP_STANDARD;
}
const cents = (n) => "$" + (n / 100).toFixed(2);

/* ---------------- helpers ---------------- */
function productRow(p) {
  return {
    id: p.id, name: p.name, description: p.description,
    price_cents: p.price_cents, category_id: p.category_id,
    category_name: p.category_name || "Uncategorized",
    image_data_url: p.image_data_url, image_key: p.image_key,
    inventory: p.inventory, sort_order: p.sort_order
  };
}
const PRODUCT_SELECT = `SELECT p.*, c.name AS category_name FROM products p
                        LEFT JOIN categories c ON c.id = p.category_id`;
const ALERT_RECIPIENT = process.env.ALERT_TO || "orders@dimitris-pens.local";

function alertBody(o, items) {
  return [
    `New paid order ${o.order_number} (${o.created_at.toISOString ? o.created_at.toISOString() : o.created_at})`, "",
    "Items:",
    ...items.map((it) => `  ${it.qty}x ${it.product_name} @ ${cents(it.unit_price_cents)} = ${cents(it.qty * it.unit_price_cents)}`),
    "",
    `Subtotal:        ${cents(o.subtotal_cents)}`,
    `Tax (est):       ${cents(o.tax_cents)}`,
    `Shipping (${o.ship_method}): ${o.shipping_cents === 0 ? "FREE" : cents(o.shipping_cents)}`,
    `Total charged:   ${cents(o.total_cents)}`, "",
    "Ship to:",
    `  ${o.customer_name}`, `  ${o.street}`, `  ${o.city}, ${o.state} ${o.zip}`, "",
    `Payment: ${o.payment_id || "n/a"} (mock/test mode)`, "",
    "-- Dimitris Pens"
  ].join("\n");
}

// Shipping alerts: no SMTP in serverless, so paid orders queue their alert
// in the shipping_alerts table (admin Outbox view). Graduation path: a
// Resend/Postmark API call where the INSERT below happens.
async function queueShippingAlert(client, order, items) {
  const subject = `Shipping alert — order ${order.order_number}`;
  await client.query(
    `INSERT INTO shipping_alerts (id, order_id, recipient, subject, body, status)
     VALUES ($1, $2, $3, $4, $5, 'queued')`,
    [uid("sa"), order.id, ALERT_RECIPIENT, subject, alertBody(order, items)]
  );
  console.log("shipping alert queued for", order.order_number, "->", ALERT_RECIPIENT);
}

/* ---------------- health ---------------- */
app.get("/api/health", (req, res) => res.json({ ok: true }));

/* ---------------- products ---------------- */
app.get("/api/products", async (req, res, next) => {
  try {
    const { rows } = await pool.query(PRODUCT_SELECT + " ORDER BY p.sort_order, p.name");
    res.json(rows.map(productRow));
  } catch (e) { next(e); }
});

app.post("/api/products", async (req, res, next) => {
  try {
    const b = req.body || {};
    const name = String(b.name || "").trim();
    const price_cents = Math.round(Number(b.price_cents));
    const inventory = Math.max(0, parseInt(b.inventory, 10) || 0);
    if (!name) return res.status(422).json({ ok: false, error: "name required" });
    if (!Number.isFinite(price_cents) || price_cents < 0)
      return res.status(422).json({ ok: false, error: "price_cents must be >= 0" });
    if (b.category_id) {
      const { rows } = await pool.query("SELECT id FROM categories WHERE id = $1", [b.category_id]);
      if (!rows.length) return res.status(422).json({ ok: false, error: "unknown category_id" });
    }
    const { rows: m } = await pool.query("SELECT COALESCE(MAX(sort_order), -1) AS m FROM products");
    const id = uid("p");
    await pool.query(
      `INSERT INTO products
       (id, name, description, price_cents, category_id, image_data_url, image_key, inventory, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id, name, String(b.description || "").slice(0, 500), price_cents,
       b.category_id || null, b.image_data_url || null, b.image_key || null,
       inventory, Number(m[0].m) + 1]
    );
    const { rows: got } = await pool.query(PRODUCT_SELECT + " WHERE p.id = $1", [id]);
    res.status(201).json(productRow(got[0]));
  } catch (e) { next(e); }
});

app.put("/api/products/reorder", async (req, res, next) => {
  try {
    const order = (req.body || {}).order;
    if (!Array.isArray(order)) return res.status(422).json({ ok: false, error: "order must be an array of ids" });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (let i = 0; i < order.length; i++) {
        await client.query("UPDATE products SET sort_order = $1 WHERE id = $2", [i, order[i]]);
      }
      await client.query("COMMIT");
    } catch (e) { await client.query("ROLLBACK"); throw e; }
    finally { client.release(); }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.put("/api/products/:id", async (req, res, next) => {
  try {
    const { rows: cur } = await pool.query("SELECT * FROM products WHERE id = $1", [req.params.id]);
    if (!cur.length) return res.status(404).json({ ok: false, error: "not found" });
    const c0 = cur[0], b = req.body || {};
    const patch = {
      name: b.name !== undefined ? String(b.name).trim() : c0.name,
      description: b.description !== undefined ? String(b.description).slice(0, 500) : c0.description,
      price_cents: b.price_cents !== undefined ? Math.round(Number(b.price_cents)) : c0.price_cents,
      category_id: b.category_id !== undefined ? (b.category_id || null) : c0.category_id,
      image_data_url: b.image_data_url !== undefined ? (b.image_data_url || null) : c0.image_data_url,
      image_key: b.image_key !== undefined ? (b.image_key || null) : c0.image_key,
      inventory: b.inventory !== undefined ? Math.max(0, parseInt(b.inventory, 10) || 0) : c0.inventory
    };
    if (!patch.name) return res.status(422).json({ ok: false, error: "name required" });
    if (!Number.isFinite(patch.price_cents) || patch.price_cents < 0)
      return res.status(422).json({ ok: false, error: "price_cents must be >= 0" });
    if (patch.category_id) {
      const { rows } = await pool.query("SELECT id FROM categories WHERE id = $1", [patch.category_id]);
      if (!rows.length) return res.status(422).json({ ok: false, error: "unknown category_id" });
    }
    if (b.image_key) patch.image_data_url = null;      // icon clears photo
    if (b.image_data_url) patch.image_key = null;      // photo clears icon
    await pool.query(
      `UPDATE products SET name=$1, description=$2, price_cents=$3, category_id=$4,
       image_data_url=$5, image_key=$6, inventory=$7 WHERE id=$8`,
      [patch.name, patch.description, patch.price_cents, patch.category_id,
       patch.image_data_url, patch.image_key, patch.inventory, c0.id]
    );
    const { rows: got } = await pool.query(PRODUCT_SELECT + " WHERE p.id = $1", [c0.id]);
    res.json(productRow(got[0]));
  } catch (e) { next(e); }
});

app.delete("/api/products/:id", async (req, res, next) => {
  try {
    const { rowCount } = await pool.query("DELETE FROM products WHERE id = $1", [req.params.id]);
    if (!rowCount) return res.status(404).json({ ok: false, error: "not found" });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/* ---------------- categories ---------------- */
app.get("/api/categories", async (req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT * FROM categories ORDER BY sort_order, name");
    const { rows: counts } = await pool.query("SELECT category_id, COUNT(*)::int AS n FROM products GROUP BY category_id");
    const byCat = Object.fromEntries(counts.map((c) => [c.category_id, c.n]));
    res.json(rows.map((c) => ({ id: c.id, name: c.name, sort_order: c.sort_order, product_count: byCat[c.id] || 0 })));
  } catch (e) { next(e); }
});

app.post("/api/categories", async (req, res, next) => {
  try {
    const name = String((req.body || {}).name || "").trim();
    if (!name) return res.status(422).json({ ok: false, error: "name required" });
    const { rows: m } = await pool.query("SELECT COALESCE(MAX(sort_order), -1) AS m FROM categories");
    const id = uid("c");
    try {
      await pool.query("INSERT INTO categories (id, name, sort_order) VALUES ($1, $2, $3)",
        [id, name, Number(m[0].m) + 1]);
    } catch (e) {
      if (e.code === "23505") return res.status(409).json({ ok: false, error: "category already exists" });
      throw e;
    }
    res.status(201).json({ id, name, sort_order: Number(m[0].m) + 1, product_count: 0 });
  } catch (e) { next(e); }
});

app.put("/api/categories/:id", async (req, res, next) => {
  try {
    const name = String((req.body || {}).name || "").trim();
    if (!name) return res.status(422).json({ ok: false, error: "name required" });
    try {
      const { rowCount } = await pool.query("UPDATE categories SET name = $1 WHERE id = $2", [name, req.params.id]);
      if (!rowCount) return res.status(404).json({ ok: false, error: "not found" });
    } catch (e) {
      if (e.code === "23505") return res.status(409).json({ ok: false, error: "category already exists" });
      throw e;
    }
    res.json({ ok: true, id: req.params.id, name });
  } catch (e) { next(e); }
});

app.delete("/api/categories/:id", async (req, res, next) => {
  try {
    const { rowCount } = await pool.query("DELETE FROM categories WHERE id = $1", [req.params.id]);
    if (!rowCount) return res.status(404).json({ ok: false, error: "not found" });
    res.json({ ok: true }); // products' category_id -> NULL via ON DELETE SET NULL
  } catch (e) { next(e); }
});

/* ---------------- shipping alert outbox (admin) ---------------- */
app.get("/api/alerts", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT sa.*, o.order_number FROM shipping_alerts sa
       JOIN orders o ON o.id = sa.order_id
       ORDER BY sa.created_at DESC LIMIT 100`);
    res.json(rows);
  } catch (e) { next(e); }
});

/* ---------------- mock payments (server-side seam) ---------------- */
function mockDelay() { return 1000 + Math.random() * 1000; }

app.post("/api/payments/mock", async (req, res, next) => {
  try {
    const b = req.body || {};
    const amount_cents = Math.round(Number(b.amount_cents));
    const card = b.card || {};
    if (!Number.isFinite(amount_cents) || amount_cents <= 0)
      return res.status(422).json({ ok: false, code: "invalid_amount", message: "Amount must be positive." });
    const digits = String(card.number || "").replace(/\D/g, "");
    if (digits.length < 13)
      return res.status(422).json({ ok: false, code: "invalid_card", message: "Card number looks wrong." });
    await new Promise((r) => setTimeout(r, mockDelay()));
    // Classic Stripe test pattern: cards ending 0002 are declined.
    if (/0002$/.test(digits))
      return res.status(402).json({ ok: false, code: "card_declined", message: "Your card was declined. Try a different card." });
    res.json({
      ok: true, id: "pi_mock_" + Math.random().toString(36).slice(2, 10),
      status: "succeeded", amount_cents, currency: b.currency || "usd"
    });
  } catch (e) { next(e); }
});

/* ---------------- orders ---------------- */
async function createOrder(input) {
  const items = input.items;
  if (!Array.isArray(items) || !items.length) {
    const e = new Error("no items"); e.status = 422; throw e;
  }
  const a = input.address || {};
  for (const f of ["name", "street", "city", "state", "zip"])
    if (!String(a[f] || "").trim()) {
      const e = new Error("address." + f + " required"); e.status = 422; throw e;
    }
  const method = input.ship_method === "express" ? "express" : "standard";

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let subtotal = 0;
    const lines = [];
    for (const it of items) {
      const { rows } = await client.query("SELECT * FROM products WHERE id = $1 FOR UPDATE", [it.product_id]);
      if (!rows.length) { const e = new Error("unknown product"); e.status = 422; throw e; }
      const p = rows[0];
      const qty = parseInt(it.qty, 10);
      if (!qty || qty < 1) { const e = new Error("bad qty"); e.status = 422; throw e; }
      if (p.inventory < qty) {
        const e = new Error("insufficient stock for " + p.name);
        e.status = 409; throw e;
      }
      await client.query("UPDATE products SET inventory = inventory - $1 WHERE id = $2", [qty, p.id]);
      subtotal += p.price_cents * qty;
      lines.push({ product_id: p.id, product_name: p.name, qty, unit_price_cents: p.price_cents });
    }

    const tax = Math.round(subtotal * taxRate(a.state));
    const shipping = shipCents(method, subtotal);
    const total = subtotal + tax + shipping;
    const id = uid("o");
    const order_number = "DP-" + Math.random().toString(36).slice(2, 8).toUpperCase();
    const addr = {
      name: a.name.trim(), street: a.street.trim(), city: a.city.trim(),
      state: String(a.state).toUpperCase(), zip: a.zip.trim()
    };
    await client.query(
      `INSERT INTO orders
       (id, order_number, customer_name, street, city, state, zip,
        subtotal_cents, tax_cents, shipping_cents, total_cents,
        ship_method, payment_id, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'paid')`,
      [id, order_number, addr.name, addr.street, addr.city, addr.state, addr.zip,
       subtotal, tax, shipping, total, method, input.payment_id || null]
    );
    for (const l of lines) {
      await client.query(
        "INSERT INTO order_items (id, order_id, product_id, product_name, qty, unit_price_cents) VALUES ($1,$2,$3,$4,$5,$6)",
        [uid("oi"), id, l.product_id, l.product_name, l.qty, l.unit_price_cents]
      );
    }
    // Queue the shipping alert in the same transaction — no SMTP in serverless.
    // (Resend/Postmark API is the graduation path, at this exact spot.)
    const { rows: orows } = await client.query("SELECT * FROM orders WHERE id = $1", [id]);
    await queueShippingAlert(client, orows[0], lines);
    await client.query("COMMIT");

    return {
      id, order_number, status: "paid",
      subtotal_cents: subtotal, tax_cents: tax, shipping_cents: shipping,
      total_cents: total, ship_method: method, payment_id: input.payment_id || null,
      address: addr, items: lines
    };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

app.post("/api/orders", async (req, res, next) => {
  try {
    const order = await createOrder(req.body || {});
    res.status(201).json({ ok: true, order });
  } catch (e) {
    // Don't leak stack traces; 409 (insufficient stock) is a normal outcome.
    res.status(e.status || 500).json({ ok: false, error: e.message || "order failed" });
  }
});

app.get("/api/orders", async (req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT * FROM orders ORDER BY created_at DESC LIMIT 100");
    res.json(rows);
  } catch (e) { next(e); }
});

app.get("/api/orders/:id", async (req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT * FROM orders WHERE id = $1 OR order_number = $1", [req.params.id]);
    if (!rows.length) return res.status(404).json({ ok: false, error: "not found" });
    const o = rows[0];
    const { rows: items } = await pool.query(
      "SELECT product_id, product_name, qty, unit_price_cents FROM order_items WHERE order_id = $1", [o.id]);
    o.items = items;
    res.json(o);
  } catch (e) { next(e); }
});

/* ---------------- fallback + errors ---------------- */
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ ok: false, error: "not found" });
  next(); // express.static already handled real files; fall through otherwise
});
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error("api error:", err.message);
  res.status(500).json({ ok: false, error: "internal error" });
});

module.exports = app;
