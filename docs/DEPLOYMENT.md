# Deployment plan

## Recommendation: Vercel Pro + Neon Postgres

Keep the current architecture (one Express function on Vercel plus managed
Postgres), but move the project to a **Vercel Pro** team. The Hobby plan is
for non-commercial use only. Per Vercel's fair-use rules, taking payments or
advertising products for sale counts as commercial
(https://vercel.com/docs/limits/fair-use-guidelines). A live pen shop needs
Pro (about $20/month).

Why Vercel and not something else:

- It's already wired up: `api/index.js`, `vercel.json`, Git-push deploys,
  preview deploys per PR, and the test → main promotion workflow.
- Neon's free tier is enough for a small shop. It does automatic backups and
  point-in-time restore, and the Vercel integration injects `POSTGRES_URL`.
- No server to patch. Caddy and a VPS are only worth it if you want everything
  on infrastructure you already run (see the alternative below).

## Secrets

| Variable | Where it comes from | Notes |
|---|---|---|
| `POSTGRES_URL` | Neon integration (auto) | Use separate Neon branches/databases for Production and Preview |
| `ADMIN_PASSWORD_HASH` | `npm run hash-password` | Paste the hash, never the password. Use a different password for Preview |
| `PII_ENC_KEY` | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` | **Different key per environment.** Back up the Production key in a password manager |
| `PII_ENC_KEYS_PREVIOUS` | only during key rotation | old key(s), comma-separated |
| `ALERT_TO` | optional | initial alert email (also editable in admin) |
| `RESEND_API_KEY` | resend.com → API Keys (sending access) | optional; enables shipping-alert emails |
| `RESEND_FROM` | optional | e.g. `Dimitris Pens <orders@yourdomain.com>` once the domain is verified in Resend; default `onboarding@resend.dev` only delivers to your own Resend account email |

Set them in Vercel → Project → Settings → Environment Variables. Mark them
**Sensitive** so they can't be read back in the dashboard. Vercel encrypts
environment variables at rest, so it serves as the secrets manager. Locally,
`npm run setup` writes a git-ignored `.env` (mode 600). Alternatively,
`vercel env pull .env` copies the Development values down.

Rotating the PII key: put the current key in `PII_ENC_KEYS_PREVIOUS`, set a
new `PII_ENC_KEY`, and redeploy. Existing rows are re-encrypted on the next
cold start. Once logs show `encrypted PII in N … row(s)`, remove the old key.

Changing the admin password: `npm run hash-password`, update
`ADMIN_PASSWORD_HASH`, redeploy. To force everyone out, run
`DELETE FROM admin_sessions;`.

## Rollout steps

1. Upgrade the Vercel team to Pro, or transfer the project to a Pro team.
2. Create the Production and Preview secrets above.
3. Merge the v3 PR into `test`. The Preview deploy builds automatically.
   Smoke it there: log in at `/?admin=1`, place a test order, check the
   Outbox, and change a setting.
4. Run the "Promote test to production" action and merge the PR it opens
   into `main`.
5. After the first production boot, check the logs for
   `encrypted PII in … orders row(s)` (existing orders encrypted) and confirm
   `GET /api/orders` returns 401 when logged out.
6. Clean-up: add branch protection on `main`
   (require PR + checks), and consider making the repo private.
7. Optional: add a custom domain in Vercel (TLS is automatic).

## Schema migrations

Production builds run `npm run migrate` (see `scripts/vercel-build.js`)
before the deployment goes live. Preview builds skip it until Preview has
its own database: create a Neon branch for Preview, point Preview's
`POSTGRES_URL` at it, then set `MIGRATE_ON_BUILD=true` for Preview.

## Before taking real money

- Replace the mock payment with Stripe (TODOs in `server/app.js` and
  `server/public/payments.js`). Use Stripe Elements and a webhook to mark
  `payments.status = 'succeeded'`. Add `https://js.stripe.com` to the CSP
  `script-src`/`frame-src` in `server/app.js`.
- CI (`.github/workflows/ci.yml`) runs migrations + the smoke test on every
  PR. Make it a required check on `main` once it has run.

## Alternative: self-host (VPS + Docker + Caddy)

If you'd rather not pay for Vercel Pro, or want it next to your other
services: run `node server/index.js` in a container behind Caddy (automatic
TLS), with Postgres on the same box or on Neon. Set `NODE_ENV=production`
(secure cookies) and leave `TRUST_PROXY` at its default (`loopback`) so rate
limiting sees real client IPs through Caddy. Keep secrets in a root-only
`.env` or in systemd credentials. The tradeoff is that OS patching, backups,
and uptime become your job.
