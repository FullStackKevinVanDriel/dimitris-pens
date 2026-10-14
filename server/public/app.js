/* Dimitris Pens — shop frontend (API-backed).
 *
 * No localStorage for shop data: products, categories, inventory and orders
 * all live server-side in SQLite. The cart is intentionally in-memory only —
 * it does not survive a reload (documented tradeoff; a cookie-keyed
 * server cart would be the next step if that matters).
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

function artFor(p) {
  if (p.image_data_url) return '<img src="' + p.image_data_url + '" alt="">';
  var ic = ICONS[p.image_key] || ICONS.classic;
  return penSVG(ic.style, ic.accent);
}

/* ---------------- state (in-memory) ---------------- */
let products = [];
let categories = [];
let cart = []; // [{id, qty}] — not persisted (see header note)
let admin = localStorage.getItem("dp_admin") === "1" ||
            new URLSearchParams(location.search).get("admin") === "1";
let activeCat = "All";

function prod(id) { return products.find((p) => p.id === id); }
function money(cents) { return "$" + (cents / 100).toFixed(2); }
function esc(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

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
  const cats = ["All"].concat(categories.map((c) => c.name));
  nav.innerHTML = cats.map((c) =>
    '<button data-cat="' + esc(c) + '"' + (c === activeCat ? ' class="active"' : "") + ">" + esc(c) + "</button>"
  ).join("");
  nav.querySelectorAll("button").forEach((b) => {
    b.addEventListener("click", () => { activeCat = b.dataset.cat; renderCats(); renderGrid(); });
  });
}

function renderGrid() {
  const grid = document.getElementById("productGrid");
  const list = products.filter((p) => activeCat === "All" || p.category_name === activeCat);
  if (!list.length) {
    grid.innerHTML = '<p class="cart-empty">No pens in this category yet.</p>';
    return;
  }
  grid.innerHTML = "";
  list.forEach((p) => {
    const card = document.createElement("article");
    card.className = "card";
    const stockHtml = p.inventory <= 0
      ? '<span class="soldout">Sold out</span>'
      : '<span class="stock-note' + (p.inventory <= 2 ? " low" : "") + '">' +
        (p.inventory <= 2 ? "Only " + p.inventory + " left" : p.inventory + " in stock") + "</span>";
    const actionHtml = p.inventory <= 0
      ? '<span class="soldout">Sold out</span>'
      : '<button class="add-btn" data-add="' + p.id + '">Add to Cart</button>';
    card.innerHTML =
      '<div class="card-img">' + artFor(p) + "</div>" +
      '<div class="card-body">' +
        '<span class="card-cat">' + esc(p.category_name) + "</span>" +
        "<h3>" + esc(p.name) + "</h3>" +
        '<p class="card-desc">' + esc(p.description || "") + "</p>" +
        '<div class="card-row"><span class="price" data-price="' + p.id + '">' + money(p.price_cents) + "</span>" + stockHtml + "</div>" +
        '<div class="card-row">' + actionHtml + "</div>" +
      "</div>" +
      (admin ? adminControls(p) : "");
    grid.appendChild(card);
  });
  grid.querySelectorAll("[data-add]").forEach((b) => {
    b.addEventListener("click", () => addToCart(b.dataset.add, 1));
  });
  if (admin) wireAdminControls(grid);
  document.getElementById("adminBar").hidden = !admin;
}

