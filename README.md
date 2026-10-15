# Dimitris Pens — custom pen shop

Full-stack shop: Express API + Postgres, with the static frontend served by
the same app. No localStorage for shop data — products, categories,
inventory, orders, and shipping alerts all live in Postgres.

## Run it

```bash
npm install
docker run -d --name dp-pg -e POSTGRES_PASSWORD=penstest -p 5432:5432 postgres:16
npm run setup      # writes .env: asks for an admin password, generates the PII key
npm run migrate    # create/upgrade the schema (seeds 7 pens + 3 categories into an empty shop)
npm start          # → http://localhost:3001  (admin: footer "Admin" link or /?admin=1)
```
(`npm run dev` = migrate + start.)
Prices are integer cents; tax + shipping are computed server-side.

Secrets and env vars are documented in `.env.example` and `server/config.js`.
The server refuses to start without `POSTGRES_URL`, `ADMIN_PASSWORD_HASH`
and `PII_ENC_KEY`. To change the admin password: `npm run hash-password`.

## Database migrations

Schema changes are versioned SQL files in `migrations/`
([node-pg-migrate](https://github.com/salsita/node-pg-migrate); history in
the `pgmigrations` table). The app never changes the schema at startup.

```bash
npm run migrate:create add-customer-email   # → migrations/<timestamp>_add-customer-email.sql
#   edit the "-- Up Migration" / "-- Down Migration" sections
npm run migrate                              # apply pending
npm run migrate:down                         # roll back the latest
npm run smoke                                # verify
```

On Vercel, the build step (`npm run vercel-build`) applies pending
migrations before a **Production** deploy goes live, and a failing migration
fails the deploy. Preview builds skip migrations unless `MIGRATE_ON_BUILD=true`,
because Preview shares the Production database for now (issue #15). Keep
migrations backward-compatible: the old deployment keeps serving while the
new one migrates (add a column → deploy code that uses it → drop the old one later).

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

**Branches.** Work flows through three branches:

```
feature branch -> development (localhost) -> test (preview) -> main (production)
```

- `development` is the default branch and what you run on localhost; it
  isn't deployed. Every feature or fix starts from a freshly pulled
  `development` on a `feature/<name>` or `fix/<name>` branch, is tested on
  localhost (`npm run dev`) and with the Playwright smoke test
  (`npm run smoke`), then goes up as a PR into `development`.
- CI on each PR into `development`: `pr-rules` (the branch is `feature/` or
  `fix/`, and the body closes an open issue with `Fixes #N`) and `smoke`. Both
  must pass to merge.
- Actions -> **Promote development to test** opens the development -> test PR.
  Merging it deploys the preview.
- Actions -> **Promote test to production** opens the test -> main PR.
  Merging it deploys production.
- `development`, `test` and `main` are protected: changes go in by PR, and the
  `smoke` check must pass.
- `Fixes #N` in a feature PR closes the issue when it merges into
  `development`.

**How code reaches Vercel: GitHub Actions only.** Vercel's own Git deploys
are off (`vercel.json` `git.deploymentEnabled: false`). After CI (the smoke
test) passes on a push:

| Branch | Workflow | Goes to |
| --- | --- | --- |
| `test` | Deploy preview (test) | Vercel Preview, at https://dimitris-pens-test.vercel.app |
| `main` | Deploy production | https://dimitris-pens.vercel.app |

Both can be run by hand (Actions -> the workflow -> Run workflow) to
redeploy. They need the repo secrets `VERCEL_TOKEN`, `VERCEL_ORG_ID` and
`VERCEL_PROJECT_ID`. Production builds run on Vercel with the project's env
vars, so migrations still apply before the new version goes live; Preview
shares the production database for now and skips migrations.

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

- **Cart** is saved in the browser (`localStorage`, product ids + quantities
  only) so it survives a reload; it's re-checked against live stock on load
  and cleared after an order.
- **Orders** (admin → Orders): newest first with items, totals and the
  decrypted ship-to address and email; filter by status, search by order
  number. Paid → shipped (optional tracking #, emails the customer) →
  delivered; cancelling an unshipped order puts its items back in stock.
- **Payments** are mocked server-side (`POST /api/payments/mock`). TODOs in
  `server/app.js` + `server/public/payments.js` mark the real-Stripe path:
  publishable key client-side, `POST /api/payments/intent` (secret key)
  returning `client_secret`, `stripe.confirmCardPayment()` on the client.
- **Feedback** (admin -> Feedback, `server/feedback.js`): an admin describes
  a fix or change; it's saved and opened as a GitHub issue on
  `FEEDBACK_REPO` (labels `admin-feedback`, severity, type) using
  `GITHUB_TOKEN`. The panel mirrors each issue's state (labels `in progress`
  / `blocked`, closed as completed = done, not planned = resolved, sub-issue
  counts) and says "All changes have been completed." when everything is
  finished.
- **Emails** (`server/email.js`, Resend): every order queues a shipping
  alert to the shop and a confirmation to the customer inside the order
  transaction; marking an order shipped queues a shipped notice. They're
  sent after commit when `RESEND_API_KEY` is set. Admin → Email outbox
  shows queued / sent / failed with a "send now" retry; an email outage
  never blocks an order. Recipients and bodies are encrypted at rest.
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

Covers migrations (fresh DB, re-run no-op, adopting a pre-migrations
database without data loss), the API (auth on every admin route, CSRF origin check, upload
validation, settings validation and public/private split, CRUD, reorder,
mock pay, forged/underpaid/reused payments, order math, inventory, PII
encrypted in the raw DB rows, hashed session tokens) plus the browser flow
(shop → cart → checkout → pay → decline → admin login → outbox → pen CRUD →
categories → site settings → logout), and fails on any JS or CSP error.
