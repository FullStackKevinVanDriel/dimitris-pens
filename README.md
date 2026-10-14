# Dimitris Pens — custom pen shop

Full-stack shop: Express API + Postgres, with the static frontend served by
the same app. No localStorage for shop data — products, categories,
inventory, orders, and shipping alerts all live in Postgres.

## Run it

```bash
npm install

# Postgres: supply a connection string. Local option:
docker run -d --name dp-pg -e POSTGRES_PASSWORD=penstest -p 5432:5432 postgres:16
export POSTGRES_URL=postgres://postgres:penstest@localhost:5432/postgres
# (or export DATABASE_URL — either works; Neon URLs auto-enable SSL)

npm start
# → http://localhost:3001  (default PORT=3001; override with PORT=...)
```

First boot applies `server/schema.sql` and seeds 7 pens + 3 categories.
Prices are integer cents; tax + shipping are computed server-side.

Env vars: `POSTGRES_URL` / `DATABASE_URL` (required), `PORT` (default 3001),
`ALERT_TO` (shipping alert recipient, default `orders@dimitris-pens.local`),
`PGSSL=true` (force TLS; auto-on for `*.neon.tech`).

## Deploy (Vercel + Postgres)

Target: Vercel free tier (serverless) + Postgres free tier via Vercel
Marketplace/Neon — survives without any of Kevin's own machines.

- `api/index.js` exports the Express app for Vercel's Node runtime.
- `vercel.json` rewrites **everything** to `/api` (one function serves the
  static frontend from `server/public` plus all `/api/*` routes). This keeps
  local (`node server/index.js`) and serverless behavior identical. Tradeoff:
  static assets also run through the function; split later if it matters.
- `server/index.js` only calls `app.listen` when run directly
  (`require.main === module`) — never in the serverless path.
- Connect the Vercel Postgres/Neon integration and set `POSTGRES_URL`
  (Vercel injects it automatically for the linked project). Seed runs on
  first boot against the empty database.

GitHub Pages **cannot** host this app (it's full-stack now) and the Mac mini
is not a target — Vercel is the only deployment path.

## API

| Method | Path | Notes |
|---|---|---|
| GET | /api/health | liveness |
| GET/POST | /api/products | POST: `{name, price_cents, category_id?, description?, inventory?, image_key?, image_data_url?}` |
| PUT | /api/products/reorder | `{order:[ids]}` sets sort_order |
| PUT/DELETE | /api/products/:id | partial update / delete |
| GET/POST | /api/categories | POST `{name}` (409 on duplicate) |
| PUT/DELETE | /api/categories/:id | |
| GET | /api/alerts | shipping-alert outbox (admin) |
| POST | /api/payments/mock | `{amount_cents, card:{number,…}}` — 1–2s delay, `0002` declines (402) |
| POST | /api/orders | `{items, address, ship_method?, payment_id?}` — atomic inventory decrement (409 on short stock), server-side tax/shipping, queues shipping alert |
| GET | /api/orders, /api/orders/:id | |

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
- **Admin mode**: discreet `Admin` link in the footer (or `?admin=1`).

## Smoke test

```bash
# needs a Postgres you don't mind being wiped (uses dimitris_test db)
POSTGRES_URL=postgres://postgres:penstest@localhost:5432/postgres node smoke/test.js
```

Covers the API (CRUD, reorder, duplicate-category 409, mock pay
success/decline, order totals math, inventory decrement, insufficient-stock
409 with no partial write, order lookup, outbox) plus a Playwright browser
flow (shop → cart → checkout → pay → confirmation → admin outbox → admin
CRUD/rearrange/categories). Re-run against production by setting
`SMOKE_BASE=https://<your-vercel-url>` — but the API phase still needs a
wipeable database, so point it at a scratch DB.
