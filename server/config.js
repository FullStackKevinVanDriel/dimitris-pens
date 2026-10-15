/* Dimitris Pens — configuration + secrets.
 *
 * Secrets come from the process environment. Locally, a git-ignored `.env`
 * file is loaded with dotenv (generate one with `npm run setup`). On Vercel,
 * set them as encrypted Environment Variables per environment (Production /
 * Preview) — never commit them. See .env.example and docs/DEPLOYMENT.md.
 *
 * Required:
 *   POSTGRES_URL / DATABASE_URL  Postgres connection string (Vercel Preview uses
 *                                PREVIEW_POSTGRES_URL instead; see db-url.js)
 *   ADMIN_PASSWORD_HASH          scrypt hash from `npm run hash-password`
 *   PII_ENC_KEY                  base64, 32 bytes — AES-256-GCM key for PII
 * Optional:
 *   PII_ENC_KEYS_PREVIOUS        comma-separated old keys (decrypt-only, for rotation)
 *   PGSSL=true                   force TLS (auto-on for neon.tech / vercel-storage)
 *   PGSSL_INSECURE=true          skip TLS cert verification (avoid)
 *   COOKIE_SECURE=false          allow the admin cookie over plain http (local dev only)
 *   PORT                         default 3001
 */
"use strict";

const path = require("path");
require("dotenv").config({
  path: path.join(__dirname, "..", ".env"),
  quiet: true,
});

const env = process.env;
const isProd = env.NODE_ENV === "production" || env.VERCEL_ENV === "production";

function decodeKey(b64, name) {
  const buf = Buffer.from(String(b64 || "").trim(), "base64");
  if (buf.length !== 32) {
    throw new Error(
      `${name} must be 32 bytes, base64-encoded (got ${buf.length} bytes). Run: npm run setup`,
    );
  }
  return buf;
}

function load() {
  const missing = [];
  const { appUrl, previewWithoutOwnDb } = require("./db-url");
  const dbUrl = appUrl(env);
  if (previewWithoutOwnDb(env) && dbUrl) {
    console.warn("Preview deployment without PREVIEW_POSTGRES_URL: using the shared database");
  }
  if (!dbUrl) missing.push("POSTGRES_URL");
  if (!env.ADMIN_PASSWORD_HASH) missing.push("ADMIN_PASSWORD_HASH");
  if (!env.PII_ENC_KEY) missing.push("PII_ENC_KEY");
  if (missing.length) {
    throw new Error(
      "Missing required env: " +
        missing.join(", ") +
        ". Locally run `npm run setup` to create .env; on Vercel set them under Project → Settings → Environment Variables.",
    );
  }
  if (!/^scrypt\$/.test(env.ADMIN_PASSWORD_HASH)) {
    throw new Error(
      "ADMIN_PASSWORD_HASH must be a scrypt hash from `npm run hash-password` (not a plain password).",
    );
  }
  return {
    isProd,
    dbUrl,
    pgSSL: /neon\.tech|vercel-storage\.com/.test(dbUrl) || env.PGSSL === "true",
    pgSSLInsecure: env.PGSSL_INSECURE === "true",
    adminPasswordHash: env.ADMIN_PASSWORD_HASH,
    piiKey: decodeKey(env.PII_ENC_KEY, "PII_ENC_KEY"),
    piiPreviousKeys: String(env.PII_ENC_KEYS_PREVIOUS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((k, i) => decodeKey(k, `PII_ENC_KEYS_PREVIOUS[${i}]`)),
    cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE !== "false" : isProd,
    port: parseInt(env.PORT || "3001", 10),
  };
}

module.exports = load();
