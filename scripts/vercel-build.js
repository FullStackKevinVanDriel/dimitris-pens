/* Vercel runs this as the build step (package.json "vercel-build").
 *
 * Applies pending migrations before the new deployment goes live — on
 * Production builds always, on Preview builds only when MIGRATE_ON_BUILD=true
 * (Preview currently shares the Production database; set it once Preview has
 * its own Neon branch). A failed migration fails the build, so broken schema
 * changes never deploy.
 */
"use strict";

const { migrate } = require("./migrate");

const env = process.env.VERCEL_ENV || "development";
if (env !== "production" && process.env.MIGRATE_ON_BUILD !== "true") {
  console.log(`[vercel-build] ${env} build: skipping migrations (set MIGRATE_ON_BUILD=true to run them)`);
  process.exit(0);
}
console.log(`[vercel-build] ${env} build: applying migrations`);
migrate("up").then((done) => {
  console.log(`[vercel-build] ${done.length} migration(s) applied`);
}).catch((e) => {
  console.error("[vercel-build] migration failed:", e.message);
  process.exit(1);
});
