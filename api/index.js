/* Vercel serverless entry point.
 * The Express app (server/app.js) serves both the static frontend and the
 * /api/* routes, so a single catch-all rewrite (see vercel.json) is enough.
 * DB init (schema + seed + PII backfill) completes before a request is handled.
 */
"use strict";

const { init } = require("../server/db");

// init() is memoized and retries after a failure, so one bad cold start
// (e.g. the database waking up) doesn't break this instance for good.
module.exports = async (req, res) => {
  try {
    await init();
  } catch (err) {
    res.statusCode = 503;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Retry-After", "2");
    return res.end(JSON.stringify({ ok: false, error: "starting up, try again" }));
  }
  return require("../server/app")(req, res);
};
