# Dimitris Pens — custom pen shop

A tiny static e-commerce site (HTML/CSS/JS, no backend) served on GitHub Pages:
**https://fullstackkevinvandriel.github.io/dimitris-pens/**

All shop state (products, categories, cart, inventory, orders) lives in
`localStorage` under `dp_state_v1`. Admin mode is toggled via the discreet
`Admin` link in the footer (or `?admin=1`).

## Files

- `index.html` — single-page shop: masthead, category nav, product grid, cart
  drawer, checkout modal, admin editor/category modals.
- `styles.css` — letterpress stationer aesthetic (paper cream, ink, oxblood).
- `app.js` — shop logic: seed data, cart, checkout (tax + shipping), admin CRUD.
- `payments.js` — payment seam. **Mock** Stripe implementation: `processPayment()`
  simulates a 1–2s charge; cards ending `0002` decline (Stripe test pattern).
  TODO comments mark where `pk_test_…`, `stripe.confirmCardPayment()`, and a
  PaymentIntent backend go for real charges.
- `server/mailer.js` — tiny local backend (Node, no framework) exposing
  `POST /api/shipping-alert`; sends a plain-text shipping alert through Mailpit.
- `smoke/test.js` — Playwright smoke test (see below).

## Local development

```bash
# 1. Mailpit (SMTP :1025, web UI :8025)
docker run -d --name mailpit --restart unless-stopped \
  -p 1025:1025 -p 8025:8025 axllent/mailpit

# 2. Shipping-alert mailer
cd server && npm install && npm start
# listens on :3001 — view sent mail at http://localhost:8025

# 3. Serve the static site (repo root)
python3 -m http.server 8000
# open http://localhost:8000
```

On successful checkout the site POSTs the order to
`http://localhost:3001/api/shipping-alert`. If the mailer isn't running
(e.g. on GitHub Pages), the alert is queued in `localStorage`
(`dp_alert_queue`) and shown in admin mode with a retry button — checkout
never breaks.

Env knobs for the mailer: `PORT` (default 3001), `MP_HOST`/`MP_PORT`
(default localhost:1025), `ALERT_TO` (default `orders@dimitris-pens.local`),
`ALERT_FROM`.

## Smoke test

```bash
# from the repo root, with the site served on :8000
npx playwright install chromium   # first time only
node smoke/test.js                # full local flow
node smoke/test.js --live         # lighter pass vs GitHub Pages
```

Covers: shop renders → add 2 pens → cart qty change → checkout address →
mock Stripe pay (success + 0002-decline path) → confirmation → inventory
decremented → admin add/edit/delete pen, price widget, rearrange, category
add/rename/delete.

## Going live with Stripe (later)

1. Add your publishable key in `payments.js` and load Stripe.js.
2. Build a small backend endpoint that creates a PaymentIntent with your
   secret key and returns its `client_secret`.
3. Replace the mock body of `processPayment()` with
   `stripe.confirmCardPayment()` — the `{id, status}` / `{code, message}`
   contract stays the same, so checkout needs no other changes.