function adminControls(p) {
  return '<div class="card-admin">' +
    '<button data-edit="' + p.id + '">Edit</button>' +
    '<button data-img="' + p.id + '">Picture</button>' +
    '<button data-up="' + p.id + '" title="Move up">&#8593;</button>' +
    '<button data-down="' + p.id + '" title="Move down">&#8595;</button>' +
    '<button class="danger" data-del="' + p.id + '">Delete</button>' +
    '<span class="price-edit">$<input data-pricein="' + p.id + '" value="' + (p.price_cents / 100).toFixed(2) + '">' +
    '<button data-priceset="' + p.id + '">Set</button></span>' +
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

function renderCart() {
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
const TAX = { WA: 0.065, CA: 0.0725, OR: 0, NY: 0.08, TX: 0.0625 };
const STATES = ["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC"];
const SHIP_STANDARD_C = 695, SHIP_EXPRESS_C = 1495, FREE_SHIP_AT_C = 7500;

function taxRate(st) { return TAX[st] !== undefined ? TAX[st] : 0.05; }
function shipCents(method, sub) {
  if (method === "express") return SHIP_EXPRESS_C;
  return sub >= FREE_SHIP_AT_C ? 0 : SHIP_STANDARD_C;
}
// Display-only estimate; the server recomputes authoritatively on POST /api/orders.
function estimateTotals() {
  const sub = cartSubtotalCents();
  const st = document.getElementById("stateSelect").value;
  const method = document.querySelector('input[name="ship"]:checked').value;
  const tax = Math.round(sub * taxRate(st));
  const ship = shipCents(method, sub);
  return { sub, tax, ship, total: sub + tax + ship, rate: taxRate(st), method, state: st };
}

function fillStates() {
  document.getElementById("stateSelect").innerHTML =
    '<option value="">—</option>' + STATES.map((s) =>
      '<option value="' + s + '"' + (s === "WA" ? " selected" : "") + ">" + s + "</option>").join("");
}

function renderCheckoutTotals() {
  const t = estimateTotals();
  document.getElementById("stdShipLabel").textContent = t.sub >= FREE_SHIP_AT_C ? "FREE" : "$6.95";
  document.getElementById("checkoutTotals").innerHTML =
    totalsHtml(t) + '<p class="tax-note">Tax is estimated from the shipping state and finalized at packing.</p>';
}
function renderPayTotals() {
  const t = estimateTotals();
  document.getElementById("payTotals").innerHTML = totalsHtml(t);
  document.getElementById("payBtn").textContent = "Pay " + money(t.total);
}
function totalsHtml(t) {
  return '<div class="trow"><span>Subtotal</span><span>' + money(t.sub) + "</span></div>" +
    '<div class="trow"><span>Sales tax (est. ' + (t.rate * 100).toFixed(2) + "%)</span><span>" + money(t.tax) + "</span></div>" +
    '<div class="trow"><span>Shipping (' + t.method + ")</span><span>" + (t.ship === 0 ? "FREE" : money(t.ship)) + "</span></div>" +
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

function gotoPaymentStep() {
  const inputs = document.getElementById("payStep1").querySelectorAll("input, select");
  for (const inp of inputs) if (!inp.checkValidity()) { inp.reportValidity(); return; }
  document.getElementById("payStep1").hidden = true;
  document.getElementById("payStep2").hidden = false;
  document.getElementById("payError").hidden = true;
  renderPayTotals();
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

  const t = estimateTotals();
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
  // recomputes tax/shipping, decrements inventory atomically, and sends
  // the Mailpit shipping alert.
  const form = document.getElementById("checkoutForm");
  const address = {
    name: form.name.value.trim(), street: form.street.value.trim(),
    city: form.city.value.trim(), state: t.state, zip: form.zip.value.trim()
  };
  let order;
  try {
    const res = await apiPost("/orders", {
      items: cart.map((c) => ({ product_id: c.id, qty: c.qty })),
      address, ship_method: t.method, payment_id: payment.id
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
    "<h3>Thank you.</h3>" +
    '<p class="order-no">' + esc(order.order_number) + "</p>" +
    "<p>Your pens are being wrapped. A confirmation is on its way to the bench.</p>" +
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
      '<option value="' + c.id + '">' + esc(c.name) + "</option>").join("");
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
      '<span class="mini-btns"><button data-rename="' + c.id + '">rename</button><button data-delcat="' + c.id + '">delete</button></span>';
    ul.appendChild(li);
  });
  ul.querySelectorAll("[data-rename]").forEach((b) =>
    b.addEventListener("click", async () => {
      const c = categories.find((x) => x.id === b.dataset.rename);
      const v = (prompt("Rename category:", c.name) || "").trim();
      if (!v) return;
      try {
        await apiPut("/categories/" + c.id, { name: v });
        if (activeCat === c.name) activeCat = v;
        await refresh(); renderCatList(); renderCats(); renderGrid();
      } catch (err) { alert("Rename failed: " + err.message); }
    }));
  ul.querySelectorAll("[data-delcat]").forEach((b) =>
    b.addEventListener("click", async () => {
      const c = categories.find((x) => x.id === b.dataset.delcat);
      if (c.product_count > 0 &&
          !confirm('Delete "' + c.name + '"? Its ' + c.product_count + " pen(s) become Uncategorized.")) return;
      await apiDel("/categories/" + c.id);
      if (activeCat === c.name) activeCat = "All";
      await refresh(); renderCatList(); renderCats(); renderGrid();
    }));
}

/* ---------------- admin: shipping outbox ---------------- */
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
        "<span><strong>" + esc(a.order_number) + "</strong> · " + esc(a.recipient) +
        '<br><span class="tax-note">' + esc(a.subject) + " · " + esc(when) + " · " + esc(a.status) + "</span>" +
        "<details><summary>body</summary><pre>" + esc(a.body) + "</pre></details></span>";
      ul.appendChild(li);
    });
  } catch (err) {
    ul.innerHTML = "<li>Failed to load outbox: " + esc(err.message) + "</li>";
  }
}

/* ---------------- admin toggle ---------------- */
function setAdmin(on) {
  admin = on;
  try { localStorage.setItem("dp_admin", on ? "1" : "0"); } catch (e) {}
  if (on && new URLSearchParams(location.search).get("admin") === "1") {
    history.replaceState(null, "", location.pathname);
  }
  renderCats(); renderGrid();
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
document.getElementById("adminLink").addEventListener("click", (e) => { e.preventDefault(); setAdmin(!admin); });
document.getElementById("addPenBtn").addEventListener("click", () => openEditor(null));
document.getElementById("manageCatsBtn").addEventListener("click", () => {
  renderCatList();
  document.getElementById("catOverlay").hidden = false;
});
document.getElementById("outboxBtn").addEventListener("click", () => {
  renderOutbox();
  document.getElementById("outboxOverlay").hidden = false;
});
document.getElementById("closeOutboxBtn").addEventListener("click", () => {
  document.getElementById("outboxOverlay").hidden = true;
});
document.getElementById("exitAdminBtn").addEventListener("click", () => setAdmin(false));
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
    ["checkoutOverlay", "editorOverlay", "catOverlay", "outboxOverlay"].forEach((id) => {
      document.getElementById(id).hidden = true;
    });
  }
});

/* ---------------- init ---------------- */
(async function init() {
  fillStates();
  try {
    await refresh();
  } catch (err) {
    document.getElementById("productGrid").innerHTML =
      '<p class="cart-empty">The shop server is unreachable. Start it with <code>node server/index.js</code>.</p>';
    return;
  }
  renderCats();
  renderGrid();
  renderCart();
})();
