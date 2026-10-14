/* Print an ADMIN_PASSWORD_HASH for a new admin password.
 *   npm run hash-password            (prompts, input hidden)
 *   ADMIN_PASSWORD=... npm run hash-password
 * Paste the output into .env locally, or into Vercel → Settings →
 * Environment Variables (then redeploy). Existing sessions stay valid
 * until they expire; delete rows from admin_sessions to force logout.
 */
"use strict";

const { hashPassword } = require("../server/password");
const { readNewPassword } = require("./prompt");

readNewPassword().then((pw) => {
  if (pw.length < 12) throw new Error("Use at least 12 characters.");
  console.log(hashPassword(pw));
}).catch((e) => { console.error(e.message); process.exit(1); });
