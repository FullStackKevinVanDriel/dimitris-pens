/* Dimitris Pens — crypto helpers (node:crypto only, no native deps).
 *
 * PII field encryption: AES-256-GCM. Stored format (TEXT column):
 *   enc:v1:<keyId>:<iv b64>:<tag b64>:<ciphertext b64>
 * keyId is the first 8 hex chars of sha256(key), so rotated-out keys listed
 * in PII_ENC_KEYS_PREVIOUS can still decrypt old rows. Values without the
 * `enc:` prefix are treated as legacy plaintext (db.js re-encrypts them on boot).
 *
 * Admin password hashing: see password.js (re-exported here).
 */
"use strict";

const crypto = require("crypto");
const config = require("./config");

const keyId = (key) =>
  crypto.createHash("sha256").update(key).digest("hex").slice(0, 8);
const KEYS = new Map(
  [config.piiKey, ...config.piiPreviousKeys].map((k) => [keyId(k), k]),
);
const CURRENT_ID = keyId(config.piiKey);

function isEncrypted(v) {
  return typeof v === "string" && v.startsWith("enc:v1:");
}

function encrypt(plain) {
  if (plain == null) return plain;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", config.piiKey, iv);
  const ct = Buffer.concat([c.update(String(plain), "utf8"), c.final()]);
  return [
    "enc",
    "v1",
    CURRENT_ID,
    iv.toString("base64"),
    c.getAuthTag().toString("base64"),
    ct.toString("base64"),
  ].join(":");
}

function decrypt(stored) {
  if (!isEncrypted(stored)) return stored; // legacy plaintext / null
  const [, , kid, iv, tag, ct] = stored.split(":");
  const key = KEYS.get(kid);
  if (!key)
    throw new Error(
      "PII key " + kid + " not configured (add it to PII_ENC_KEYS_PREVIOUS)",
    );
  const d = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(iv, "base64"),
  );
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([
    d.update(Buffer.from(ct, "base64")),
    d.final(),
  ]).toString("utf8");
}

/* True when a value was written with an old key and should be re-encrypted. */
function needsRotation(stored) {
  return !isEncrypted(stored) || stored.split(":")[2] !== CURRENT_ID;
}

// Password hashing lives in password.js (no config dependency, so the
// setup scripts can use it before any secrets exist).
const { hashPassword, verifyPassword } = require("./password");

const randomToken = (bytes = 32) =>
  crypto.randomBytes(bytes).toString("base64url");
const sha256 = (s) =>
  crypto.createHash("sha256").update(String(s)).digest("hex");

const currentPrefix = () => "enc:v1:" + CURRENT_ID + ":";

module.exports = {
  currentPrefix,
  encrypt,
  decrypt,
  isEncrypted,
  needsRotation,
  hashPassword,
  verifyPassword,
  randomToken,
  sha256,
};
