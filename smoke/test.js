/* Dimitris Pens — Playwright smoke test.
 *
 * Usage:
 *   # serve the site first (repo root):  python3 -m http.server 8000
 *   node smoke/test.js           # full local flow vs http://localhost:8000
 *   node smoke/test.js --live    # lighter pass vs the GitHub Pages URL
 *
 * Fails loudly: any failed assertion throws and exits non-zero.
 */
"use strict";

const { chromium } = require("playwright");

const LIVE = process.argv.includes("--live");
const BASE = LIVE
  ? "https://fullstackkevinvandriel.github.io/dimitris-pens/"
  : "http://localhost:8000";
const MAILPIT = "http://localhost:8025/api/v1";

let stepNo = 0;
function step(name) {
  stepNo++;
  console.log(`\n[step ${stepNo}] ${name}`);
}
function assert(cond, msg) {
  if (!cond) throw new Error("ASSERT FAILED: " + msg);
  console.log("  ok — " + msg);
}
async function mailCount() {
  // Node-side fetch: no CORS restrictions, unlike in-page fetch.
  const r = await fetch(MAILPIT + "/messages");
  const d = await r.json();
  return d.total;
}
async function waitMailCount(expected, timeoutMs = 12000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if ((await mailCount()) >= expected) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`ASSERT FAILED: mailpit count did not reach ${expected}`);
}

async function fillAddress(page) {
  await page.fill('#checkoutForm input[name="name"]', "Smoke Tester");
  await page.fill('#checkoutForm input[name="street"]', "1 Test Lane");
  await page.fill('#checkoutForm input[name="city"]', "Olympia");
  await page.selectOption("#stateSelect", "WA");
  await page.fill('#checkoutForm input[name="zip"]', "98501");
}

async function fillCard(page, number) {
  await page.fill("#ccNum", number);
  await page.fill("#ccExp", "1230");
  await page.fill("#ccCvc", "123");
  await page.fill("#ccName", "Smoke Tester");
}

async function stockOf(page, id) {
  return page.evaluate(
    (pid) =>
      JSON.parse(localStorage.getItem("dp_state_v1")).products.find(
        (p) => p.id === pid
      ).stock,
    id
  );
}

