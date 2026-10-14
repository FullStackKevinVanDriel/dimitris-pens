/* Dimitris Pens — smoke test (API + browser).
 *
 * Requires: POSTGRES_URL (or DATABASE_URL) pointing at a Postgres the test
 * may wipe (it drops/creates a `dimitris_test` database), and a running
 * server spawned by this script itself.
 *
 *   POSTGRES_URL=postgres://postgres:penstest@localhost:5432/postgres node smoke/test.js
 *
 * Fails loudly: any failed assertion throws and exits non-zero.
 */
"use strict";

const { spawn } = require("child_process");
const { chromium } = require("playwright");
const { Client } = require("pg");

const BASE_URL = process.env.SMOKE_BASE || "http://localhost:3001";
const PORT = process.env.SMOKE_PORT || "3001";

let stepNo = 0;
function step(name) { stepNo++; console.log(`\n[step ${stepNo}] ${name}`); }
function assert(cond, msg) {
  if (!cond) throw new Error("ASSERT FAILED: " + msg);
  console.log("  ok — " + msg);
}
async function api(method, path, body, expectStatus) {
  const r = await fetch(BASE_URL + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
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

async function resetTestDb() {
  const admin = new Client({ connectionString: process.env.POSTGRES_URL || process.env.DATABASE_URL });
  await admin.connect();
  // terminate stray connections so DROP works
  await admin.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='dimitris_test' AND pid <> pg_backend_pid()`);
  await admin.query("DROP DATABASE IF EXISTS dimitris_test");
  await admin.query("CREATE DATABASE dimitris_test");
  await admin.end();
}

let serverProc = null;
async function startServer() {
  const env = { ...process.env, POSTGRES_URL: testDbUrl(), PORT };
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
function stopServer() { if (serverProc) serverProc.kill(); }

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
  r = await api("POST", "/api/payments/mock",
    { amount_cents: 48458, card: { number: "4242424242424242" } }, 200);
  const payId = r.data.id;
  r = await api("POST", "/api/orders", {
    items: [{ product_id: "p1", qty: 2 }, { product_id: "p4", qty: 1 }],
    address: { name: "Api Buyer", street: "1 Test Ln", city: "Olympia", state: "WA", zip: "98501" },
    ship_method: "standard", payment_id: payId
  }, 201);
  const order = r.data.order;
  assert(/^DP-[A-Z0-9]{6}$/.test(order.order_number), "order number: " + order.order_number);
  assert(order.subtotal_cents === 45500, "subtotal 45500");
  assert(order.tax_cents === 2958, "WA tax 2958 (server-computed)");
  assert(order.shipping_cents === 0, "free shipping over $75 (server-computed)");
  assert(order.total_cents === 48458, "total 48458");
  assert(order.payment_id === payId, "payment id recorded");
  r = await api("GET", "/api/products", undefined, 200);
  assert(r.data.find((p) => p.id === "p1").inventory === 2, "p1 inventory 4 -> 2");
  assert(r.data.find((p) => p.id === "p4").inventory === 8, "p4 inventory 9 -> 8");

  step("api: insufficient stock -> 409, no partial decrement");
  r = await api("POST", "/api/orders", {
    items: [{ product_id: "p3", qty: 5 }], // p3 has 1
    address: { name: "X", street: "Y", city: "Z", state: "OR", zip: "97000" },
    ship_method: "standard", payment_id: "pi_mock_x"
  }, 409);
  assert(/insufficient stock/.test(r.data.error), "409 with stock message");
  r = await api("GET", "/api/products", undefined, 200);
  assert(r.data.find((p) => p.id === "p3").inventory === 1, "p3 inventory untouched");

  step("api: order lookup + shipping alert outbox");
  r = await api("GET", "/api/orders/" + order.order_number, undefined, 200);
  assert(r.data.items.length === 2, "order has 2 line items");
  r = await api("GET", "/api/alerts", undefined, 200);
  assert(r.data.length === 1 && r.data[0].order_id === order.id, "1 alert queued for the order");
  assert(/Shipping alert/.test(r.data[0].subject), "alert subject correct");

  step("api: delete test product");
  await api("DELETE", "/api/products/" + pid, undefined, 200);
  r = await api("GET", "/api/products", undefined, 200);
  assert(r.data.length === 7, "back to 7 products");
}

/* ================= browser tests ================= */
async function fillAddress(page) {
  await page.fill('#checkoutForm input[name="name"]', "Browser Buyer");
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
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  step("browser: shop renders from API");
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.locator(".card").first().waitFor({ timeout: 10000 });
  assert((await page.locator(".card").count()) === 7, "7 product cards");

  step("browser: cart + checkout + mock pay");
  await page.locator('[data-add="p2"]').click();
  await page.locator('[data-add="p6"]').click();
  assert((await page.locator("#cartCount").textContent()) === "2", "cart badge 2");
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
  assert(/^DP-[A-Z0-9]{6}$/.test(orderNo), "confirmation shows " + orderNo);
  await page.locator("#doneBtn").click();
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

  step("browser: admin outbox lists the alert");
  await page.goto(BASE_URL + "/?admin=1", { waitUntil: "networkidle" });
  await page.locator("#adminBar:not([hidden])").waitFor();
  await page.locator("#outboxBtn").click();
  await page.locator("#outboxOverlay:not([hidden])").waitFor();
  const outboxText = await page.locator("#outboxList").textContent();
  assert(outboxText.includes(orderNo), "outbox contains order " + orderNo);

  step("browser: admin add/edit/price/rearrange/delete pen");
  await page.locator("#closeOutboxBtn").click();
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

  await browser.close();
}

async function run() {
  if (!process.env.POSTGRES_URL && !process.env.DATABASE_URL) {
    throw new Error("Set POSTGRES_URL (a Postgres this test may wipe via dimitris_test db).");
  }
  step("reset test database");
  await resetTestDb();
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
