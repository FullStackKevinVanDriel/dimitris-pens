/* Dimitris Pens — Postgres setup (node-postgres).
 *
 * Connection string from POSTGRES_URL or DATABASE_URL (see server/config.js).
 * SSL (with certificate verification) is enabled automatically for Neon /
 * Vercel Postgres or when PGSSL=true; local docker Postgres works without it.
 *
 * Exports { pool, uid, ready, init }: `ready`/`init()` resolve once pending
 * migrations have been checked and any plaintext or old-key PII rows have
 * been (re-)encrypted. Schema + seed data are migrations (see migrations/).
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


// Cold-start init. Schema changes are NOT applied here — they're versioned
// migrations (migrations/, `npm run migrate`, run by the Vercel build).
// Boot only warns about pending migrations and runs the PII backfill /
// key-rotation pass, serialized across instances with an advisory lock.
// A failure (e.g. Neon waking from sleep) is not cached: the next call
// retries instead of failing the instance forever.
const INIT_LOCK = 4242001;
const MIGRATIONS_DIR = path.join(__dirname, "..", "migrations");

async function checkMigrations(client) {
  // migrations/ ships with the function via vercel.json includeFiles; if it's
  // ever missing, skip the check (the build already ran the migrations).
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).map((f) => f.replace(/\.sql$/, ""));
  const { rows: t } = await client.query("SELECT to_regclass('public.pgmigrations') AS t");
  const applied = new Set();
  if (t[0].t) (await client.query("SELECT name FROM pgmigrations")).rows.forEach((r) => applied.add(r.name));
  const pending = files.filter((f) => !applied.has(f));
  if (pending.length) {
    console.error(`DB has ${pending.length} pending migration(s): ${pending.join(", ")} — run \`npm run migrate\``);
  }
  return pending;
}

let initPromise = null;
function init() {
  if (!initPromise) {
    initPromise = (async () => {
      const client = await pool.connect();
      try {
        const pending = await checkMigrations(client);
        if (pending.includes("001_baseline")) throw new Error("database not migrated — run `npm run migrate`");
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock($1)", [INIT_LOCK]);
        await encryptPII(client);
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK").catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    })().catch((err) => {
      console.error("DB init failed:", err.message);
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}
const ready = init();
ready.catch(() => {}); // callers that care await init() themselves

module.exports = { pool, uid, ready, init, PII_COLUMNS };
