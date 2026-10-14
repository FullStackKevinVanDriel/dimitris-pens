/* Dimitris Pens — local entry point.
 * Run:  POSTGRES_URL=... node server/index.js   (or: npm start from repo root)
 * On Vercel this file is NOT used; api/index.js exports the app instead.
 */
"use strict";

let ready, PORT;
try {
  ({ ready } = require("./db"));
  PORT = require("./config").port;
} catch (err) {
  console.error("failed to start:", err.message);
  process.exit(1);
}

ready.then(() => {
  const app = require("./app");
  app.listen(PORT, () => {
    console.log(`dimitris-pens on :${PORT} (frontend + api)`);
  });
}).catch((err) => {
  console.error("failed to start:", err.message);
  process.exit(1);
});
