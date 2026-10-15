/* Dimitris Pens — smoke test (API + browser).
 *
 * Requires: POSTGRES_URL (or DATABASE_URL) pointing at a Postgres the test
 * may wipe (it drops/creates a `dimitris_test` database), and a running
 * server spawned by this script itself.
 *
 *   POSTGRES_URL=postgres://postgres:penstest@localhost:5432/postgres node smoke/test.js
 *
 * Watch it in real Chrome:  SMOKE_CHANNEL=chrome SMOKE_HEADED=1 (npm run smoke:chrome)
 * The server gets throwaway secrets (test admin password + random PII key),
 * so no .env is needed.
 *
 * Fails loudly: any failed assertion throws and exits non-zero.
 */
"use strict";

const { spawn } = require("child_process");
const { chromium } = require("playwright");
const { Client } = require("pg");
const crypto = require("crypto");
const { hashPassword } = require("../server/password");
const { migrate } = require("../scripts/migrate");

const ADMIN_PASSWORD = "smoke-test-password-123";
// Fake Resend API: records every email; `failNext` makes the next one 500.
const RESEND_PORT = 3199;
const fakeResend = { emails: [], failNext: false, server: null };
function startFakeResend() {
  fakeResend.server = require("http").createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      const fail = fakeResend.failNext;
      fakeResend.failNext = false;
      fakeResend.emails.push({ headers: req.headers, body: JSON.parse(body || "{}"), failed: fail });
      res.writeHead(fail ? 500 : 200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(fail ? { message: "simulated outage" } : { id: "re_test_" + fakeResend.emails.length }));
    });
  }).listen(RESEND_PORT);
}

const SECRETS = {
  ADMIN_PASSWORD_HASH: hashPassword(ADMIN_PASSWORD),
  PII_ENC_KEY: crypto.randomBytes(32).toString("base64"),
  COOKIE_SECURE: "false",
  RESEND_API_KEY: "re_smoke_key",
  RESEND_API_URL: `http://localhost:${RESEND_PORT}/emails`
};

// Own port, so a dev server on :3001 doesn't get tested by mistake.
const PORT = process.env.SMOKE_PORT || "3101";
const BASE_URL = process.env.SMOKE_BASE || "http://localhost:" + PORT;

