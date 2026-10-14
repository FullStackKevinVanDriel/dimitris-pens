/* Dimitris Pens — admin password hashing (scrypt, node:crypto only).
 * Format: scrypt$N$r$p$<salt b64>$<hash b64>. No config dependency.
 */
"use strict";

const crypto = require("crypto");

const SCRYPT = { N: 16384, r: 8, p: 1 };

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 32, SCRYPT);
  return [
    "scrypt",
    SCRYPT.N,
    SCRYPT.r,
    SCRYPT.p,
    salt.toString("base64"),
    hash.toString("base64"),
  ].join("$");
}

function verifyPassword(password, stored) {
  const parts = String(stored || "").split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, N, r, p, salt, hash] = parts;
  const expected = Buffer.from(hash, "base64");
  const got = crypto.scryptSync(
    String(password),
    Buffer.from(salt, "base64"),
    expected.length,
    { N: +N, r: +r, p: +p },
  );
  return crypto.timingSafeEqual(got, expected);
}

module.exports = { hashPassword, verifyPassword };
