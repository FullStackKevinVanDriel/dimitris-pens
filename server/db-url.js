/* Which Postgres a process talks to (#24).
 *
 * Vercel Preview deployments use their own Neon branch through Preview-only
 * variables, PREVIEW_POSTGRES_URL (pooled) and PREVIEW_POSTGRES_URL_NON_POOLING
 * (direct, for migrations), so a preview never reads or writes the live
 * shop's data. Everywhere else (production, local, CI) the usual
 * POSTGRES_URL / DATABASE_URL apply.
 *
 * A preview without its own database falls back to the shared one for the
 * app (with a warning) but gets no migration URL, so a preview build can
 * never migrate the production database.
 */
"use strict";

const isPreview = (env) => env.VERCEL_ENV === "preview";

function appUrl(env = process.env) {
  if (isPreview(env) && env.PREVIEW_POSTGRES_URL)
    return env.PREVIEW_POSTGRES_URL;
  return env.POSTGRES_URL || env.DATABASE_URL || null;
}

// node-pg-migrate's session lock needs a direct (non-pooled) connection.
function migrateUrl(env = process.env) {
  if (isPreview(env))
    return (
      env.PREVIEW_POSTGRES_URL_NON_POOLING || env.PREVIEW_POSTGRES_URL || null
    );
  return (
    env.POSTGRES_URL_NON_POOLING ||
    env.DATABASE_URL_UNPOOLED ||
    env.POSTGRES_URL ||
    env.DATABASE_URL ||
    null
  );
}

const previewWithoutOwnDb = (env = process.env) =>
  isPreview(env) && !env.PREVIEW_POSTGRES_URL;

module.exports = { appUrl, migrateUrl, isPreview, previewWithoutOwnDb };
