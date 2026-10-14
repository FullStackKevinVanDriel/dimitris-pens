/* Dimitris Pens — Postgres setup (node-postgres).
 *
 * Connection string from POSTGRES_URL or DATABASE_URL (required).
 * SSL is enabled automatically for Neon (*.neon.tech) or when PGSSL=true;
 * local docker Postgres works without it.
 *
 * Exports { pool, uid, ready }: `ready` resolves once the schema is applied
 * and the catalog is seeded (seed runs only when categories is empty).
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const connStr = process.env.POSTGRES_URL || process.env.DATABASE_URL;
if (!connStr) {
  throw new Error(
    "Missing POSTGRES_URL (or DATABASE_URL). For local dev: " +
    "docker run -d --name dp-pg -e POSTGRES_PASSWORD=penstest -p 5432:5432 postgres:16, " +
    "then POSTGRES_URL=postgres://postgres:penstest@localhost:5432/postgres node server/index.js"
  );
}
const useSSL = /neon\.tech/.test(connStr) || process.env.PGSSL === "true";

const pool = new Pool({
  connectionString: connStr,
  ...(useSSL ? { ssl: { rejectUnauthorized: false } } : {})
});
pool.on("error", (err) => console.error("pg pool error:", err.message));

function uid(prefix) {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
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
  } finally {
    client.release();
  }
})().catch((err) => {
  console.error("DB init failed:", err.message);
  throw err;
});

module.exports = { pool, uid, ready };