let stepNo = 0;
function step(name) { stepNo++; console.log(`\n[step ${stepNo}] ${name}`); }
function assert(cond, msg) {
  if (!cond) throw new Error("ASSERT FAILED: " + msg);
  console.log("  ok — " + msg);
}
// Tiny cookie jar: holds the admin session cookie once logged in.
let adminCookie = null;
let lastSetCookie = "";
async function api(method, path, body, expectStatus, opts = {}) {
  const headers = { "Content-Type": "application/json" };
  if (adminCookie && !opts.anon) headers.Cookie = adminCookie;
  Object.assign(headers, opts.headers || {});
  const r = await fetch(BASE_URL + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const setCookie = r.headers.get("set-cookie");
  if (setCookie) lastSetCookie = setCookie;
  if (setCookie && !opts.anon) adminCookie = setCookie.split(";")[0];
  const data = await r.json().catch(() => ({}));
  if (expectStatus !== undefined && r.status !== expectStatus) {
    throw new Error(`ASSERT FAILED: ${method} ${path} -> ${r.status}, expected ${expectStatus} (${JSON.stringify(data)})`);
  }
  return { status: r.status, data };
}

function testDbUrl() {
  const u = new URL(process.env.POSTGRES_URL || process.env.DATABASE_URL);
  u.pathname = "/dimitris_test";
  return u.toString();
}

function dbUrl(name) {
  const u = new URL(process.env.POSTGRES_URL || process.env.DATABASE_URL);
  u.pathname = "/" + name;
  return u.toString();
}

async function resetDb(name) {
  const admin = new Client({ connectionString: process.env.POSTGRES_URL || process.env.DATABASE_URL });
  await admin.connect();
  // terminate stray connections so DROP works
  await admin.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid <> pg_backend_pid()`, [name]);
  await admin.query(`DROP DATABASE IF EXISTS ${name}`);
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
}
const resetTestDb = () => resetDb("dimitris_test");

/* ================= migration tests ================= */
async function migrationTests() {
  step("migrations: fresh database");
  const allMigrations = require("fs").readdirSync(require("path").join(__dirname, "..", "migrations"))
    .filter((f) => f.endsWith(".sql")).map((f) => f.replace(/\.sql$/, "")).sort();
  let done = await migrate("up", { databaseUrl: testDbUrl(), quiet: true });
  assert(done.map((m) => m.name).join(",") === allMigrations.join(","), `applied all ${allMigrations.length} migrations in order`);
  done = await migrate("up", { databaseUrl: testDbUrl(), quiet: true });
  assert(done.length === 0, "second run is a no-op");

  step("migrations: adopt a database built by the old boot-time schema");
  // Simulate production before this change: tables created by schema.sql on
  // boot, real data in them, no pgmigrations table.
  await resetDb("dimitris_legacy");
  const legacyUrl = dbUrl("dimitris_legacy");
  const sql = require("fs").readFileSync(require("path").join(__dirname, "..", "migrations", "001_baseline.sql"), "utf8");
  const legacy = new Client({ connectionString: legacyUrl });
  await legacy.connect();
  await legacy.query(sql.split("-- Down Migration")[0]);
  await legacy.query("INSERT INTO categories (id, name) VALUES ('live1', 'Live Category')");
  await legacy.query("INSERT INTO products (id, name, price_cents, category_id) VALUES ('live-p', 'Live Pen', 100, 'live1')");
  done = await migrate("up", { databaseUrl: legacyUrl, quiet: true });
  assert(done.length === allMigrations.length, "all migrations recorded on the existing database");
  const { rows } = await legacy.query("SELECT (SELECT COUNT(*)::int FROM categories) AS c, (SELECT COUNT(*)::int FROM products) AS p");
  assert(rows[0].c === 1 && rows[0].p === 1, "existing data kept, seed skipped (shop not empty)");
  await legacy.end();
  await resetDb("dimitris_legacy"); // leave nothing behind
}

let serverProc = null;
async function startServer() {
  const env = { ...process.env, ...SECRETS, POSTGRES_URL: testDbUrl(), PORT };
  delete env.DATABASE_URL;
  serverProc = spawn("node", ["server/index.js"], { env, stdio: ["ignore", "pipe", "pipe"] });
  serverProc.stdout.on("data", (d) => process.stdout.write("[srv] " + d));
  serverProc.stderr.on("data", (d) => process.stderr.write("[srv] " + d));
  const t0 = Date.now();
  while (Date.now() - t0 < 30000) {
    try {
      const r = await fetch(BASE_URL + "/api/health");
      if (r.ok) return;
    } catch (e) { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("ASSERT FAILED: server did not become healthy in 30s");
}
function stopServer() {
  if (serverProc) serverProc.kill();
  if (fakeResend.server) fakeResend.server.close();
}

/* ================= API tests ================= */
async function apiTests() {
  step("api: health + seed");
  let r = await api("GET", "/api/health", undefined, 200);
  assert(r.data.ok === true, "health ok");
  r = await api("GET", "/api/products", undefined, 200);
  assert(r.data.length === 7, `7 seeded products (got ${r.data.length})`);
  const p1 = r.data.find((p) => p.id === "p1");
  assert(p1.name === "The Meridian" && p1.price_cents === 18500, "p1 seed correct");
  r = await api("GET", "/api/categories", undefined, 200);
  assert(r.data.length === 3, "3 seeded categories");

  step("security: admin endpoints require login");
  const anon = { anon: true };
  await api("POST", "/api/products", { name: "x", price_cents: 1 }, 401, anon);
  await api("PUT", "/api/products/p1", { price_cents: 1 }, 401, anon);
  await api("DELETE", "/api/products/p1", undefined, 401, anon);
  await api("PUT", "/api/products/reorder", { order: [] }, 401, anon);
  await api("POST", "/api/categories", { name: "x" }, 401, anon);
  await api("DELETE", "/api/categories/c1", undefined, 401, anon);
  await api("PUT", "/api/settings", { shop_name: "pwned" }, 401, anon);
  await api("GET", "/api/orders", undefined, 401, anon);
  await api("GET", "/api/orders/anything", undefined, 401, anon);
  await api("GET", "/api/alerts", undefined, 401, anon);
  await api("GET", "/api/admin/settings", undefined, 401, anon);
  assert(true, "all admin routes -> 401 without a session");
  await api("POST", "/api/admin/login", { password: "wrong" }, 401, anon);
  assert(true, "wrong password -> 401");
  r = await api("GET", "/api/admin/session", undefined, 200);
  assert(r.data.admin === false, "no session yet");
  r = await fetch(BASE_URL + "/api/health");
  assert(/default-src 'self'/.test(r.headers.get("content-security-policy") || ""), "CSP header set");
  r = await api("POST", "/api/admin/login", { password: ADMIN_PASSWORD }, 200);
  assert(adminCookie.startsWith("dp_admin=") && /HttpOnly/i.test(lastSetCookie) && /SameSite=Strict/i.test(lastSetCookie),
    "logged in, HttpOnly SameSite=Strict session cookie set");
  r = await api("GET", "/api/admin/session", undefined, 200);
  assert(r.data.admin === true, "session recognized");
  await api("POST", "/api/categories", { name: "x" }, 403, { headers: { Origin: "https://evil.example" } });
  assert(true, "cross-origin admin write -> 403");

  step("security: image uploads are validated");
  await api("POST", "/api/products", { name: "x", price_cents: 1, image_data_url: '" onerror="alert(1)' }, 422);
  await api("POST", "/api/products", { name: "x", price_cents: 1, image_data_url: "data:image/svg+xml;base64,PHN2Zy8+" }, 422);
  await api("POST", "/api/products", { name: "x", price_cents: 1, image_key: "<script>" }, 422);
  assert(true, "attribute-injection, SVG and unknown icon rejected (422)");

  step("settings: public/private split, validation, update");
  r = await api("GET", "/api/settings", undefined, 200, anon);
  assert(r.data.values.shop_name === "Dimitris Pens", "default shop name");
  assert(!("alert_recipient" in r.data.values), "private alert_recipient not public");
  await api("PUT", "/api/settings", { color_accent: "red; background:url(x)" }, 422);
  await api("PUT", "/api/settings", { nope: 1 }, 422);
  assert(true, "bad color + unknown key rejected");
  r = await api("PUT", "/api/settings", { tagline: "Smoke tagline", ship_standard_cents: 795 }, 200);
  assert(r.data.values.tagline === "Smoke tagline", "tagline updated");
  r = await api("GET", "/api/admin/settings", undefined, 200);
  assert(r.data.values.alert_recipient && r.data.values.ship_standard_cents === 795, "admin sees private + updated values");
  await api("PUT", "/api/settings", { tagline: null, ship_standard_cents: null }, 200);
  r = await api("GET", "/api/settings", undefined, 200, anon);
  assert(r.data.values.ship_standard_cents === 695, "null resets to default");

  step("api: product CRUD");
  r = await api("POST", "/api/products", {
    name: "API Test Pen", price_cents: 9999, category_id: "c1",
    description: "created by smoke test", inventory: 3, image_key: "roller"
  }, 201);
  const pid = r.data.id;
  assert(r.data.name === "API Test Pen", "product created: " + pid);
  r = await api("PUT", "/api/products/" + pid, { price_cents: 10999 }, 200);
  assert(r.data.price_cents === 10999, "price updated to 10999");
  r = await api("PUT", "/api/products/" + pid, { price_cents: -5 }, 422);
  assert(true, "negative price rejected (422)");

  step("api: product reorder");
  r = await api("GET", "/api/products", undefined, 200);
  const ids = r.data.map((p) => p.id);
  const rev = ids.slice().reverse();
  await api("PUT", "/api/products/reorder", { order: rev }, 200);
  r = await api("GET", "/api/products", undefined, 200);
  assert(r.data[0].id === rev[0], "reorder applied");
  await api("PUT", "/api/products/reorder", { order: ids }, 200); // restore

  step("api: category CRUD + duplicate guard");
  r = await api("POST", "/api/categories", { name: "SmokeCat" }, 201);
  const cid = r.data.id;
  assert(true, "category created: " + cid);
  await api("POST", "/api/categories", { name: "SmokeCat" }, 409);
  assert(true, "duplicate category -> 409");
  await api("PUT", "/api/categories/" + cid, { name: "SmokeCat2" }, 200);
  r = await api("GET", "/api/categories", undefined, 200);
  assert(r.data.some((c) => c.name === "SmokeCat2"), "category renamed");
  await api("DELETE", "/api/categories/" + cid, undefined, 200);
  r = await api("GET", "/api/categories", undefined, 200);
  assert(!r.data.some((c) => c.name === "SmokeCat2"), "category deleted");

  step("api: mock payment success + decline");
  r = await api("POST", "/api/payments/mock",
    { amount_cents: 1000, card: { number: "4242424242424242" } }, 200);
  assert(r.data.ok && r.data.id.startsWith("pi_mock_"), "mock payment succeeded: " + r.data.id);
  r = await api("POST", "/api/payments/mock",
    { amount_cents: 1000, card: { number: "4000000000000002" } }, 402);
  assert(r.data.code === "card_declined", "0002 card declined");

  step("api: order creates, decrements inventory, server-side totals");
  // p1 x2 @18500 + p4 x1 @8500 = 45500 subtotal; WA tax 6.5% = 2958 (rounded);
  // subtotal >= $75 -> FREE standard shipping; total = 48458
  const orderItems = [{ product_id: "p1", qty: 2 }, { product_id: "p4", qty: 1 }];
  r = await api("POST", "/api/orders/quote", { items: orderItems, state: "WA", ship_method: "standard" }, 200);
  assert(r.data.total_cents === 48458, "quote total 48458");
  const buyer = { name: "Api Buyer", street: "1 Test Ln", city: "Olympia", state: "WA", zip: "98501" };
  const buyerEmail = "api.buyer@example.com";
  await api("POST", "/api/orders", { items: orderItems, address: buyer, email: "not-an-email", payment_id: "pi_mock_forged" }, 422);
  assert(true, "invalid customer email -> 422");
  await api("POST", "/api/orders", { items: orderItems, address: buyer, email: buyerEmail, payment_id: "pi_mock_forged" }, 402);
  assert(true, "forged payment id -> 402");
  r = await api("POST", "/api/payments/mock", { amount_cents: 100, card: { number: "4242424242424242" } }, 200);
  await api("POST", "/api/orders", { items: orderItems, address: buyer, email: buyerEmail, payment_id: r.data.id }, 409);
  assert(true, "underpaid order -> 409");
  r = await api("POST", "/api/payments/mock",
    { amount_cents: 48458, card: { number: "4242424242424242" } }, 200);
  const payId = r.data.id;
  r = await api("POST", "/api/orders", {
    items: orderItems, address: buyer, email: buyerEmail, ship_method: "standard", payment_id: payId
  }, 201);
  const order = r.data.order;
  assert(/^DP-[A-Z0-9]{8}$/.test(order.order_number), "order number: " + order.order_number);
  assert(order.subtotal_cents === 45500, "subtotal 45500");
  assert(order.tax_cents === 2958, "WA tax 2958 (server-computed)");
  assert(order.shipping_cents === 0, "free shipping over $75 (server-computed)");
  assert(order.total_cents === 48458, "total 48458");
  assert(order.payment_id === payId, "payment id recorded");
  r = await api("GET", "/api/products", undefined, 200);
  assert(r.data.find((p) => p.id === "p1").inventory === 2, "p1 inventory 4 -> 2");
  assert(r.data.find((p) => p.id === "p4").inventory === 8, "p4 inventory 9 -> 8");
  await api("POST", "/api/orders", { items: [{ product_id: "p6", qty: 1 }], address: buyer, email: buyerEmail, payment_id: payId }, 409);
  assert(true, "payment reuse -> 409");

  step("security: customer PII encrypted at rest");
  const db = new Client({ connectionString: testDbUrl() });
  await db.connect();
  const { rows: raw } = await db.query("SELECT * FROM orders WHERE id = $1", [order.id]);
  for (const c of ["customer_name", "street", "city", "zip"])
    assert(raw[0][c].startsWith("enc:v1:") && !raw[0][c].includes(buyer[c === "customer_name" ? "name" : c]), c + " stored encrypted");
  const { rows: rawAlert } = await db.query("SELECT body FROM shipping_alerts WHERE order_id = $1", [order.id]);
  assert(rawAlert.every((a) => a.body.startsWith("enc:v1:") && !a.body.includes("Api Buyer")), "email bodies stored encrypted");
  assert(raw[0].customer_email.startsWith("enc:v1:") && !raw[0].customer_email.includes("example.com"), "customer_email stored encrypted");
  const { rows: rawRcpt } = await db.query("SELECT recipient FROM shipping_alerts WHERE order_id = $1", [order.id]);
  assert(rawRcpt.every((a) => a.recipient.startsWith("enc:v1:")), "email recipients stored encrypted");
  const { rows: tokens } = await db.query("SELECT token_hash FROM admin_sessions");
  assert(tokens.every((t) => !adminCookie.includes(t.token_hash)), "session token stored hashed only");
  await db.end();

  step("api: insufficient stock -> 409, no partial decrement");
  r = await api("POST", "/api/orders", {
    items: [{ product_id: "p3", qty: 5 }], // p3 has 1
    address: { name: "X", street: "Y", city: "Z", state: "OR", zip: "97000" }, email: "x@example.com",
    ship_method: "standard", payment_id: "pi_mock_x"
  }, 409);
  assert(/insufficient stock/.test(r.data.error), "409 with stock message");
  r = await api("GET", "/api/products", undefined, 200);
  assert(r.data.find((p) => p.id === "p3").inventory === 1, "p3 inventory untouched");

  step("api: order lookup + shipping alert outbox");
  r = await api("GET", "/api/orders/" + order.order_number, undefined, 200);
  assert(r.data.items.length === 2, "order has 2 line items");
  assert(r.data.customer_name === "Api Buyer" && r.data.zip === "98501", "admin read decrypts PII");
  assert(r.data.customer_email === buyerEmail, "admin read decrypts customer email");
  r = await api("GET", "/api/alerts", undefined, 200);
  const shopAlert = r.data.find((a) => a.kind === "shipping_alert");
  const custMail = r.data.find((a) => a.kind === "order_confirmation");
  assert(r.data.length === 2 && shopAlert && custMail && r.data.every((a) => a.order_id === order.id),
    "2 emails queued for the order: shipping alert + customer confirmation");
  assert(/Shipping alert/.test(shopAlert.subject) && shopAlert.body.includes("Api Buyer") && shopAlert.body.includes(buyerEmail),
    "shipping alert decrypted for admin, includes customer email");
  assert(custMail.recipient === buyerEmail, "confirmation addressed to the customer (decrypted for admin)");

  step("email: shipping alert + confirmation sent through Resend");
  assert(fakeResend.emails.length === 2 && fakeResend.emails.every((m) => !m.failed), "2 emails sent for the order");
  const sentMail = fakeResend.emails.find((m) => m.headers["idempotency-key"] === "shipping-alert-" + shopAlert.id);
  const sentConf = fakeResend.emails.find((m) => m.headers["idempotency-key"] === "shipping-alert-" + custMail.id);
  assert(sentMail && sentConf, "each email sent with its own idempotency key");
  assert(sentMail.headers.authorization === "Bearer re_smoke_key", "API key sent as bearer token");
  assert(sentMail.body.subject.includes(order.order_number) && sentMail.body.to[0] === shopAlert.recipient,
    "alert: subject has order number, sent to the shop's alert recipient");
  assert(sentMail.body.text.includes("Api Buyer") && sentMail.body.text.includes("1 Test Ln"), "alert body has the ship-to address");
  assert(sentConf.body.to[0] === buyerEmail && sentConf.body.subject.includes("confirmed") &&
    sentConf.body.text.includes(order.order_number) && sentConf.body.text.includes("$484.58"),
    "confirmation sent to the customer with order number + total");
  assert(shopAlert.status === "sent" && shopAlert.provider_id && shopAlert.sent_at, "alert marked sent with provider id");

  step("email: provider outage doesn't block the order; retry from Outbox");
  fakeResend.failNext = true;
  const smallItems = [{ product_id: "p6", qty: 1 }];
  r = await api("POST", "/api/orders/quote", { items: smallItems, state: "WA" }, 200);
  const pay2 = (await api("POST", "/api/payments/mock", { amount_cents: r.data.total_cents, card: { number: "4242424242424242" } }, 200)).data.id;
  r = await api("POST", "/api/orders", { items: smallItems, address: buyer, email: buyerEmail, payment_id: pay2 }, 201);
  const order2 = r.data.order;
  assert(true, "order " + order2.order_number + " created during email outage");
  r = await api("GET", "/api/alerts", undefined, 200);
  const failedAlert = r.data.find((a) => a.order_id === order2.id && a.kind === "shipping_alert");
  assert(failedAlert.status === "failed" && /500/.test(failedAlert.last_error) && failedAlert.attempts === 1, "alert marked failed with error");
  await api("POST", "/api/alerts/" + failedAlert.id + "/send", {}, 401, { anon: true });
  r = await api("POST", "/api/alerts/" + failedAlert.id + "/send", {}, 200);
  assert(r.data.ok && r.data.status === "sent", "admin retry sends it");
  assert(fakeResend.emails.at(-1).headers["idempotency-key"] === "shipping-alert-" + failedAlert.id, "retry reuses the idempotency key");
  r = await api("GET", "/api/alerts", undefined, 200);
  assert(r.data.find((a) => a.id === failedAlert.id).attempts === 2, "attempts = 2");

  step("orders admin: list, filter, ship, deliver, cancel + restock");
  await api("GET", "/api/orders", undefined, 401, { anon: true });
  await api("PUT", "/api/orders/" + order.id + "/status", { status: "shipped" }, 401, { anon: true });
  r = await api("GET", "/api/orders?status=paid", undefined, 200);
  assert(r.data.length === 2 && r.data.every((o) => o.status === "paid"), "2 paid orders to ship");
  assert(r.data.find((o) => o.id === order.id).items.length === 2, "orders list includes line items");
  r = await api("GET", "/api/orders?q=" + order.order_number.slice(3, 7).toLowerCase(), undefined, 200);
  assert(r.data.some((o) => o.id === order.id), "search by partial order number");
  await api("GET", "/api/orders?status=bogus", undefined, 422);
  const mailsBefore = fakeResend.emails.length;
  r = await api("PUT", "/api/orders/" + order.id + "/status", { status: "shipped", tracking_number: "1Z999AA10123456784" }, 200);
  assert(r.data.order.status === "shipped" && r.data.order.tracking_number === "1Z999AA10123456784" && r.data.order.shipped_at,
    "marked shipped with tracking number");
  const shippedMail = fakeResend.emails[mailsBefore];
  assert(fakeResend.emails.length === mailsBefore + 1 && shippedMail.body.to[0] === buyerEmail &&
    shippedMail.body.text.includes("1Z999AA10123456784"), "shipped email sent to the customer with tracking");
  await api("PUT", "/api/orders/" + order.id + "/status", { status: "cancelled" }, 409);
  assert(true, "can't cancel a shipped order (409)");
  r = await api("PUT", "/api/orders/" + order.id + "/status", { status: "delivered" }, 200);
  assert(r.data.order.status === "delivered" && r.data.order.delivered_at, "marked delivered");
  const p6Before = (await api("GET", "/api/products", undefined, 200)).data.find((p) => p.id === "p6").inventory;
  r = await api("PUT", "/api/orders/" + order2.id + "/status", { status: "cancelled" }, 200);
  const p6After = (await api("GET", "/api/products", undefined, 200)).data.find((p) => p.id === "p6").inventory;
  assert(r.data.order.status === "cancelled" && p6After === p6Before + 1, "cancel puts items back in stock");

  step("api: delete test product");
  await api("DELETE", "/api/products/" + pid, undefined, 200);
  r = await api("GET", "/api/products", undefined, 200);
  assert(r.data.length === 7, "back to 7 products");
}

/* ================= browser tests ================= */
async function fillAddress(page) {
  await page.fill('#checkoutForm input[name="name"]', "Browser Buyer");
  await page.fill('#checkoutForm input[name="email"]', "browser.buyer@example.com");
  await page.fill('#checkoutForm input[name="street"]', "2 Test Ave");
  await page.fill('#checkoutForm input[name="city"]', "Olympia");
  await page.selectOption("#stateSelect", "WA");
  await page.fill('#checkoutForm input[name="zip"]', "98501");
}
async function fillCard(page, number) {
  await page.fill("#ccNum", number);
  await page.fill("#ccExp", "1230");
  await page.fill("#ccCvc", "123");
  await page.fill("#ccName", "Browser Buyer");
}

async function browserTests() {
  const browser = await chromium.launch({
    headless: !process.env.SMOKE_HEADED,
    channel: process.env.SMOKE_CHANNEL || undefined, // "chrome" = installed Google Chrome
    slowMo: process.env.SMOKE_HEADED ? 150 : 0
  });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  page.on("console", (m) => { // HTTP error statuses (401/402 declines, favicon 404) are expected; CSP + JS errors are not.
    if (m.type() === "error" && !/Failed to load resource/.test(m.text())) pageErrors.push(m.text()); });

  step("browser: shop renders from API");
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.locator(".card").first().waitFor({ timeout: 10000 });
  assert((await page.locator(".card").count()) === 7, "7 product cards");

  step("browser: cart + checkout + mock pay");
  await page.locator('[data-add="p2"]').click();
  await page.locator('[data-add="p6"]').click();
  assert((await page.locator("#cartCount").textContent()) === "2", "cart badge 2");
  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".card").first().waitFor();
  assert((await page.locator("#cartCount").textContent()) === "2", "cart survives a page reload");
  await page.locator("#cartBtn").click();
  await page.locator("#checkoutBtn").click();
  await page.locator("#checkoutOverlay").waitFor();
  await fillAddress(page);
  await page.locator("#toPaymentBtn").click();
  await page.locator("#payStep2:not([hidden])").waitFor();
  await fillCard(page, "4242424242424242");
  await page.locator("#payBtn").click();
  await page.locator(".order-no:not([hidden])").waitFor({ timeout: 20000 });
  const orderNo = (await page.locator(".order-no").textContent()).trim();
  assert(/^DP-[A-Z0-9]{8}$/.test(orderNo), "confirmation shows " + orderNo);
  await page.locator("#doneBtn").click();
  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".card").first().waitFor();
  assert((await page.locator("#cartCount").textContent()) === "0", "cart cleared after the order (also after reload)");
  const { data: prodAfter } = await api("GET", "/api/products", undefined, 200);
  assert(prodAfter.find((p) => p.id === "p2").inventory === 1, "p2 inventory 2 -> 1 (server-side)");

  step("browser: decline path keeps cart");
  await page.locator('[data-add="p5"]').click();
  await page.locator("#cartBtn").click();
  await page.locator("#checkoutBtn").click();
  await page.locator("#checkoutOverlay").waitFor();
  await fillAddress(page);
  await page.locator("#toPaymentBtn").click();
  await page.locator("#payStep2:not([hidden])").waitFor();
  await fillCard(page, "4000000000000002");
  await page.locator("#payBtn").click();
  await page.locator("#payError:not([hidden])").waitFor({ timeout: 20000 });
  assert(/declined/i.test(await page.locator("#payError").textContent()), "decline shown, order not created");

  step("browser: admin requires password");
  await page.goto(BASE_URL + "/?admin=1", { waitUntil: "networkidle" });
  await page.locator("#loginOverlay:not([hidden])").waitFor();
  assert(await page.locator("#adminBar").isHidden(), "no admin bar before login");
  await page.fill("#loginPassword", "not-the-password");
  await page.locator("#loginBtn").click();
  await page.locator("#loginError:not([hidden])").waitFor();
  assert(/wrong password/.test(await page.locator("#loginError").textContent()), "wrong password rejected");
  await page.fill("#loginPassword", ADMIN_PASSWORD);
  await page.locator("#loginBtn").click();
  await page.locator("#adminBar:not([hidden])").waitFor();
  assert(true, "logged in via UI");

  step("browser: admin outbox lists the alert");
  await page.locator("#outboxBtn").click();
  await page.locator("#outboxList li", { hasText: orderNo }).first().waitFor();
  assert((await page.locator("#outboxList li", { hasText: orderNo }).count()) === 2, "outbox: alert + confirmation for " + orderNo);
  await page.locator("#closeOutboxBtn").click();

  step("browser: admin orders page — ship an order");
  await page.locator("#ordersBtn").click();
  const orderRow = page.locator("#ordersList li", { hasText: orderNo });
  await orderRow.waitFor();
  assert((await orderRow.textContent()).includes("browser.buyer@example.com"), "order row shows customer + email");
  await page.selectOption("#ordersStatus", "paid");
  await orderRow.locator("[data-tracking]").fill("TRACK-BROWSER-1");
  await orderRow.locator('[data-setstatus="shipped"]').click();
  await page.selectOption("#ordersStatus", "shipped");
  await page.locator("#ordersList li", { hasText: orderNo }).locator('.order-status[data-status="shipped"]').waitFor();
  assert((await page.locator("#ordersList li", { hasText: orderNo }).textContent()).includes("TRACK-BROWSER-1"), "shipped with tracking via UI");
  await page.locator("#closeOrdersBtn").click();

  step("browser: admin add/edit/price/rearrange/delete pen");
  await page.locator("#addPenBtn").click();
  await page.fill('#editorForm input[name="name"]', "Browser Pen");
  await page.fill('#editorForm input[name="price"]', "77.77");
  await page.fill('#editorForm input[name="stock"]', "4");
  await page.locator('#editorForm button[type="submit"]').click();
  await page.locator('.card h3', { hasText: "Browser Pen" }).waitFor();
  const card = page.locator(".card", { hasText: "Browser Pen" });
  await card.locator("[data-pricein]").fill("88.88");
  await card.locator("[data-priceset]").click();
  await page.waitForTimeout(500);
  assert((await card.locator("[data-price]").textContent()).includes("88.88"), "inline price set");
  const titlesBefore = await page.locator(".card h3").allTextContents();
  await card.locator("[data-up]").click();
  await page.waitForTimeout(500);
  const titlesAfter = await page.locator(".card h3").allTextContents();
  assert(titlesAfter.indexOf("Browser Pen") === titlesBefore.indexOf("Browser Pen") - 1, "moved up");
  page.once("dialog", (d) => d.accept());
  await page.locator(".card", { hasText: "Browser Pen" }).locator("[data-del]").click();
  await page.waitForTimeout(500);
  assert((await page.locator('.card h3', { hasText: "Browser Pen" }).count()) === 0, "pen deleted");

  step("browser: admin category add/delete");
  await page.locator("#manageCatsBtn").click();
  await page.fill('#addCatForm input[name="newcat"]', "BrowserCat");
  await page.locator('#addCatForm button[type="submit"]').click();
  await page.waitForTimeout(500);
  assert((await page.getByRole("button", { name: "BrowserCat", exact: true }).count()) === 1, "category in nav");
  page.once("dialog", (d) => d.accept());
  await page.locator("#catList li", { hasText: "BrowserCat" }).first()
    .locator("button", { hasText: "delete" }).click();
  await page.waitForTimeout(500);
  assert((await page.getByRole("button", { name: "BrowserCat", exact: true }).count()) === 0, "category removed");
  await page.locator("#closeCatBtn").click();

  step("browser: site settings change page text + theme");
  await page.locator("#settingsBtn").click();
  await page.locator("#settingsOverlay:not([hidden])").waitFor();
  await page.fill('#settingsForm input[name="shop_name"]', "Smoke Pens Co.");
  await page.fill('#settingsForm input[name="announcement"]', "Holiday orders ship Dec 20");
  await page.fill('#settingsForm textarea[name="about_body"]', "First paragraph.\n\nSecond paragraph.");
  await page.locator('#settingsForm input[name="color_accent"]').fill("#1f4e79");
  await page.locator("#saveSettingsBtn").click();
  await page.locator("#settingsOverlay").waitFor({ state: "hidden" });
  assert((await page.locator("#shopName").textContent()) === "Smoke Pens Co.", "shop name updated");
  assert((await page.locator("#announcement").textContent()) === "Holiday orders ship Dec 20", "announcement shown");
  assert((await page.locator("#aboutBody p").count()) === 2, "about split into 2 paragraphs");
  const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim());
  assert(accent === "#1f4e79", "accent color applied");
  await page.reload({ waitUntil: "networkidle" });
  assert((await page.locator("#shopName").textContent()) === "Smoke Pens Co.", "persists across reload (server-side)");
  assert(await page.locator("#adminBar").isVisible(), "admin session survives reload");

  step("browser: logout");
  await page.locator("#exitAdminBtn").click();
  await page.locator("#adminBar").waitFor({ state: "hidden" });
  const { status } = await api("GET", "/api/alerts", undefined, undefined, { anon: true });
  assert(status === 401, "logged out; admin API closed");

  step("browser: admin toolbar on a phone");
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const pp = await phone.newPage();
  pp.on("pageerror", (e) => pageErrors.push(e.message));
  await pp.goto(BASE_URL + "/?admin=1", { waitUntil: "networkidle" });
  await pp.fill("#loginPassword", ADMIN_PASSWORD);
  await pp.locator("#loginBtn").click();
  await pp.locator("#adminBar:not([hidden])").waitFor();
  assert((await pp.locator("#adminBar").textContent()).includes("You're editing your shop"), "toolbar says you're editing the shop");
  assert(await pp.locator("#adminMenuToggle").isVisible() && await pp.locator("#ordersBtn").isHidden(), "phone: tools folded into one button");
  await pp.locator("#adminMenuToggle").click();
  assert(await pp.locator("#ordersBtn").isVisible(), "phone: Admin tools opens the menu");
  await pp.locator("#ordersBtn").click();
  await pp.locator("#ordersOverlay:not([hidden])").waitFor();
  assert(await pp.locator("#ordersBtn").isHidden(), "phone: picking a tool closes the menu");
  await pp.evaluate(() => window.scrollTo(0, 2000));
  const barTop = await pp.locator("#adminBar").evaluate((el) => el.getBoundingClientRect().top);
  assert(barTop === 0, "toolbar stays pinned to the top while scrolling");
  await phone.close();

  step("browser: no JS errors or CSP violations");
  assert(pageErrors.length === 0, "clean console" + (pageErrors.length ? ": " + pageErrors.join(" | ") : ""));

  await browser.close();
}

async function run() {
  if (!process.env.POSTGRES_URL && !process.env.DATABASE_URL) {
    throw new Error("Set POSTGRES_URL (a Postgres this test may wipe via dimitris_test db).");
  }
  step("reset test database");
  await resetTestDb();
  startFakeResend();
  await migrationTests();
  await startServer();
  try {
    await apiTests();
    await browserTests();
  } finally {
    stopServer();
  }
  console.log(`\nALL ${stepNo} STEPS PASSED`);
}

run().catch((e) => {
  stopServer();
  console.error("\nSMOKE TEST FAILED:", e.message);
  process.exit(1);
});
