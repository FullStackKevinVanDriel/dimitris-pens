/* Dimitris Pens — shipping alert email delivery (Resend).
 *
 * Env (all optional; without RESEND_API_KEY alerts just stay "queued" in
 * the admin Outbox, exactly as before):
 *   RESEND_API_KEY   Resend API key (Vercel: Sensitive env var)
 *   RESEND_FROM      sender, default "Dimitris Pens <onboarding@resend.dev>".
 *                    onboarding@resend.dev can only send to the Resend
 *                    account's own email; verify a domain to send elsewhere.
 *   RESEND_API_URL   override for tests (default https://api.resend.com/emails)
 *
 * Delivery never throws: the outcome is recorded on the shipping_alerts row
 * (status sent/failed, attempts, last_error) and a failed send can be
 * retried from the Outbox. The alert id is the Resend Idempotency-Key, so a
 * retry after an ambiguous failure can't send a duplicate.
 */
"use strict";

const { pool } = require("./db");
const pii = require("./crypto");

const API_URL = process.env.RESEND_API_URL || "https://api.resend.com/emails";
const FROM = process.env.RESEND_FROM || "Dimitris Pens <onboarding@resend.dev>";
const enabled = () => Boolean(process.env.RESEND_API_KEY);

async function deliverAlert(alertId) {
  if (!enabled()) return { status: "queued" };
  const { rows } = await pool.query("SELECT * FROM shipping_alerts WHERE id = $1", [alertId]);
  if (!rows.length) return { status: "missing" };
  const a = rows[0];
  if (a.status === "sent") return { status: "sent" };

  let status, providerId = null, error = null;
  try {
    const r = await fetch(API_URL, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + process.env.RESEND_API_KEY,
        "Content-Type": "application/json",
        "Idempotency-Key": "shipping-alert-" + a.id
      },
      body: JSON.stringify({ from: FROM, to: [a.recipient], subject: a.subject, text: pii.decrypt(a.body) }),
      signal: AbortSignal.timeout(8000)
    });
    const data = await r.json().catch(() => ({}));
    if (r.ok) { status = "sent"; providerId = data.id || null; }
    else { status = "failed"; error = `HTTP ${r.status}: ${String(data.message || data.error || "").slice(0, 200)}`; }
  } catch (e) {
    status = "failed";
    error = e.name === "TimeoutError" ? "timed out" : String(e.message).slice(0, 200);
  }
  await pool.query(
    `UPDATE shipping_alerts SET status = $2, attempts = attempts + 1, provider_id = COALESCE($3, provider_id),
       last_error = $4, sent_at = CASE WHEN $2 = 'sent' THEN NOW() ELSE sent_at END
     WHERE id = $1`,
    [a.id, status, providerId, error]);
  if (error) console.error("shipping alert", a.id, "not sent:", error);
  return { status, error };
}

module.exports = { deliverAlert, enabled };