async function cardTitles(page) {
  return page.locator(".card h3").allTextContents();
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // start clean: fresh state + empty mailpit
  step("reset state");
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.evaluate(() => {
    localStorage.removeItem("dp_state_v1");
    localStorage.removeItem("dp_alert_queue");
  });
  if (!LIVE) {
    await fetch(MAILPIT + "/messages", { method: "DELETE" });
  }
  await page.reload({ waitUntil: "networkidle" });

  step("shop renders");
  await page.locator(".card").first().waitFor({ timeout: 10000 });
  const cards = await page.locator(".card").count();
  assert(cards === 7, `7 product cards rendered (got ${cards})`);
  const title = await page.title();
  assert(title.includes("Dimitris Pens"), "page title correct");

  step("category filter works");
  await page.getByRole("button", { name: "Pencils", exact: true }).click();
  assert((await page.locator(".card").count()) === 2, "Pencils filter shows 2 cards");
  await page.getByRole("button", { name: "All", exact: true }).click();
  assert((await page.locator(".card").count()) === 7, "All filter restores 7 cards");

  step("add two different pens to cart");
  await page.locator('[data-add="p1"]').click();
  await page.locator('[data-add="p4"]').click();
  assert((await page.locator("#cartCount").textContent()) === "2", "cart badge = 2");

  step("cart drawer: quantity stepper");
  await page.locator("#cartBtn").click();
  await page.locator(".drawer").waitFor();
  assert((await page.locator(".cart-line").count()) === 2, "2 line items in cart");
  await page.locator('[data-inc="p1"]').click();
  assert((await page.locator("#cartCount").textContent()) === "3", "qty+1 -> badge = 3");

  step("checkout: address + totals");
  await page.locator("#checkoutBtn").click();
  await page.locator("#checkoutOverlay").waitFor();
  await fillAddress(page);
  await page.locator("#toPaymentBtn").click();
  await page.locator("#payStep2:not([hidden])").waitFor();
  const payLabel = await page.locator("#payBtn").textContent();
  assert(payLabel.includes("Pay $"), "pay button shows total (" + payLabel.trim() + ")");

  const mailsBefore = LIVE ? null : await mailCount();

  step("mock Stripe payment succeeds (4242…)");
  await fillCard(page, "4242424242424242");
  await page.locator("#payBtn").click();
  await page.locator(".order-no:not([hidden])").waitFor({ timeout: 15000 });
  const orderNo = await page.locator(".order-no").textContent();
  assert(/^DP-[A-Z0-9]{6}$/.test(orderNo.trim()), "order number issued: " + orderNo.trim());
  await page.locator("#doneBtn").click();

  step("inventory decremented (deplete as sold)");
  assert((await stockOf(page, "p1")) === 2, "p1 stock 4 -> 2 after buying 2");
  assert((await stockOf(page, "p4")) === 8, "p4 stock 9 -> 8 after buying 1");
  assert((await page.locator("#cartCount").textContent()) === "0", "cart cleared");

  if (!LIVE) {
    step("shipping alert email reached Mailpit");
    await waitMailCount(mailsBefore + 1);
    assert(true, "mailpit message count increased by 1");
  }

  step("mock Stripe decline path (…0002)");
  await page.locator('[data-add="p5"]').click();
  await page.locator("#cartBtn").click();
  await page.locator("#checkoutBtn").click();
  await page.locator("#checkoutOverlay").waitFor();
  await fillAddress(page);
  await page.locator("#toPaymentBtn").click();
  await page.locator("#payStep2:not([hidden])").waitFor();
  await fillCard(page, "4000000000000002");
  await page.locator("#payBtn").click();
  await page.locator('#payError:not([hidden])').waitFor({ timeout: 15000 });
  const errText = await page.locator("#payError").textContent();
  assert(/declined/i.test(errText), "decline error shown: " + errText.trim());
  assert((await stockOf(page, "p5")) === 6, "no inventory change on decline");

  step("retry with good card after decline");
  await page.fill("#ccNum", "4242424242424242");
  await page.locator("#payBtn").click();
  await page.locator(".order-no:not([hidden])").waitFor({ timeout: 15000 });
  await page.locator("#doneBtn").click();
  assert((await stockOf(page, "p5")) === 5, "p5 stock 6 -> 5 after successful retry");

  // ---- admin mode ----
  step("admin: add a pen");
  await page.goto(BASE + "?admin=1", { waitUntil: "networkidle" });
  await page.locator("#adminBar:not([hidden])").waitFor();
  await page.locator("#addPenBtn").click();
  await page.fill('#editorForm input[name="name"]', "Smoke Test Pen");
  await page.fill('#editorForm input[name="price"]', "99.99");
  await page.fill('#editorForm input[name="stock"]', "5");
  await page.fill('#editorForm textarea[name="desc"]', "A pen made of pure test.");
  await page.locator('#editorForm button[type="submit"]').click();
  await page.locator('.card h3', { hasText: "Smoke Test Pen" }).waitFor();
  assert(true, "new pen appears in grid");

  step("admin: inline price widget");
  const newCard = page.locator(".card", { hasText: "Smoke Test Pen" });
  await newCard.locator("[data-pricein]").fill("149.99");
  await newCard.locator("[data-priceset]").click();
  await page.waitForTimeout(300);
  const priceText = await newCard.locator("[data-price]").textContent();
  assert(priceText.includes("149.99"), "price updated inline to $149.99");

  step("admin: rearrange (move up)");
  const before = await cardTitles(page);
  const idxBefore = before.indexOf("Smoke Test Pen");
  await newCard.locator("[data-up]").click();
  await page.waitForTimeout(300);
  const after = await cardTitles(page);
  assert(
    after.indexOf("Smoke Test Pen") === idxBefore - 1,
    "pen moved up one slot"
  );

  step("admin: edit pen");
  await page.locator(".card", { hasText: "Smoke Test Pen" }).locator("[data-edit]").click();
  await page.fill('#editorForm input[name="name"]', "Smoke Test Pen V2");
  await page.locator('#editorForm button[type="submit"]').click();
  await page.locator('.card h3', { hasText: "Smoke Test Pen V2" }).waitFor();
  assert(true, "pen renamed via editor");

  step("admin: delete pen");
  page.once("dialog", (d) => d.accept());
  await page.locator(".card", { hasText: "Smoke Test Pen V2" }).locator("[data-del]").click();
  await page.waitForTimeout(500);
  assert(
    (await page.locator('.card h3', { hasText: "Smoke Test Pen V2" }).count()) === 0,
    "pen deleted from grid"
  );

  step("admin: add / rename / delete category");
  await page.locator("#manageCatsBtn").click();
  await page.fill('#addCatForm input[name="newcat"]', "TestCat");
  await page.locator('#addCatForm button[type="submit"]').click();
  await page.waitForTimeout(300);
  assert(
    (await page.getByRole("button", { name: "TestCat", exact: true }).count()) === 1,
    "new category in nav"
  );
  page.once("dialog", (d) => d.accept("TestCat2"));
  const catRow = page.locator("#catList li", { hasText: "TestCat" }).first();
  await catRow.locator("button", { hasText: "rename" }).click();
  await page.waitForTimeout(300);
  assert(
    (await page.getByRole("button", { name: "TestCat2", exact: true }).count()) === 1,
    "category renamed"
  );
  page.once("dialog", (d) => d.accept());
  await page.locator("#catList li").filter({ hasText: "TestCat2" }).first().locator("button", { hasText: "delete" }).click();
  await page.waitForTimeout(300);
  assert(
    (await page.getByRole("button", { name: "TestCat2", exact: true }).count()) === 0,
    "category deleted from nav"
  );
  await page.locator("#closeCatBtn").click();

  await browser.close();
  console.log(`\nALL ${stepNo} STEPS PASSED (${LIVE ? "live" : "local"})`);
}

run().catch((e) => {
  console.error("\nSMOKE TEST FAILED:", e.message);
  process.exit(1);
});
