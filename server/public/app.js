/* Dimitris Pens — shop frontend (API-backed).
 *
 * No localStorage for shop data: products, categories, inventory, orders and
 * site settings all live server-side in Postgres. Admin mode requires a
 * server login (HttpOnly session cookie); the UI only shows admin controls,
 * every admin API call is authorized server-side. The cart (product ids +
 * quantities only, no personal data) is kept in localStorage so it survives
 * a reload; it's re-checked against live stock on load.
 */
"use strict";

/* ---------------- API client ---------------- */
async function api(method, path, body) {
  const r = await fetch("/api" + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401 && path !== "/admin/login" && admin) {
    admin = false;
    renderAll();
    openLogin();
  }
  if (!r.ok) {
    const err = new Error((data && data.error) || ("request failed: " + r.status));
    err.status = r.status;
    err.data = data;
    throw err;
  }
  return data;
}
const apiGet = (p) => api("GET", p);
const apiPost = (p, b) => api("POST", p, b);
const apiPut = (p, b) => api("PUT", p, b);
const apiDel = (p) => api("DELETE", p);

/* ---------------- SVG pen artwork (inline, no external images) ---------------- */
function penSVG(style, accent) {
  accent = accent || "#6b2222";
  var ink = "#1b1814", brass = "#a67c3d";
  var tip = "";
  if (style === "fountain") {
    tip = '<path d="M24 148 L36 148 L30 178 Z" fill="' + brass + '"/>' +
          '<line x1="30" y1="152" x2="30" y2="170" stroke="' + ink + '" stroke-width="1.4"/>' +
          '<circle cx="30" cy="156" r="1.6" fill="' + ink + '"/>';
  } else if (style === "rollerball") {
    tip = '<rect x="25" y="148" width="10" height="18" rx="3" fill="' + ink + '"/>' +
          '<circle cx="30" cy="170" r="3.4" fill="' + brass + '"/>';
  } else { // pencil
    tip = '<path d="M24 148 L36 148 L30 172 Z" fill="#d9b98a"/>' +
          '<path d="M28 162 L32 162 L30 172 Z" fill="' + ink + '"/>';
  }
  return '<svg viewBox="0 0 60 190" role="img" aria-label="pen illustration">' +
    '<rect x="21" y="8" width="18" height="112" rx="9" fill="' + ink + '"/>' +
    '<rect x="21" y="8" width="18" height="34" rx="9" fill="' + accent + '"/>' +
    '<rect x="21" y="52" width="18" height="5" fill="' + brass + '"/>' +
    '<rect x="24" y="120" width="12" height="28" rx="5" fill="#33302a"/>' +
    tip + '</svg>';
}

var ICONS = {
  classic:  { label: "Fountain · oxblood", style: "fountain",  accent: "#6b2222" },
  forest:   { label: "Fountain · forest",  style: "fountain",  accent: "#2d4a32" },
  midnight: { label: "Fountain · midnight", style: "fountain",  accent: "#232c3f" },
  roller:   { label: "Rollerball · black",  style: "rollerball", accent: "#1b1814" },
  brassrb:  { label: "Rollerball · brass",  style: "rollerball", accent: "#a67c3d" },
  pencil:   { label: "Pencil · cedar",      style: "pencil",     accent: "#8a5a2b" }
};

const SAFE_IMAGE = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/;
function artFor(p) {
  if (p.image_data_url && SAFE_IMAGE.test(p.image_data_url))
    return '<img src="' + esc(p.image_data_url) + '" alt="">';
  var ic = ICONS[p.image_key] || ICONS.classic;
  return penSVG(ic.style, ic.accent);
}

/* ---------------- state (in-memory) ---------------- */
let products = [];
let categories = [];
let cart = []; // [{id, qty}] — saved to localStorage on every render (see saveCart)
let admin = false; // set from GET /api/admin/session; server enforces it
let settings = {};  // public site settings (GET /api/settings)
let settingsMeta = { fields: [], fonts: {} };
let activeCat = null; // null = all categories

