# Dimitris Pens — custom pen shop

Full-stack shop: Express API + Postgres, with the static frontend served by
the same app. No localStorage for shop data — products, categories,
inventory, orders, and shipping alerts all live in Postgres.

## Run it

```bash
npm install
docker run -d --name dp-pg -e POSTGRES_PASSWORD=penstest -p 5432:5432 postgres:16
npm run setup      # writes .env: asks for an admin password, generates the PII key
npm start          # → http://localhost:3001  (admin: footer "Admin" link or /?admin=1)
```

First boot applies `server/schema.sql` and seeds 7 pens + 3 categories.
Prices are integer cents; tax + shipping are computed server-side.

Secrets and env vars are documented in `.env.example` and `server/config.js`.
The server refuses to start without `POSTGRES_URL`, `ADMIN_PASSWORD_HASH`
and `PII_ENC_KEY`. To change the admin password: `npm run hash-password`.

## Customizing the shop

Log in as admin → **Site settings**. Everything on the page is editable there
and stored in Postgres (`site_settings`): shop name, tagline, announcement
banner, about text, footer, button labels, confirmation message, theme colors
and fonts, tax rates per state, shipping prices/labels, the free-shipping
threshold, and the shipping-alert email. Pens, prices, photos, stock, order
and categories are edited inline on the grid. The fields are defined in
`server/settings.js`; adding a field there makes it appear in the form.

## Security

Admin login protects every write and every customer-data read. Customer
name/address is encrypted at rest (AES-256-GCM). Orders must match a real
payment. See **docs/SECURITY.md** for the full review.

## Deploy (Vercel + Postgres)

**Plan and secrets setup: docs/DEPLOYMENT.md.** (Short version: Vercel *Pro*,
because Hobby forbids commercial use, plus Neon, with secrets in Vercel env vars.)

- `api/index.js` exports the Express app for Vercel's Node runtime.
- `vercel.json` rewrites **everything** to `/api` (one function serves the
  static frontend from `server/public` plus all `/api/*` routes). This keeps
  local (`node server/index.js`) and serverless behavior identical. Tradeoff:
  static assets also run through the function; split later if it matters.
- `server/index.js` only calls `app.listen` when run directly
  (`require.main === module`) — never in the serverless path.
- Connect the Vercel Postgres/Neon integration (injects `POSTGRES_URL`) and
  set `ADMIN_PASSWORD_HASH` + `PII_ENC_KEY`. Seed runs on first boot.

GitHub Pages **cannot** host this app (it's full-stack now) and the Mac mini
is not a target — Vercel is the only deployment path.

## API

Full route list (public vs admin) is in the header comment of `server/app.js`.
Admin routes need the session cookie from `POST /api/admin/login`.

## Shop notes

- **Cart** is in-memory only (no persistence across reloads) — documented
  tradeoff; a cookie-keyed server cart is the next step if it matters.
- **Payments** are mocked server-side (`POST /api/payments/mock`). TODOs in
  `server/app.js` + `server/public/payments.js` mark the real-Stripe path:
  publishable key client-side, `POST /api/payments/intent` (secret key)
  returning `client_secret`, `stripe.confirmCardPayment()` on the client.
- **Shipping alerts**: no SMTP in serverless — paid orders INSERT into
  `shipping_alerts` (status `queued`), listed in admin → Outbox. Graduation
  path is a Resend/Postmark API call where the INSERT happens
  (`queueShippingAlert` in `server/app.js`).
- **Admin mode**: discreet `Admin` link in the footer (or `?admin=1`) opens
  a password prompt. Session lasts 8h; "Log out" in the admin bar ends it.

## Smoke test

```bash
# needs a Postgres you don't mind being wiped (uses dimitris_test db)
POSTGRES_URL=postgres://postgres:penstest@localhost:5432/postgres npm run smoke
# same, but watch it in a real Google Chrome window:
POSTGRES_URL=postgres://postgres:penstest@localhost:5432/postgres npm run smoke:chrome
```
(`cd smoke && npm install` once for Playwright.) The test generates its own
throwaway admin password and PII key, so no `.env` is needed.

Covers the API (auth on every admin route, CSRF origin check, upload
validation, settings validation and public/private split, CRUD, reorder,
mock pay, forged/underpaid/reused payments, order math, inventory, PII
encrypted in the raw DB rows, hashed session tokens) plus the browser flow
(shop → cart → checkout → pay → decline → admin login → outbox → pen CRUD →
categories → site settings → logout), and fails on any JS or CSP error.
