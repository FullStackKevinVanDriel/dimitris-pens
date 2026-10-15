/* Vercel runs this as the build step (package.json "vercel-build").
 *
 * Applies pending migrations before the new deployment goes live: on
 * Production builds always; on Preview builds when MIGRATE_ON_BUILD=true, and
 * then only against Preview's own Neon branch (PREVIEW_POSTGRES_URL*, see
 * server/db-url.js), never the production database. A failed migration fails
 * the build, so broken schema changes never deploy.
 */
"use strict";

const { migrate } = require("./migrate");

const env = process.env.VERCEL_ENV || "development";
if (env !== "production" && process.env.MIGRATE_ON_BUILD !== "true") {
  console.log(`[vercel-build] ${env} build: skipping migrations (set MIGRATE_ON_BUILD=true to run them)`);
  process.exit(0);
}
if (!require("../server/db-url").migrateUrl(process.env)) {
  console.log(`[vercel-build] ${env} build: no database of its own to migrate (PREVIEW_POSTGRES_URL*); skipping`);
  process.exit(0);
}
console.log(`[vercel-build] ${env} build: applying migrations`);
migrate("up").then((done) => {
  console.log(`[vercel-build] ${done.length} migration(s) applied`);
}).catch((e) => {
  console.error("[vercel-build] migration failed:", e.message);
  process.exit(1);
});