function prod(id) { return products.find((p) => p.id === id); }
function money(cents) { return "$" + (cents / 100).toFixed(2); }
function esc(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function txt(key) { return settings[key] == null ? "" : String(settings[key]); }

async function refresh() {
  const [ps, cs] = await Promise.all([apiGet("/products"), apiGet("/categories")]);
  products = ps;
  categories = cs;
  // drop cart lines for products that no longer exist
  cart = cart.filter((c) => prod(c.id));
}

/* ---------------- shop grid ---------------- */
function renderCats() {
  const nav = document.getElementById("categoryNav");
  const cats = [{ id: "", name: txt("all_label") || "All" }].concat(categories);
  nav.innerHTML = cats.map((c) =>
    '<button data-cat="' + esc(c.id) + '"' + ((c.id || null) === activeCat ? ' class="active"' : "") + ">" + esc(c.name) + "</button>"
  ).join("");
  nav.querySelectorAll("button").forEach((b) => {
    b.addEventListener("click", () => { activeCat = b.dataset.cat || null; renderCats(); renderGrid(); });
  });
}

function renderGrid() {
  const grid = document.getElementById("productGrid");
  const list = products.filter((p) => !activeCat || p.category_id === activeCat);
  document.getElementById("adminBar").hidden = !admin;
  if (!list.length) {
    grid.innerHTML = '<p class="cart-empty">' + esc(txt("empty_category_text")) + "</p>";
    return;
  }
  grid.innerHTML = "";
  list.forEach((p) => {
    const card = document.createElement("article");
    card.className = "card";
    const stockHtml = p.inventory <= 0
      ? '<span class="soldout">' + esc(txt("sold_out_label")) + "</span>"
      : '<span class="stock-note' + (p.inventory <= 2 ? " low" : "") + '">' +
        (p.inventory <= 2 ? "Only " + p.inventory + " left" : p.inventory + " in stock") + "</span>";
    const actionHtml = p.inventory <= 0
      ? '<span class="soldout">' + esc(txt("sold_out_label")) + "</span>"
      : '<button class="add-btn" data-add="' + esc(p.id) + '">' + esc(txt("add_to_cart_label")) + "</button>";
    card.innerHTML =
      '<div class="card-img">' + artFor(p) + "</div>" +
      '<div class="card-body">' +
        '<span class="card-cat">' + esc(p.category_name) + "</span>" +
        "<h3>" + esc(p.name) + "</h3>" +
        '<p class="card-desc">' + esc(p.description || "") + "</p>" +
        '<div class="card-row"><span class="price" data-price="' + esc(p.id) + '">' + money(p.price_cents) + "</span>" + stockHtml + "</div>" +
        '<div class="card-row">' + actionHtml + "</div>" +
      "</div>" +
      (admin ? adminControls(p) : "");
    grid.appendChild(card);
  });
  grid.querySelectorAll("[data-add]").forEach((b) => {
    b.addEventListener("click", () => addToCart(b.dataset.add, 1));
  });
  if (admin) wireAdminControls(grid);
}

function adminControls(p) {
  const id = esc(p.id);
  return '<div class="card-admin">' +
    '<button data-edit="' + id + '">Edit</button>' +
    '<button data-img="' + id + '">Picture</button>' +
    '<button data-up="' + id + '" title="Move up">&#8593;</button>' +
    '<button data-down="' + id + '" title="Move down">&#8595;</button>' +
    '<button class="danger" data-del="' + id + '">Delete</button>' +
    '<span class="price-edit">$<input data-pricein="' + id + '" value="' + (p.price_cents / 100).toFixed(2) + '">' +
    '<button data-priceset="' + id + '">Set</button></span>' +
  "</div>";
}

function wireAdminControls(grid) {
  grid.querySelectorAll("[data-edit]").forEach((b) =>
    b.addEventListener("click", () => openEditor(prod(b.dataset.edit))));
  grid.querySelectorAll("[data-del]").forEach((b) =>
    b.addEventListener("click", async () => {
      const p = prod(b.dataset.del);
      if (!confirm('Delete "' + p.name + '"?')) return;
      await apiDel("/products/" + p.id);
      cart = cart.filter((c) => c.id !== p.id);
      await refresh(); renderCats(); renderGrid(); renderCart();
    }));
  grid.querySelectorAll("[data-up],[data-down]").forEach((b) =>
    b.addEventListener("click", () => {
      const dir = b.hasAttribute("data-up") ? -1 : 1;
      moveProduct(b.dataset.up || b.dataset.down, dir);
    }));
  grid.querySelectorAll("[data-img]").forEach((b) =>
    b.addEventListener("click", () => quickImageChange(b.dataset.img)));
  grid.querySelectorAll("[data-priceset]").forEach((b) =>
    b.addEventListener("click", async () => {
      const id = b.dataset.priceset;
      const inp = grid.querySelector('[data-pricein="' + id + '"]');
      const v = Math.round(parseFloat(inp.value) * 100);
      if (!Number.isFinite(v) || v < 0) { alert("Enter a valid price."); return; }
      await apiPut("/products/" + id, { price_cents: v });
      await refresh(); renderGrid(); renderCart();
    }));
}

async function moveProduct(id, dir) {
  const ids = products.map((p) => p.id);
  const i = ids.indexOf(id), j = i + dir;
  if (i < 0 || j < 0 || j >= ids.length) return;
  const t = ids[i]; ids[i] = ids[j]; ids[j] = t;
  await apiPut("/products/reorder", { order: ids });
  await refresh(); renderGrid();
}

function quickImageChange(id) {
  const p = prod(id);
  const choice = prompt(
    'Change picture for "' + p.name + '":\n- type "upload" to pick a photo file\n- or type an icon key: ' + Object.keys(ICONS).join(", "),
    p.image_key || "classic");
  if (choice === null) return;
  const c = choice.trim();
  const apply = async (patch) => {
    await apiPut("/products/" + id, patch);
    await refresh(); renderGrid();
  };
  if (c === "upload") {
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = "image/*";
    inp.onchange = () => {
      const f = inp.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => apply({ image_data_url: r.result });
      r.readAsDataURL(f);
    };
    inp.click();
  } else if (ICONS[c]) {
    apply({ image_key: c });
  } else {
    alert("Unknown icon key.");
  }
}

/* ---------------- cart (in-memory) ---------------- */
function cartQty() { return cart.reduce((n, c) => n + c.qty, 0); }
function cartSubtotalCents() {
  return cart.reduce((n, c) => { const p = prod(c.id); return p ? n + p.price_cents * c.qty : n; }, 0);
}

function addToCart(id, qty) {
  const p = prod(id);
  if (!p || p.inventory <= 0) return;
  const line = cart.find((c) => c.id === id);
  const inCart = line ? line.qty : 0;
  if (inCart + qty > p.inventory) {
    alert('Only ' + p.inventory + ' of "' + p.name + '" in stock.');
    qty = p.inventory - inCart;
  }
  if (qty <= 0) return;
  if (line) line.qty += qty; else cart.push({ id, qty });
  renderCart(); renderGrid();
}

/* Cart persistence (#31). Wrapped in try/catch: storage can be blocked
 * (private mode, disabled cookies) and the shop must work without it. */
const CART_KEY = "dp_cart_v1";
function saveCart() {
  try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch (e) { /* storage unavailable */ }
}
function loadCart() {
  let saved = [];
  try { saved = JSON.parse(localStorage.getItem(CART_KEY) || "[]"); } catch (e) { saved = []; }
  if (!Array.isArray(saved)) saved = [];
  // Keep only products that still exist, capped at current stock.
  cart = saved.map((l) => {
    const p = prod(String(l && l.id));
    const qty = Math.min(parseInt(l && l.qty, 10) || 0, p ? p.inventory : 0);
    return p && qty > 0 ? { id: p.id, qty } : null;
  }).filter(Boolean);
}

function renderCart() {
  saveCart();
  document.getElementById("cartCount").textContent = cartQty();
  const box = document.getElementById("cartItems");
  const foot = document.getElementById("cartFoot");
  if (!cart.length) {
    box.innerHTML = '<p class="cart-empty">Your cart is empty.</p>';
    foot.innerHTML = "";
    return;
  }
  box.innerHTML = "";
  cart.forEach((c) => {
    const p = prod(c.id);
    if (!p) return;
    const div = document.createElement("div");
    div.className = "cart-line";
    div.innerHTML =
      '<div class="cart-thumb">' + artFor(p) + "</div>" +
      '<div class="cart-info"><h4>' + esc(p.name) + "</h4>" +
        '<span class="unit">' + money(p.price_cents) + " each</span>" +
        '<div class="qty-row">' +
          '<button data-dec="' + p.id + '" aria-label="Decrease">&minus;</button>' +
          '<span class="qty">' + c.qty + "</span>" +
          '<button data-inc="' + p.id + '" aria-label="Increase">+</button>' +
          '<button class="remove-link" data-rm="' + p.id + '">remove</button>' +
        "</div></div>" +
      '<div class="line-total">' + money(p.price_cents * c.qty) + "</div>";
    box.appendChild(div);
  });
  foot.innerHTML =
    '<div class="subtotal-row"><span>Subtotal</span><strong>' + money(cartSubtotalCents()) + "</strong></div>" +
    '<button class="primary-btn" id="checkoutBtn">Checkout</button>' +
    '<button class="ghost-btn" id="continueBtn">Continue shopping</button>';
  box.querySelectorAll("[data-inc]").forEach((b) =>
    b.addEventListener("click", () => addToCart(b.dataset.inc, 1)));
  box.querySelectorAll("[data-dec]").forEach((b) =>
    b.addEventListener("click", () => {
      const line = cart.find((c) => c.id === b.dataset.dec);
      if (line) { line.qty--; if (line.qty <= 0) cart = cart.filter((c) => c !== line); }
      renderCart(); renderGrid();
    }));
  box.querySelectorAll("[data-rm]").forEach((b) =>
    b.addEventListener("click", () => {
      cart = cart.filter((c) => c.id !== b.dataset.rm);
      renderCart(); renderGrid();
    }));
  document.getElementById("checkoutBtn").addEventListener("click", openCheckout);
  document.getElementById("continueBtn").addEventListener("click", closeCart);
}

function openCart() { renderCart(); document.getElementById("cartDrawer").hidden = false; document.getElementById("drawerOverlay").hidden = false; }
function closeCart() { document.getElementById("cartDrawer").hidden = true; document.getElementById("drawerOverlay").hidden = true; }

/* ---------------- checkout ---------------- */
const STATES = ["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC"];
// Totals always come from the server (POST /api/orders/quote), which prices
// from the admin-editable settings. The quoted total is what we charge; the
// server rejects an order whose payment doesn't match its own total.
let lastQuote = null;
function checkoutChoice() {
  return {
    state: document.getElementById("stateSelect").value,
    method: document.querySelector('input[name="ship"]:checked').value
  };
}
async function fetchQuote() {
  const c = checkoutChoice();
  const q = await apiPost("/orders/quote", {
    items: cart.map((l) => ({ product_id: l.id, qty: l.qty })),
    state: c.state, ship_method: c.method
  });
  lastQuote = { sub: q.subtotal_cents, tax: q.tax_cents, ship: q.shipping_cents, total: q.total_cents,
    rate: q.tax_rate, method: q.ship_method, state: c.state };
  return lastQuote;
}

function fillStates() {
  document.getElementById("stateSelect").innerHTML =
    '<option value="">—</option>' + STATES.map((s) =>
      '<option value="' + s + '"' + (s === "WA" ? " selected" : "") + ">" + s + "</option>").join("");
}

function renderShipLabels(sub) {
  const free = settings.free_ship_at_cents > 0 && sub >= settings.free_ship_at_cents;
  document.getElementById("stdShipName").textContent = txt("ship_standard_label");
  document.getElementById("expShipName").textContent = txt("ship_express_label");
  document.getElementById("stdShipLabel").textContent = free ? "FREE" : money(settings.ship_standard_cents || 0);
  document.getElementById("expShipLabel").textContent = money(settings.ship_express_cents || 0);
}
async function renderCheckoutTotals() {
  const box = document.getElementById("checkoutTotals");
  try {
    const t = await fetchQuote();
    renderShipLabels(t.sub);
    box.innerHTML = totalsHtml(t) + '<p class="tax-note">' + esc(txt("tax_note")) + "</p>";
  } catch (err) {
    box.innerHTML = '<p class="pay-error">' + esc(err.message) + "</p>";
  }
}
async function renderPayTotals() {
  const t = await fetchQuote();
  document.getElementById("payTotals").innerHTML = totalsHtml(t);
  document.getElementById("payBtn").textContent = "Pay " + money(t.total);
}
function totalsHtml(t) {
  return '<div class="trow"><span>Subtotal</span><span>' + money(t.sub) + "</span></div>" +
    '<div class="trow"><span>Sales tax (est. ' + (t.rate * 100).toFixed(2) + "%)</span><span>" + money(t.tax) + "</span></div>" +
    '<div class="trow"><span>Shipping (' + esc(t.method) + ")</span><span>" + (t.ship === 0 ? "FREE" : money(t.ship)) + "</span></div>" +
    '<div class="trow grand"><span>Total</span><span>' + money(t.total) + "</span></div>";
}

function openCheckout() {
  if (!cart.length) return;
  closeCart();
  document.getElementById("confirmation").hidden = true;
  document.getElementById("processing").hidden = true;
  document.getElementById("checkoutForm").hidden = false;
  document.getElementById("payStep1").hidden = false;
  document.getElementById("payStep2").hidden = true;
  document.getElementById("payError").hidden = true;
  document.getElementById("orderSummary").innerHTML =
    "<h3>Order summary</h3><table>" + cart.map((c) => {
      const p = prod(c.id);
      return "<tr><td>" + esc(p.name) + " × " + c.qty + "</td><td>" + money(p.price_cents * c.qty) + "</td></tr>";
    }).join("") + "</table>";
  renderCheckoutTotals();
  document.getElementById("checkoutOverlay").hidden = false;
}

async function gotoPaymentStep() {
  const inputs = document.getElementById("payStep1").querySelectorAll("input, select");
  for (const inp of inputs) if (!inp.checkValidity()) { inp.reportValidity(); return; }
  try {
    await renderPayTotals();
  } catch (err) {
    alert(err.message);
    return;
  }
  document.getElementById("payStep1").hidden = true;
  document.getElementById("payStep2").hidden = false;
  document.getElementById("payError").hidden = true;
}

function setFieldErrors(errors) {
  const map = { number: "errNum", exp: "errExp", cvc: "errCvc", name: "errName" };
  Object.keys(map).forEach((k) => { document.getElementById(map[k]).textContent = errors[k] || ""; });
}

async function submitPayment(ev) {
  ev.preventDefault();
  const card = {
    number: document.getElementById("ccNum").value,
    exp: document.getElementById("ccExp").value,
    cvc: document.getElementById("ccCvc").value,
    name: document.getElementById("ccName").value
  };
  const v = Payments.validateCard(card);
  setFieldErrors(v.errors);
  if (!v.valid) return;

  document.getElementById("checkoutForm").hidden = true;
  document.getElementById("processing").hidden = false;
  document.getElementById("payError").hidden = true;

  let t;
  try {
    t = await fetchQuote(); // re-quote right before charging
  } catch (err) {
    document.getElementById("processing").hidden = true;
    document.getElementById("checkoutForm").hidden = false;
    const pe = document.getElementById("payError");
    pe.textContent = err.message;
    pe.hidden = false;
    return;
  }
  let payment;
  try {
    // TODO(live): swap for Stripe PaymentIntent flow — see payments.js.
    payment = await Payments.processPayment({
      amount_cents: t.total, currency: "usd", cardDetails: card
    });
  } catch (err) {
    document.getElementById("processing").hidden = true;
    document.getElementById("checkoutForm").hidden = false;
    const pe = document.getElementById("payError");
    pe.textContent = (err && err.message) || "Payment failed. Please try again.";
    pe.hidden = false;
    return;
  }

  // Payment authorized — now create the order server-side. The server
  // recomputes tax/shipping, checks the payment matches, decrements
  // inventory atomically, and queues the shipping alert.
  const form = document.getElementById("checkoutForm");
  const email = form.email.value.trim();
  const address = {
    name: form.name.value.trim(), street: form.street.value.trim(),
    city: form.city.value.trim(), state: t.state, zip: form.zip.value.trim()
  };
  let order;
  try {
    const res = await apiPost("/orders", {
      items: cart.map((c) => ({ product_id: c.id, qty: c.qty })),
      address, email, ship_method: t.method, payment_id: payment.id
    });
    order = res.order;
  } catch (err) {
    document.getElementById("processing").hidden = true;
    document.getElementById("checkoutForm").hidden = false;
    const pe = document.getElementById("payError");
    pe.textContent = err.status === 409
      ? "Sorry — something in your cart just sold out. The shop has been refreshed."
      : "Order failed: " + err.message;
    pe.hidden = false;
    await refresh(); renderGrid(); renderCart();
    return;
  }

  cart = [];
  document.getElementById("processing").hidden = true;
  const conf = document.getElementById("confirmation");
  conf.hidden = false;
  conf.innerHTML =
    "<h3>" + esc(txt("confirm_heading")) + "</h3>" +
    '<p class="order-no">' + esc(order.order_number) + "</p>" +
    "<p>" + esc(txt("confirm_body")) + "</p>" +
    "<p><strong>" + money(order.total_cents) + "</strong> paid" +
    (Payments.isMock() ? " (test mode — no real charge)" : "") + " · " +
    esc(order.address.city) + ", " + esc(order.address.state) + "</p>" +
    '<button class="ghost-btn" id="doneBtn">Back to the shop</button>';
  document.getElementById("doneBtn").addEventListener("click", () => {
    document.getElementById("checkoutOverlay").hidden = true;
  });
  await refresh(); renderGrid(); renderCart();
}

/* ---------------- admin: product editor ---------------- */
function fillEditorSelects() {
  document.getElementById("editorCategory").innerHTML =
    '<option value="">Uncategorized</option>' + categories.map((c) =>
      '<option value="' + esc(c.id) + '">' + esc(c.name) + "</option>").join("");
  document.getElementById("editorIcon").innerHTML =
    Object.keys(ICONS).map((k) => '<option value="' + k + '">' + esc(ICONS[k].label) + "</option>").join("");
}

function openEditor(p) {
  fillEditorSelects();
  const f = document.getElementById("editorForm");
  f.reset();
  document.getElementById("editorTitle").textContent = p ? "Edit pen" : "Add pen";
  document.getElementById("imgPreview").innerHTML = p ? artFor(p) : "";
  if (p) {
    f.id.value = p.id;
    f.name.value = p.name;
    f.price.value = (p.price_cents / 100).toFixed(2);
    f.category.value = p.category_id || "";
    f.stock.value = p.inventory;
    f.desc.value = p.description || "";
    if (p.image_key) f.icon.value = p.image_key;
  } else {
    f.id.value = "";
  }
  document.getElementById("editorOverlay").hidden = false;
}

async function saveEditor(ev) {
  ev.preventDefault();
  const f = ev.target;
  const price_cents = Math.round(parseFloat(f.price.value) * 100);
  const inventory = Math.max(0, parseInt(f.stock.value, 10) || 0);
  if (!Number.isFinite(price_cents) || price_cents < 0) { alert("Enter a valid price."); return; }
  const data = {
    name: f.name.value.trim(),
    price_cents,
    category_id: f.category.value || null,
    inventory,
    description: f.desc.value.trim()
  };
  if (!data.name) { alert("Name is required."); return; }
  const file = document.getElementById("photoInput").files[0];
  const finish = async (withPhoto) => {
    try {
      if (withPhoto) {
        data.image_data_url = withPhoto;
      } else {
        data.image_key = f.icon.value;
        // keep existing photo unless explicitly replaced/cleared below
        if (f.id.value) {
          const cur = prod(f.id.value);
          if (cur && cur.image_data_url) data.image_data_url = cur.image_data_url;
        }
      }
      if (f.id.value) await apiPut("/products/" + f.id.value, data);
      else await apiPost("/products", data);
      document.getElementById("editorOverlay").hidden = true;
      await refresh(); renderCats(); renderGrid(); renderCart();
    } catch (err) { alert("Save failed: " + err.message); }
  };
  if (file) {
    const r = new FileReader();
    r.onload = () => finish(r.result);
    r.readAsDataURL(file);
  } else {
    finish(null);
  }
}

/* ---------------- admin: categories ---------------- */
function renderCatList() {
  const ul = document.getElementById("catList");
  ul.innerHTML = "";
  categories.forEach((c) => {
    const li = document.createElement("li");
    li.innerHTML = "<span>" + esc(c.name) + '<span class="count">' + c.product_count + " pen" + (c.product_count === 1 ? "" : "s") + "</span></span>" +
      '<span class="mini-btns"><button data-rename="' + esc(c.id) + '">rename</button><button data-delcat="' + esc(c.id) + '">delete</button></span>';
    ul.appendChild(li);
  });
  ul.querySelectorAll("[data-rename]").forEach((b) =>
    b.addEventListener("click", async () => {
      const c = categories.find((x) => x.id === b.dataset.rename);
      const v = (prompt("Rename category:", c.name) || "").trim();
      if (!v) return;
      try {
        await apiPut("/categories/" + c.id, { name: v });
        await refresh(); renderCatList(); renderCats(); renderGrid();
      } catch (err) { alert("Rename failed: " + err.message); }
    }));
  ul.querySelectorAll("[data-delcat]").forEach((b) =>
    b.addEventListener("click", async () => {
      const c = categories.find((x) => x.id === b.dataset.delcat);
      if (c.product_count > 0 &&
          !confirm('Delete "' + c.name + '"? Its ' + c.product_count + " pen(s) become Uncategorized.")) return;
      await apiDel("/categories/" + c.id);
      if (activeCat === c.id) activeCat = null;
      await refresh(); renderCatList(); renderCats(); renderGrid();
    }));
}

/* ---------------- admin: shipping outbox ---------------- */
const EMAIL_KINDS = { shipping_alert: "Shipping alert", order_confirmation: "Order confirmation", order_shipped: "Shipped notice" };

async function renderOutbox() {
  const ul = document.getElementById("outboxList");
  ul.innerHTML = "<li>Loading…</li>";
  try {
    const alerts = await apiGet("/alerts");
    if (!alerts.length) {
      ul.innerHTML = '<li><span class="tax-note">No shipping alerts yet.</span></li>';
      return;
    }
    ul.innerHTML = "";
    alerts.forEach((a) => {
      const li = document.createElement("li");
      const when = new Date(a.created_at).toLocaleString();
      li.innerHTML =
        "<span><strong>" + esc(a.order_number) + "</strong> · " + esc(EMAIL_KINDS[a.kind] || a.kind) + " → " + esc(a.recipient) +
        '<br><span class="tax-note">' + esc(a.subject) + " · " + esc(when) + " · " +
        '<span class="alert-status" data-status="' + esc(a.status) + '">' + esc(a.status) + "</span>" +
        (a.last_error ? " — " + esc(a.last_error) : "") + "</span>" +
        "<details><summary>body</summary><pre>" + esc(a.body) + "</pre></details></span>" +
        (a.status !== "sent" ? '<span class="mini-btns"><button data-sendalert="' + esc(a.id) + '">send now</button></span>' : "");
      ul.appendChild(li);
    });
    ul.querySelectorAll("[data-sendalert]").forEach((b) =>
      b.addEventListener("click", async () => {
        b.disabled = true;
        try {
          const r = await apiPost("/alerts/" + b.dataset.sendalert + "/send", {});
          if (!r.ok) alert("Not sent: " + (r.error || r.status));
        } catch (err) { alert("Not sent: " + err.message); }
        renderOutbox();
      }));
  } catch (err) {
    ul.innerHTML = "<li>Failed to load outbox: " + esc(err.message) + "</li>";
  }
}

/* ---------------- admin: orders (#29) ---------------- */
const NEXT_ACTIONS = {
  paid: [["shipped", "Mark shipped"], ["cancelled", "Cancel + restock"]],
  shipped: [["delivered", "Mark delivered"]],
  delivered: [], cancelled: []
};
let ordersSearchTimer = null;

async function renderOrders() {
  const ul = document.getElementById("ordersList");
  ul.innerHTML = "<li>Loading…</li>";
  const params = new URLSearchParams();
  const status = document.getElementById("ordersStatus").value;
  const q = document.getElementById("ordersSearch").value.trim();
  if (status) params.set("status", status);
  if (q) params.set("q", q);
  try {
    const orders = await apiGet("/orders" + (params.toString() ? "?" + params : ""));
    if (!orders.length) { ul.innerHTML = '<li><span class="tax-note">No orders.</span></li>'; return; }
    ul.innerHTML = "";
    orders.forEach((o) => {
      const li = document.createElement("li");
      li.dataset.order = o.order_number;
      const when = new Date(o.created_at).toLocaleString();
      const items = (o.items || []).map((it) => esc(it.qty + "× " + it.product_name)).join("<br>");
      const actions = NEXT_ACTIONS[o.status] || [];
      li.innerHTML =
        '<div class="order-head"><span><strong>' + esc(o.order_number) + "</strong> · " + esc(when) + " · " +
          money(o.total_cents) + "</span>" +
          '<span class="order-status" data-status="' + esc(o.status) + '">' + esc(o.status) + "</span></div>" +
        '<div class="order-detail">' +
          "<div>" + items + "</div>" +
          "<div>" + esc(o.customer_name) + "<br>" + esc(o.street) + "<br>" + esc(o.city) + ", " + esc(o.state) + " " + esc(o.zip) +
            "<br>" + esc(o.customer_email || "no email") + "<br>" + esc(o.ship_method) + " shipping" +
            (o.tracking_number ? "<br>Tracking: " + esc(o.tracking_number) : "") + "</div>" +
        "</div>" +
        (actions.length ? '<div class="order-actions">' +
          (o.status === "paid" ? '<input data-tracking placeholder="Tracking # (optional)" maxlength="100">' : "") +
          actions.map(([st, label]) => '<button data-setstatus="' + st + '">' + esc(label) + "</button>").join("") +
        "</div>" : "");
      li.querySelectorAll("[data-setstatus]").forEach((b) =>
        b.addEventListener("click", async () => {
          const st = b.dataset.setstatus;
          if (st === "cancelled" && !confirm("Cancel order " + o.order_number + " and put its items back in stock?")) return;
          const tr = li.querySelector("[data-tracking]");
          b.disabled = true;
          try {
            await apiPut("/orders/" + o.id + "/status", { status: st, tracking_number: tr ? tr.value.trim() : "" });
            if (st === "cancelled") { await refresh(); renderGrid(); }
          } catch (err) { alert("Update failed: " + err.message); }
          renderOrders();
        }));
      ul.appendChild(li);
    });
  } catch (err) {
    ul.innerHTML = "<li>Failed to load orders: " + esc(err.message) + "</li>";
  }
}

/* ---------------- site settings (content + theme) ---------------- */
const THEME_VARS = {
  color_paper: "--paper", color_paper_deep: "--paper-deep", color_ink: "--ink",
  color_ink_soft: "--ink-soft", color_rule: "--rule", color_accent: "--accent",
  color_accent_dark: "--accent-dark", color_brass: "--brass", color_sold: "--sold"
};

async function loadSettings() {
  const r = await apiGet("/settings");
  settings = r.values;
  settingsMeta = { fields: r.fields, fonts: r.fonts };
}

// All values are applied as text (textContent) or validated CSS values —
// never as HTML — so editable content can't inject markup.
function applySettings() {
  document.title = txt("page_title");
  document.getElementById("estLine").textContent = txt("est_line");
  document.getElementById("shopName").textContent = txt("shop_name");
  document.getElementById("tagline").textContent = txt("tagline");
  document.getElementById("aboutHeading").textContent = txt("about_heading");
  document.getElementById("footerAddress").textContent = txt("footer_address");
  document.getElementById("footerFineprint").textContent = txt("footer_fineprint");
  const ann = document.getElementById("announcement");
  ann.textContent = txt("announcement");
  ann.hidden = !txt("announcement");
  const about = document.getElementById("aboutBody");
  about.textContent = "";
  txt("about_body").split(/\n\s*\n/).filter((x) => x.trim()).forEach((para) => {
    const el = document.createElement("p");
    el.textContent = para.trim();
    about.appendChild(el);
  });
  const root = document.documentElement.style;
  Object.keys(THEME_VARS).forEach((k) => {
    if (/^#[0-9a-f]{6}$/i.test(settings[k] || "")) root.setProperty(THEME_VARS[k], settings[k]);
  });
  if (settingsMeta.fonts[settings.heading_font]) root.setProperty("--heading-font", settingsMeta.fonts[settings.heading_font]);
  if (settingsMeta.fonts[settings.body_font]) root.setProperty("--body-font", settingsMeta.fonts[settings.body_font]);
}

function ratesToText(obj) {
  return Object.keys(obj || {}).sort().map((k) => k + "=" + +(obj[k] * 100).toFixed(4)).join("\n");
}
function textToRates(t) {
  const out = {};
  t.split(/[\n,]+/).map((x) => x.trim()).filter(Boolean).forEach((pair) => {
    const m = /^([A-Za-z]{2})\s*[=:]\s*([0-9.]+)\s*%?$/.exec(pair);
    if (!m) throw new Error('Tax rates: "' + pair + '" should look like WA=6.5');
    out[m[1].toUpperCase()] = parseFloat(m[2]) / 100;
  });
  return out;
}

function fieldInput(f, v) {
  const name = 'name="' + esc(f.key) + '"';
  switch (f.type) {
    case "textarea":
      return '<textarea ' + name + ' rows="5" maxlength="' + f.max + '">' + esc(v) + "</textarea>";
    case "color":
      return '<input type="color" ' + name + ' value="' + esc(v) + '">';
    case "font":
      return "<select " + name + ">" + f.options.map((o) =>
        '<option value="' + esc(o) + '"' + (o === v ? " selected" : "") + ">" + esc(o) + "</option>").join("") + "</select>";
    case "percent":
      return '<input ' + name + ' inputmode="decimal" value="' + esc(+(v * 100).toFixed(4)) + '">';
    case "money":
      return '<input ' + name + ' inputmode="decimal" value="' + esc((v / 100).toFixed(2)) + '">';
    case "rates":
      return '<textarea ' + name + ' rows="4">' + esc(ratesToText(v)) + "</textarea>";
    case "email":
      return '<input type="email" ' + name + ' value="' + esc(v) + '">';
    default:
      return '<input ' + name + ' maxlength="' + (f.max || 200) + '" value="' + esc(v) + '">';
  }
}

async function openSettings() {
  const r = await apiGet("/admin/settings"); // includes private fields
  const groups = {};
  r.fields.forEach((f) => { (groups[f.group] = groups[f.group] || []).push(f); });
  document.getElementById("settingsFields").innerHTML = Object.keys(groups).map((g) =>
    '<fieldset class="settings-group"><legend>' + esc(g) + "</legend>" +
    groups[g].map((f) => '<label' + (f.type === "color" ? ' class="color-row"' : "") + ">" +
      esc(f.label) + " " + fieldInput(f, r.values[f.key]) + "</label>").join("") +
    "</fieldset>").join("");
  document.getElementById("settingsError").hidden = true;
  document.getElementById("settingsOverlay").hidden = false;
}

function readSettingsForm() {
  const form = document.getElementById("settingsForm");
  const out = {};
  settingsMeta.fields.forEach((f) => {
    const el = form.elements[f.key];
    if (!el) return;
    const v = el.value;
    if (f.type === "percent") out[f.key] = parseFloat(v) / 100;
    else if (f.type === "money") out[f.key] = Math.round(parseFloat(v) * 100);
    else if (f.type === "rates") out[f.key] = textToRates(v);
    else out[f.key] = v;
  });
  return out;
}

async function saveSettings(ev) {
  ev.preventDefault();
  const errBox = document.getElementById("settingsError");
  errBox.hidden = true;
  try {
    await apiPut("/settings", readSettingsForm());
    await loadSettings();
    applySettings(); renderAll();
    document.getElementById("settingsOverlay").hidden = true;
  } catch (err) {
    errBox.textContent = err.message;
    errBox.hidden = false;
  }
}

async function resetTheme() {
  const patch = {};
  Object.keys(THEME_VARS).concat(["heading_font", "body_font"]).forEach((k) => { patch[k] = null; });
  await apiPut("/settings", patch);
  document.documentElement.removeAttribute("style");
  await loadSettings();
  applySettings(); renderAll();
  await openSettings();
}

/* ---------------- admin login / logout ---------------- */
function renderAll() { renderCats(); renderGrid(); renderCart(); }

function openLogin() {
  document.getElementById("loginError").hidden = true;
  document.getElementById("loginForm").reset();
  document.getElementById("loginOverlay").hidden = false;
  document.getElementById("loginPassword").focus();
}

async function submitLogin(ev) {
  ev.preventDefault();
  const errBox = document.getElementById("loginError");
  try {
    await apiPost("/admin/login", { password: document.getElementById("loginPassword").value });
    admin = true;
    document.getElementById("loginOverlay").hidden = true;
    renderAll();
  } catch (err) {
    errBox.textContent = err.message;
    errBox.hidden = false;
  }
}

async function logout() {
  try { await apiPost("/admin/logout", {}); } catch (e) { /* cookie cleared either way */ }
  admin = false;
  renderAll();
}

/* ---------------- wire up ---------------- */
document.getElementById("cartBtn").addEventListener("click", openCart);
document.getElementById("closeCartBtn").addEventListener("click", closeCart);
document.getElementById("drawerOverlay").addEventListener("click", closeCart);
document.getElementById("closeCheckoutBtn").addEventListener("click", () => {
  document.getElementById("checkoutOverlay").hidden = true;
});
document.getElementById("checkoutForm").addEventListener("submit", submitPayment);
document.getElementById("toPaymentBtn").addEventListener("click", gotoPaymentStep);
document.getElementById("backToAddrBtn").addEventListener("click", () => {
  document.getElementById("payStep2").hidden = true;
  document.getElementById("payStep1").hidden = false;
});
document.getElementById("ccNum").addEventListener("input", function () { this.value = Payments.formatCardNumber(this.value); });
document.getElementById("ccExp").addEventListener("input", function () { this.value = Payments.formatExpiry(this.value); });
document.getElementById("ccCvc").addEventListener("input", function () { this.value = Payments.formatCVC(this.value); });
document.getElementById("adminLink").addEventListener("click", (e) => {
  e.preventDefault();
  if (admin) logout(); else openLogin();
});
document.getElementById("loginForm").addEventListener("submit", submitLogin);
document.getElementById("closeLoginBtn").addEventListener("click", () => {
  document.getElementById("loginOverlay").hidden = true;
});
document.getElementById("settingsBtn").addEventListener("click", () => {
  openSettings().catch((err) => alert("Couldn't load settings: " + err.message));
});
document.getElementById("closeSettingsBtn").addEventListener("click", () => {
  document.getElementById("settingsOverlay").hidden = true;
});
document.getElementById("settingsForm").addEventListener("submit", saveSettings);
document.getElementById("resetThemeBtn").addEventListener("click", () => {
  resetTheme().catch((err) => alert("Reset failed: " + err.message));
});
document.getElementById("stateSelect").addEventListener("change", renderCheckoutTotals);
document.querySelectorAll('input[name="ship"]').forEach((r) => r.addEventListener("change", renderCheckoutTotals));
document.getElementById("addPenBtn").addEventListener("click", () => openEditor(null));
document.getElementById("manageCatsBtn").addEventListener("click", () => {
  renderCatList();
  document.getElementById("catOverlay").hidden = false;
});
document.getElementById("ordersBtn").addEventListener("click", () => {
  renderOrders();
  document.getElementById("ordersOverlay").hidden = false;
});
document.getElementById("closeOrdersBtn").addEventListener("click", () => {
  document.getElementById("ordersOverlay").hidden = true;
});
document.getElementById("ordersStatus").addEventListener("change", renderOrders);
document.getElementById("ordersSearch").addEventListener("input", () => {
  clearTimeout(ordersSearchTimer);
  ordersSearchTimer = setTimeout(renderOrders, 250);
});
document.getElementById("outboxBtn").addEventListener("click", () => {
  renderOutbox();
  document.getElementById("outboxOverlay").hidden = false;
});
document.getElementById("closeOutboxBtn").addEventListener("click", () => {
  document.getElementById("outboxOverlay").hidden = true;
});
document.getElementById("exitAdminBtn").addEventListener("click", logout);
document.getElementById("closeEditorBtn").addEventListener("click", () => {
  document.getElementById("editorOverlay").hidden = true;
});
document.getElementById("editorForm").addEventListener("submit", saveEditor);
document.getElementById("photoInput").addEventListener("change", function () {
  const f = this.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => { document.getElementById("imgPreview").innerHTML = '<img src="' + r.result + '" alt="preview">'; };
  r.readAsDataURL(f);
});
document.getElementById("editorIcon").addEventListener("change", function () {
  const ic = ICONS[this.value];
  if (ic) document.getElementById("imgPreview").innerHTML = penSVG(ic.style, ic.accent);
});
document.getElementById("closeCatBtn").addEventListener("click", () => {
  document.getElementById("catOverlay").hidden = true;
});
document.getElementById("addCatForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const v = e.target.newcat.value.trim();
  if (!v) return;
  try {
    await apiPost("/categories", { name: v });
    e.target.reset();
    await refresh(); renderCatList(); renderCats();
  } catch (err) { alert("Add failed: " + err.message); }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeCart();
    ["checkoutOverlay", "editorOverlay", "catOverlay", "outboxOverlay", "loginOverlay", "settingsOverlay", "ordersOverlay"].forEach((id) => {
      document.getElementById(id).hidden = true;
    });
  }
});

/* ---------------- init ---------------- */
(async function init() {
  fillStates();
  try {
    const [, sess] = await Promise.all([loadSettings(), apiGet("/admin/session"), refresh()]);
    admin = !!sess.admin;
    loadCart();
  } catch (err) {
    document.getElementById("productGrid").innerHTML =
      '<p class="cart-empty">The shop server is unreachable. Start it with <code>npm start</code>.</p>';
    return;
  }
  applySettings();
  renderAll();
  if (new URLSearchParams(location.search).get("admin") === "1") {
    history.replaceState(null, "", location.pathname);
    if (!admin) openLogin();
  }
})();
