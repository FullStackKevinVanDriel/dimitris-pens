/* Dimitris Pens — admin authentication.
 *
 * Single admin password (scrypt hash in ADMIN_PASSWORD_HASH). A successful
 * login creates a random session token: the browser gets it in an HttpOnly,
 * SameSite=Strict cookie, the DB stores only its sha256 (admin_sessions).
 * Sessions last 8 hours. Failed logins are rate limited per client IP
 * (10 failures / 15 min) in the DB so it works across serverless instances.
 *
 * CSRF: SameSite=Strict cookie + mutating admin requests must be JSON and,
 * when the browser sends an Origin header, it must match the request host.
 */
"use strict";

const { pool } = require("./db");
const config = require("./config");
const { verifyPassword, randomToken, sha256 } = require("./crypto");

const COOKIE = config.cookieSecure ? "__Host-dp_admin" : "dp_admin";
const SESSION_HOURS = 8;
const MAX_FAILURES = 10;
const FAILURE_WINDOW_MIN = 15;

function readCookie(req, name) {
  const header = req.headers.cookie || "";
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name)
      return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

function setCookie(res, value, maxAgeSec) {
  const attrs = [
    `${COOKIE}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${maxAgeSec}`,
  ];
  if (config.cookieSecure) attrs.push("Secure");
  res.setHeader("Set-Cookie", attrs.join("; "));
}

async function sessionValid(req) {
  const token = readCookie(req, COOKIE);
  if (!token) return false;
  const { rows } = await pool.query(
    "SELECT 1 FROM admin_sessions WHERE token_hash = $1 AND expires_at > NOW()",
    [sha256(token)],
  );
  return rows.length > 0;
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // same-origin GETs / non-browser clients
  try {
    return new URL(origin).host === req.headers.host;
  } catch (e) {
    return false;
  }
}

/* Express middleware: 401 unless a valid admin session cookie is present. */
function requireAdmin(req, res, next) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    if (!sameOrigin(req))
      return res
        .status(403)
        .json({ ok: false, error: "cross-origin request blocked" });
    if (req.method !== "DELETE" && !req.is("application/json"))
      return res.status(415).json({ ok: false, error: "JSON required" });
  }
  sessionValid(req)
    .then((ok) => {
      if (!ok)
        return res
          .status(401)
          .json({ ok: false, error: "admin login required" });
      next();
    })
    .catch(next);
}

const clientIpHash = (req) => sha256(req.ip || "unknown");

async function login(req, res) {
  if (!sameOrigin(req))
    return res
      .status(403)
      .json({ ok: false, error: "cross-origin request blocked" });
  const ipHash = clientIpHash(req);
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM login_failures
     WHERE ip_hash = $1 AND created_at > NOW() - make_interval(mins => $2)`,
    [ipHash, FAILURE_WINDOW_MIN],
  );
  if (rows[0].n >= MAX_FAILURES)
    return res
      .status(429)
      .json({
        ok: false,
        error: "too many attempts — try again in 15 minutes",
      });

  const password = String((req.body || {}).password || "");
  if (
    !password ||
    password.length > 200 ||
    !verifyPassword(password, config.adminPasswordHash)
  ) {
    await pool.query("INSERT INTO login_failures (ip_hash) VALUES ($1)", [
      ipHash,
    ]);
    return res.status(401).json({ ok: false, error: "wrong password" });
  }

  await pool.query(
    "DELETE FROM login_failures WHERE ip_hash = $1 OR created_at < NOW() - INTERVAL '1 day'",
    [ipHash],
  );
  await pool.query("DELETE FROM admin_sessions WHERE expires_at < NOW()");
  const token = randomToken();
  await pool.query(
    "INSERT INTO admin_sessions (token_hash, expires_at) VALUES ($1, NOW() + make_interval(hours => $2))",
    [sha256(token), SESSION_HOURS],
  );
  setCookie(res, token, SESSION_HOURS * 3600);
  res.json({ ok: true });
}

async function logout(req, res) {
  const token = readCookie(req, COOKIE);
  if (token)
    await pool.query("DELETE FROM admin_sessions WHERE token_hash = $1", [
      sha256(token),
    ]);
  setCookie(res, "", 0);
  res.json({ ok: true });
}

async function session(req, res) {
  res.json({ admin: await sessionValid(req) });
}

module.exports = { requireAdmin, login, logout, session };
