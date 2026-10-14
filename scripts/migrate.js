/* Database migrations (node-pg-migrate, plain SQL files in migrations/).
 *
 *   npm run migrate                    apply all pending migrations
 *   npm run migrate:down               roll back the most recent one
 *   npm run migrate:create <name>      new migrations/<timestamp>_<name>.sql
 *
 * Reads POSTGRES_URL_NON_POOLING / DATABASE_URL_UNPOOLED when present (Vercel's
 * Neon integration sets them), else POSTGRES_URL / DATABASE_URL (and .env locally). Only the database
 * URL is needed — not the admin/PII secrets. History lives in the
 * `pgmigrations` table; node-pg-migrate holds an advisory lock so two runs
 * can't apply the same migration at once. Each migration runs in its own
 * transaction.
 *
 * Keep migrations backward-compatible (expand → deploy → contract): the
 * previous deployment keeps serving while a new build migrates.
 */
"use strict";

const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env"), quiet: true });

const DIR = path.join(__dirname, "..", "migrations");

function connection(url) {
  const ssl = /neon\.tech|vercel-storage\.com/.test(url) || process.env.PGSSL === "true";
  return ssl
    ? { connectionString: url, ssl: { rejectUnauthorized: process.env.PGSSL_INSECURE !== "true" } }
    : { connectionString: url };
}

async function migrate(direction = "up", opts = {}) {
  // Prefer the direct (non-pooled) URL: node-pg-migrate's session advisory
  // lock isn't reliable through Neon's PgBouncer pooler (transaction mode).
  const e = process.env;
  const url = opts.databaseUrl || e.POSTGRES_URL_NON_POOLING || e.DATABASE_URL_UNPOOLED || e.POSTGRES_URL || e.DATABASE_URL;
  if (!url) throw new Error("Missing POSTGRES_URL (or DATABASE_URL).");
  const { runner } = require("node-pg-migrate");
  return runner({
    databaseUrl: connection(url),
    dir: DIR,
    direction,
    count: direction === "down" ? 1 : Infinity,
    migrationsTable: "pgmigrations",
    checkOrder: true,
    log: opts.quiet ? () => {} : console.log
  });
}

function create(name) {
  const slug = String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (!slug) throw new Error("Usage: npm run migrate:create <name>");
  const file = path.join(DIR, `${Date.now()}_${slug}.sql`);
  fs.writeFileSync(file, "-- Up Migration\n\n\n-- Down Migration\n\n");
  console.log("created", path.relative(process.cwd(), file));
}

if (require.main === module) {
  const [cmd = "up", arg] = process.argv.slice(2);
  const run = cmd === "create" ? Promise.resolve(create(arg)) : migrate(cmd);
  run.then((done) => {
    if (Array.isArray(done)) console.log(done.length ? `applied ${done.length} migration(s)` : "no pending migrations");
  }).catch((e) => { console.error("migration failed:", e.message); process.exit(1); });
}

module.exports = { migrate, DIR };
