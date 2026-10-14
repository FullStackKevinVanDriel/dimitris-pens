# Security review — 2026-10-14

Review of the v2 shop (commit `2e6cc8d`) and what v3 changed.

## Findings and fixes

| # | Severity | Finding (v2) | Fix (v3) |
|---|---|---|---|
| 1 | Critical | **No admin auth.** Every write API (`POST/PUT/DELETE /api/products`, `/api/categories`, reorder) was open to anyone. "Admin mode" was a `localStorage` flag / `?admin=1` toggle on the client. | Password login (`POST /api/admin/login`), scrypt hash in `ADMIN_PASSWORD_HASH`. Server-side `requireAdmin` on every admin route. Session = random token in an `HttpOnly; SameSite=Strict` (and `Secure` + `__Host-` in prod) cookie. Only the sha256 of the token is stored in `admin_sessions`, and sessions expire after 8h. |
| 2 | Critical | **Customer data was public.** `GET /api/orders` returned every order's name and address, and so did `GET /api/alerts` (in the alert body). `GET /api/orders/:id` took a guessable 6-character order number. | All three are admin-only. Order numbers are now 8 characters from `crypto.randomBytes`. |
| 3 | High | **Free orders.** `POST /api/orders` accepted any `payment_id` string, so anyone could buy without paying. | A `payments` ledger is written by the payment endpoint. An order must reference a succeeded payment that hasn't been used and whose amount equals the server's total. Each payment can be used once, checked inside the order transaction. |
| 4 | High | **PII stored in plaintext.** | AES-256-GCM encryption of `orders.customer_name/street/city/zip` and `shipping_alerts.body` (`server/crypto.js`). Existing plaintext rows are encrypted on boot. Supports key rotation through `PII_ENC_KEYS_PREVIOUS`. |
| 5 | High | **Stored XSS via product photo.** `image_data_url` was put into `<img src="...">` unescaped, so a value like `" onerror="...` would run script for every visitor. | The server only accepts `data:image/(png\|jpeg\|webp\|gif);base64,...` (no SVG). The client re-checks the value and escapes it. `image_key` is checked against a whitelist. |
| 6 | Medium | No security headers. | `helmet` with a strict CSP (`script-src 'self'`, no inline script, `frame-ancestors 'none'`), plus HSTS, nosniff, and a referrer policy. |
| 7 | Medium | DB TLS used `rejectUnauthorized: false`, which allows man-in-the-middle attacks on the Postgres connection. | Certificates are verified. `PGSSL_INSECURE=true` is an explicit opt-out. |
| 8 | Medium | 500 errors on `POST /api/orders` returned raw `e.message`, which could leak DB details. | Central error handler. Only 4xx errors return their (safe) message; 500s are generic. |
| 9 | Low | 6 MB JSON body limit on every route. | 5 MB only on `/api/products` (photos), 100 KB everywhere else. |
| 10 | Low | `Math.random()` for IDs and order numbers. | `crypto.randomBytes`. |
| 11 | Low | `package-lock.json` was git-ignored, so deploys weren't reproducible. | Lockfile committed. |
| 13 | Medium | **Source files were publicly downloadable.** Vercel served the repo root as static files ahead of the API rewrite, so `/server/app.js`, `/smoke/test.js`, `/docs/...` all returned 200. | `vercel.json` `outputDirectory: server/public`, so only the four public assets are static. `.vercelignore` keeps `.env` out of CLI uploads. |
| 12 | Low | Checkout tax/shipping logic was duplicated in the browser and could drift from the server. | The browser shows `POST /api/orders/quote` (server math) and charges exactly that. |

Login is rate limited to 10 failures per IP per 15 minutes. The counter is stored in the DB, so it works across serverless instances. Admin writes are also CSRF-hardened: they must be JSON, and a foreign `Origin` header gets a 403.

## Still open (needs a decision or outside access)

- **The live site at `dimitris-pens.vercel.app` runs v2.** Every hole in the table above is live there until v3 is deployed. If real orders have gone through it, treat that data as exposed.
- **The repo is public.** No secrets are committed (verified), but a shop repo is usually better private.
- ~~GitHub Pages was serving `main`~~ — disabled 2026-10-14.
- **`main` has no branch protection.** Require PRs and the smoke test before merging.
- **Payments are mocked.** The mock endpoint receives full card numbers. They are never stored or logged, but the real Stripe integration must use Stripe Elements so card data never touches this server (PCI SAQ-A). See the TODO in `server/app.js`.
- Single shared admin password, no 2FA. Fine for one owner. Use per-user accounts or an IdP if more people need access.
- Key loss: if `PII_ENC_KEY` is lost, encrypted customer data can't be recovered. Keep it in a password manager as well as in Vercel.
