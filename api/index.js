/* Vercel serverless entry point.
 * The Express app (server/app.js) serves both the static frontend and the
 * /api/* routes, so a single catch-all rewrite (see vercel.json) is enough.
 * DB init (schema + seed) completes before the first request is handled.
 */
"use strict";

const { ready } = require("../server/db");

const appPromise = ready.then(() => require("../server/app"));

module.exports = (req, res) => appPromise.then((app) => app(req, res));
