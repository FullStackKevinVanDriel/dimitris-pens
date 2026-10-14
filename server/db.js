/* Dimitris Pens — Postgres setup (node-postgres).
 *
 * Connection string from POSTGRES_URL or DATABASE_URL (see server/config.js).
 * SSL (with certificate verification) is enabled automatically for Neon /
 * Vercel Postgres or when PGSSL=true; local docker Postgres works without it.
 *
 * Exports { pool, uid, ready }: `ready` resolves once the schema is applied,
 * the catalog is seeded (only when categories is empty), and any plaintext
 * or old-key PII rows have been (re-)encrypted.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");

const config = require("./config");

const pool = new Pool({
  connectionString: config.dbUrl,
  ...(config.pgSSL ? { ssl: { rejectUnauthorized: !config.pgSSLInsecure } } : {})
});
pool.on("error", (err) => console.error("pg pool error:", err.message));

function uid(prefix) {
  return prefix + crypto.randomBytes(9).toString("base64url");
}

// PII columns encrypted at rest (AES-256-GCM, see server/crypto.js).
const PII_COLUMNS = {
  orders: ["customer_name", "street", "city", "zip"],
  shipping_alerts: ["body"]
};

/* Encrypts legacy plaintext rows and re-encrypts rows written with a
 * rotated-out key. Idempotent; a no-op once everything is current. */
async function encryptPII(client) {
  const pii = require("./crypto");
  for (const [table, cols] of Object.entries(PII_COLUMNS)) {
    // Only fetch rows not already under the current key (cheap on cold start).
    const prefix = pii.currentPrefix() + "%";
    const { rows } = await client.query(
      `SELECT id, ${cols.join(", ")} FROM ${table} WHERE ` +
      cols.map((c) => `(${c} IS NOT NULL AND ${c} NOT LIKE $1)`).join(" OR "), [prefix]);
    let n = 0;
    for (const r of rows) {
      let vals;
      try {
        vals = cols.map((c) => (r[c] == null ? null : pii.encrypt(pii.decrypt(r[c]))));
      } catch (e) {
        // Unknown key: leave the row alone rather than take the shop down.
        console.error(`PII: cannot decrypt ${table} ${r.id}: ${e.message}`);
        continue;
      }
      await client.query(
        `UPDATE ${table} SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(", ")} WHERE id = $1`,
        [r.id, ...vals]);
      n++;
    }
    if (n) console.log(`encrypted PII in ${n} ${table} row(s)`);
  }
}

const SEED_CATS = [
  { id: "c1", name: "Fountain Pens", sort_order: 0 },
  { id: "c2", name: "Rollerballs", sort_order: 1 },
  { id: "c3", name: "Pencils", sort_order: 2 }
];
// id, name, description, price_cents, category_id, image_key, inventory, sort_order
const SEED_PRODUCTS = [
  ["p1", "The Meridian", "Ebonite fountain pen with a tuned steel nib. Writes wet and smooth.", 18500, "c1", "classic", 4, 0],
  ["p2", "Harbor & Pine", "Forest-green ebonite, brass trim, medium nib ground in-house.", 24000, "c1", "forest", 2, 1],
  ["p3", "The Night Desk", "Midnight-blue lacquer over brass. Our finest nib, broad italic.", 32000, "c1", "midnight", 1, 2],
  ["p4", "Commuter Roller", "Black anodized aluminum rollerball. Takes standard refills.", 8500, "c2", "roller", 9, 3],
  ["p5", "Brass Daily", "Solid brass body that picks up a patina. Weighted for long notes.", 12000, "c2", "brassrb", 6, 4],
  ["p6", "Cedar No. 2", "Hand-turned cedar mechanical pencil, 0.7mm, brass clutch.", 4500, "c3", "pencil", 12, 5],
  ["p7", "The Draftsman", "Knurled grip drafting pencil, 0.5mm. A shop favorite — back soon.", 6800, "c3", "pencil", 0, 6]
];

async function seed(client) {
  const { rows } = await client.query("SELECT COUNT(*)::int AS n FROM categories");
  if (rows[0].n > 0) return;
  for (const c of SEED_CATS) {
    await client.query(
      "INSERT INTO categories (id, name, sort_order) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING",
      [c.id, c.name, c.sort_order]
    );
  }
  for (const p of SEED_PRODUCTS) {
    await client.query(
      `INSERT INTO products
       (id, name, description, price_cents, category_id, image_key, inventory, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING`,
      p
    );
  }
  console.log("seeded catalog:", SEED_CATS.length, "categories,", SEED_PRODUCTS.length, "products");
}

const ready = (async () => {
  const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  const client = await pool.connect();
  try {
    await client.query(schema);
    await seed(client);
    await encryptPII(client);
  } finally {
    client.release();
  }
})().catch((err) => {
  console.error("DB init failed:", err.message);
  throw err;
});

module.exports = { pool, uid, ready, PII_COLUMNS };
