/* Dimitris Pens — single-file shop app. All state in localStorage. */
"use strict";

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
  if (p.img) return '<img src="' + p.img + '" alt="">';
  var ic = ICONS[p.icon] || ICONS.classic;
  return penSVG(ic.style, ic.accent);
}

/* ---------------- Seed data ---------------- */
var SEED_CATS = ["Fountain Pens", "Rollerballs", "Pencils"];
function seedProducts() {
  return [
    { id: "p1", name: "The Meridian", price: 185, category: "Fountain Pens",
      stock: 4, icon: "classic",
      desc: "Ebonite fountain pen with a tuned steel nib. Writes wet and smooth." },
    { id: "p2", name: "Harbor & Pine", price: 240, category: "Fountain Pens",
      stock: 2, icon: "forest",
      desc: "Forest-green ebonite, brass trim, medium nib ground in-house." },
    { id: "p3", name: "The Night Desk", price: 320, category: "Fountain Pens",
      stock: 1, icon: "midnight",
      desc: "Midnight-blue lacquer over brass. Our finest nib, broad italic." },
    { id: "p4", name: "Commuter Roller", price: 85, category: "Rollerballs",
      stock: 9, icon: "roller",
      desc: "Black anodized aluminum rollerball. Takes standard refills." },
    { id: "p5", name: "Brass Daily", price: 120, category: "Rollerballs",
      stock: 6, icon: "brassrb",
      desc: "Solid brass body that picks up a patina. Weighted for long notes." },
    { id: "p6", name: "Cedar No. 2", price: 45, category: "Pencils",
      stock: 12, icon: "pencil",
      desc: "Hand-turned cedar mechanical pencil, 0.7mm, brass clutch." },
    { id: "p7", name: "The Draftsman", price: 68, category: "Pencils",
      stock: 0, icon: "pencil",
      desc: "Knurled grip drafting pencil, 0.5mm. A shop favorite — back soon." }
  ];
}

/* ---------------- State ---------------- */
var LS_KEY = "dp_state_v1";
var state = load() || { products: seedProducts(), categories: SEED_CATS.slice(), cart: [], orders: [] };

function load() {
  try {
    var raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}
function save() { localStorage.setItem(LS_KEY, JSON.stringify(state)); }

var admin = localStorage.getItem("dp_admin") === "1" ||
            new URLSearchParams(location.search).get("admin") === "1";
var activeCat = "All";

function prod(id) { return state.products.find(function (p) { return p.id === id; }); }
function money(n) { return "$" + n.toFixed(2); }
function uid(prefix) { return prefix + Math.random().toString(36).slice(2, 8); }

/* ---------------- Shop grid ---------------- */
function renderCats() {
  var nav = document.getElementById("categoryNav");
  var cats = ["All"].concat(state.categories);
  nav.innerHTML = cats.map(function (c) {
    return '<button data-cat="' + esc(c) + '"' + (c === activeCat ? ' class="active"' : "") + ">" + esc(c) + "</button>";
  }).join("");
  nav.querySelectorAll("button").forEach(function (b) {
    b.addEventListener("click", function () { activeCat = b.dataset.cat; renderCats(); renderGrid(); });
  });
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function renderGrid() {
  var grid = document.getElementById("productGrid");
  var list = state.products.filter(function (p) {
    return activeCat === "All" || p.category === activeCat;
  });
  if (!list.length) {
    grid.innerHTML = '<p class="cart-empty">No pens in this category yet.</p>';
    return;
  }
  grid.innerHTML = "";
  list.forEach(function (p) {
    var card = document.createElement("article");
    card.className = "card";
    var stockHtml = p.stock <= 0
      ? '<span class="soldout">Sold out</span>'
      : '<span class="stock-note' + (p.stock <= 2 ? " low" : "") + '">' +
        (p.stock <= 2 ? "Only " + p.stock + " left" : p.stock + " in stock") + "</span>";
    var actionHtml = p.stock <= 0
      ? '<span class="soldout">Sold out</span>'
      : '<button class="add-btn" data-add="' + p.id + '">Add to Cart</button>';
    card.innerHTML =
      '<div class="card-img">' + artFor(p) + "</div>" +
      '<div class="card-body">' +
        '<span class="card-cat">' + esc(p.category) + "</span>" +
        "<h3>" + esc(p.name) + "</h3>" +
        '<p class="card-desc">' + esc(p.desc || "") + "</p>" +
        '<div class="card-row"><span class="price" data-price="' + p.id + '">' + money(p.price) + "</span>" + stockHtml + "</div>" +
        '<div class="card-row">' + actionHtml + "</div>" +
      "</div>" +
      (admin ? adminControls(p) : "");
    grid.appendChild(card);
  });
  grid.querySelectorAll("[data-add]").forEach(function (b) {
    b.addEventListener("click", function () { addToCart(b.dataset.add, 1); });
  });
  if (admin) wireAdminControls(grid);
  document.getElementById("adminBar").hidden = !admin;
  renderAlertQueue();
}

function adminControls(p) {
  return '<div class="card-admin">' +
    '<button data-edit="' + p.id + '">Edit</button>' +
    '<button data-img="' + p.id + '">Picture</button>' +
    '<button data-up="' + p.id + '" title="Move up">&#8593;</button>' +
    '<button data-down="' + p.id + '" title="Move down">&#8595;</button>' +
    '<button class="danger" data-del="' + p.id + '">Delete</button>' +
    '<span class="price-edit">$<input data-pricein="' + p.id + '" value="' + p.price.toFixed(2) + '">' +
    '<button data-priceset="' + p.id + '">Set</button></span>' +
  "</div>";
}

function wireAdminControls(grid) {
  grid.querySelectorAll("[data-edit]").forEach(function (b) {
    b.addEventListener("click", function () { openEditor(prod(b.dataset.edit)); });
  });
  grid.querySelectorAll("[data-del]").forEach(function (b) {
    b.addEventListener("click", function () {
      var p = prod(b.dataset.del);
      if (confirm('Delete "' + p.name + '"?')) {
        state.products = state.products.filter(function (x) { return x.id !== p.id; });
        state.cart = state.cart.filter(function (c) { return c.id !== p.id; });
        save(); renderGrid(); renderCart();
      }
    });
  });
  grid.querySelectorAll("[data-up],[data-down]").forEach(function (b) {
    b.addEventListener("click", function () {
      var dir = b.hasAttribute("data-up") ? -1 : 1;
      moveProduct(b.dataset.up || b.dataset.down, dir);
    });
  });
  grid.querySelectorAll("[data-img]").forEach(function (b) {
    b.addEventListener("click", function () { quickImageChange(b.dataset.img); });
  });
  grid.querySelectorAll("[data-priceset]").forEach(function (b) {
    b.addEventListener("click", function () {
      var id = b.dataset.priceset;
      var inp = grid.querySelector('[data-pricein="' + id + '"]');
      var v = parseFloat(inp.value);
      if (isNaN(v) || v < 0) { alert("Enter a valid price."); return; }
      prod(id).price = Math.round(v * 100) / 100;
      save(); renderGrid(); renderCart();
    });
  });
}

function moveProduct(id, dir) {
  var i = state.products.findIndex(function (p) { return p.id === id; });
  var j = i + dir;
  if (i < 0 || j < 0 || j >= state.products.length) return;
  var t = state.products[i]; state.products[i] = state.products[j]; state.products[j] = t;
  save(); renderGrid();
}

function quickImageChange(id) {
  var p = prod(id);
  var choice = prompt(
    "Change picture for \"" + p.name + '":\n- type "upload" to pick a photo file\n- or type an icon key: ' + Object.keys(ICONS).join(", "),
    p.icon || "classic");
  if (choice === null) return;
  choice = choice.trim();
  if (choice === "upload") {
    var inp = document.createElement("input");
    inp.type = "file"; inp.accept = "image/*";
    inp.onchange = function () {
      var f = inp.files[0];
      if (!f) return;
      var r = new FileReader();
      r.onload = function () { p.img = r.result; p.icon = null; save(); renderGrid(); };
      r.readAsDataURL(f);
    };
    inp.click();
  } else if (ICONS[choice]) {
    p.icon = choice; p.img = null; save(); renderGrid();
  } else {
    alert("Unknown icon key.");
  }
}

/* ---------------- Cart ---------------- */
function cartQty() {
  return state.cart.reduce(function (n, c) { return n + c.qty; }, 0);
}
function cartSubtotal() {
  return state.cart.reduce(function (n, c) {
    var p = prod(c.id);
    return p ? n + p.price * c.qty : n;
  }, 0);
}

function addToCart(id, qty) {
  var p = prod(id);
  if (!p || p.stock <= 0) return;
  var line = state.cart.find(function (c) { return c.id === id; });
  var inCart = line ? line.qty : 0;
  if (inCart + qty > p.stock) {
    alert("Only " + p.stock + " of \"" + p.name + "\" in stock.");
    qty = p.stock - inCart;
  }
  if (qty <= 0) return;
  if (line) line.qty += qty; else state.cart.push({ id: id, qty: qty });
  save(); renderCart(); renderGrid();
}

function renderCart() {
  document.getElementById("cartCount").textContent = cartQty();
  var box = document.getElementById("cartItems");
  var foot = document.getElementById("cartFoot");
  if (!state.cart.length) {
    box.innerHTML = '<p class="cart-empty">Your cart is empty.</p>';
    foot.innerHTML = "";
    return;
  }
  box.innerHTML = "";
  state.cart.forEach(function (c) {
    var p = prod(c.id);
    if (!p) return;
    var div = document.createElement("div");
    div.className = "cart-line";
    div.innerHTML =
      '<div class="cart-thumb">' + artFor(p) + "</div>" +
      '<div class="cart-info"><h4>' + esc(p.name) + "</h4>" +
        '<span class="unit">' + money(p.price) + " each</span>" +
        '<div class="qty-row">' +
          '<button data-dec="' + p.id + '" aria-label="Decrease">&minus;</button>' +
          '<span class="qty">' + c.qty + "</span>" +
          '<button data-inc="' + p.id + '" aria-label="Increase">+</button>' +
          '<button class="remove-link" data-rm="' + p.id + '">remove</button>' +
        "</div></div>" +
      '<div class="line-total">' + money(p.price * c.qty) + "</div>";
    box.appendChild(div);
  });
  foot.innerHTML =
    '<div class="subtotal-row"><span>Subtotal</span><strong>' + money(cartSubtotal()) + "</strong></div>" +
    '<button class="primary-btn" id="checkoutBtn">Checkout</button>' +
    '<button class="ghost-btn" id="continueBtn">Continue shopping</button>';
  box.querySelectorAll("[data-inc]").forEach(function (b) {
    b.addEventListener("click", function () { addToCart(b.dataset.inc, 1); });
  });
  box.querySelectorAll("[data-dec]").forEach(function (b) {
    b.addEventListener("click", function () {
      var line = state.cart.find(function (c) { return c.id === b.dataset.dec; });
      if (line) { line.qty--; if (line.qty <= 0) state.cart = state.cart.filter(function (c) { return c !== line; }); }
      save(); renderCart(); renderGrid();
    });
  });
  box.querySelectorAll("[data-rm]").forEach(function (b) {
    b.addEventListener("click", function () {
      state.cart = state.cart.filter(function (c) { return c.id !== b.dataset.rm; });
      save(); renderCart(); renderGrid();
    });
  });
  document.getElementById("checkoutBtn").addEventListener("click", openCheckout);
  document.getElementById("continueBtn").addEventListener("click", closeCart);
}

function openCart() {
  renderCart();
  document.getElementById("cartDrawer").hidden = false;
  document.getElementById("drawerOverlay").hidden = false;
}
function closeCart() {
  document.getElementById("cartDrawer").hidden = true;
  document.getElementById("drawerOverlay").hidden = true;
}

/* ---------------- Checkout: tax + shipping ---------------- */
var TAX = { WA: 0.065, CA: 0.0725, OR: 0, NY: 0.08, TX: 0.0625 };
var STATES = ["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC"];

function taxRate(st) { return TAX[st] !== undefined ? TAX[st] : 0.05; }

function shipCost(method, subtotal) {
  if (method === "express") return 14.95;
  return subtotal >= 75 ? 0 : 6.95;
}

function fillStates() {
  var sel = document.getElementById("stateSelect");
  sel.innerHTML = '<option value="">—</option>' + STATES.map(function (s) {
    return '<option value="' + s + '"' + (s === "WA" ? " selected" : "") + ">" + s + "</option>";
  }).join("");
}

function totals() {
  var sub = cartSubtotal();
  var st = document.getElementById("stateSelect").value;
  var method = document.querySelector('input[name="ship"]:checked').value;
  var tax = sub * taxRate(st);
  var ship = shipCost(method, sub);
  return { sub: sub, tax: tax, ship: ship, total: sub + tax + ship, rate: taxRate(st), method: method, state: st };
}

function renderCheckoutTotals() {
  var t = totals();
  document.getElementById("stdShipLabel").textContent =
    t.sub >= 75 ? "FREE" : "$6.95";
  document.getElementById("checkoutTotals").innerHTML =
    '<div class="trow"><span>Subtotal</span><span>' + money(t.sub) + "</span></div>" +
    '<div class="trow"><span>Sales tax (est. ' + (t.rate * 100).toFixed(2) + "%)</span><span>" + money(t.tax) + "</span></div>" +
    '<div class="trow"><span>Shipping (' + t.method + ")</span><span>" + (t.ship === 0 ? "FREE" : money(t.ship)) + "</span></div>" +
    '<div class="trow grand"><span>Total</span><span>' + money(t.total) + "</span></div>" +
    '<p class="tax-note">Tax is estimated from the shipping state and finalized at packing.</p>';
}

function openCheckout() {
  if (!state.cart.length) return;
  closeCart();
  document.getElementById("confirmation").hidden = true;
  document.getElementById("processing").hidden = true;
  document.getElementById("checkoutForm").hidden = false;
  document.getElementById("payStep1").hidden = false;
  document.getElementById("payStep2").hidden = true;
  document.getElementById("payError").hidden = true;
  var sum = state.cart.map(function (c) {
    var p = prod(c.id);
    return "<tr><td>" + esc(p.name) + " × " + c.qty + "</td><td>" + money(p.price * c.qty) + "</td></tr>";
  }).join("");
  document.getElementById("orderSummary").innerHTML =
    "<h3>Order summary</h3><table>" + sum + "</table>";
  renderCheckoutTotals();
  document.getElementById("checkoutOverlay").hidden = false;
}

function gotoPaymentStep() {
  // Validate only the address step's fields before advancing.
  var inputs = document.getElementById("payStep1").querySelectorAll("input, select");
  for (var i = 0; i < inputs.length; i++) {
    if (!inputs[i].checkValidity()) { inputs[i].reportValidity(); return; }
  }
  document.getElementById("payStep1").hidden = true;
  document.getElementById("payStep2").hidden = false;
  document.getElementById("payError").hidden = true;
  renderPayTotals();
}

function renderPayTotals() {
  var t = totals();
  document.getElementById("payTotals").innerHTML =
    '<div class="trow"><span>Subtotal</span><span>' + money(t.sub) + "</span></div>" +
    '<div class="trow"><span>Sales tax (est. ' + (t.rate * 100).toFixed(2) + "%)</span><span>" + money(t.tax) + "</span></div>" +
    '<div class="trow"><span>Shipping (' + t.method + ")</span><span>" + (t.ship === 0 ? "FREE" : money(t.ship)) + "</span></div>" +
    '<div class="trow grand"><span>Total</span><span>' + money(t.total) + "</span></div>";
  document.getElementById("payBtn").textContent = "Pay " + money(t.total);
}

function setFieldErrors(errors) {
  var map = { number: "errNum", exp: "errExp", cvc: "errCvc", name: "errName" };
  Object.keys(map).forEach(function (k) {
    document.getElementById(map[k]).textContent = errors[k] || "";
  });
}

function submitPayment(ev) {
  ev.preventDefault();
  var card = {
    number: document.getElementById("ccNum").value,
    exp: document.getElementById("ccExp").value,
    cvc: document.getElementById("ccCvc").value,
    name: document.getElementById("ccName").value
  };
  var v = Payments.validateCard(card);
  setFieldErrors(v.errors);
  if (!v.valid) return;

  document.getElementById("checkoutForm").hidden = true;
  document.getElementById("processing").hidden = false;
  document.getElementById("payError").hidden = true;

  var t = totals();
  // TODO(live): amount stays in cents; cardDetails would be replaced by a
  // Stripe Element / paymentMethod id — see payments.js header.
  Payments.processPayment({
    amount: Math.round(t.total * 100),
    currency: "usd",
    cardDetails: card
  }).then(function (pi) {
    completeOrder(t, pi.id);
  }).catch(function (err) {
    document.getElementById("processing").hidden = true;
    document.getElementById("checkoutForm").hidden = false;
    var pe = document.getElementById("payError");
    pe.textContent = (err && err.message) || "Payment failed. Please try again.";
    pe.hidden = false;
  });
}

function completeOrder(t, paymentId) {
  // Re-check stock before committing
  for (var i = 0; i < state.cart.length; i++) {
    var p = prod(state.cart[i].id);
    if (!p || p.stock < state.cart[i].qty) {
      document.getElementById("processing").hidden = true;
      document.getElementById("checkoutForm").hidden = false;
      alert('Sorry — "' + (p ? p.name : "an item") + '" is no longer in stock in that quantity.');
      return;
    }
  }
  var form = document.getElementById("checkoutForm");
  var orderNo = "DP-" + Math.random().toString(36).slice(2, 8).toUpperCase();
  state.cart.forEach(function (c) { prod(c.id).stock -= c.qty; }); // deplete as sold
  var order = {
    no: orderNo, date: new Date().toISOString(),
    payment: paymentId || null,
    items: state.cart.map(function (c) {
      var p2 = prod(c.id);
      return { name: p2.name, qty: c.qty, price: p2.price };
    }),
    sub: t.sub, tax: t.tax, ship: t.ship, total: t.total, shipMethod: t.method,
    shipTo: {
      name: form.name.value, street: form.street.value,
      city: form.city.value, state: t.state, zip: form.zip.value
    }
  };
  state.orders.push(order);
  state.cart = [];
  save();
  sendShippingAlert(order); // fire-and-forget; queues locally if mailer is down
  document.getElementById("processing").hidden = true;
  var conf = document.getElementById("confirmation");
  conf.hidden = false;
  conf.innerHTML =
    "<h3>Thank you.</h3>" +
    '<p class="order-no">' + orderNo + "</p>" +
    "<p>Your pens are being wrapped. A confirmation is on its way to the bench.</p>" +
    "<p><strong>" + money(t.total) + "</strong> paid" +
    (Payments.isMock() ? " (test mode — no real charge)" : "") + " · " +
    esc(order.shipTo.city) + ", " + esc(order.shipTo.state) + "</p>" +
    '<button class="ghost-btn" id="doneBtn">Back to the shop</button>';
  document.getElementById("doneBtn").addEventListener("click", function () {
    document.getElementById("checkoutOverlay").hidden = true;
    renderGrid(); renderCart();
  });
  renderGrid(); renderCart();
}

/* ---------------- Admin: product editor ---------------- */
function fillEditorSelects() {
  var cs = document.getElementById("editorCategory");
  cs.innerHTML = state.categories.map(function (c) {
    return '<option value="' + esc(c) + '">' + esc(c) + "</option>";
  }).join("");
  var ic = document.getElementById("editorIcon");
  ic.innerHTML = Object.keys(ICONS).map(function (k) {
    return '<option value="' + k + '">' + esc(ICONS[k].label) + "</option>";
  }).join("");
}

function openEditor(p) {
  fillEditorSelects();
  var f = document.getElementById("editorForm");
  f.reset();
  document.getElementById("editorTitle").textContent = p ? "Edit pen" : "Add pen";
  document.getElementById("imgPreview").innerHTML = "";
  if (p) {
    f.id.value = p.id;
    f.name.value = p.name;
    f.price.value = p.price.toFixed(2);
    f.category.value = p.category;
    f.stock.value = p.stock;
    f.desc.value = p.desc || "";
    if (p.icon) f.icon.value = p.icon;
    document.getElementById("imgPreview").innerHTML = artFor(p);
  } else {
    f.id.value = "";
  }
  document.getElementById("editorOverlay").hidden = false;
}

function saveEditor(ev) {
  ev.preventDefault();
  var f = ev.target;
  var price = Math.round(parseFloat(f.price.value) * 100) / 100;
  var stock = parseInt(f.stock.value, 10);
  if (isNaN(price) || price < 0 || isNaN(stock) || stock < 0) {
    alert("Price and stock must be valid non-negative numbers.");
    return;
  }
  var data = {
    name: f.name.value.trim(),
    price: price,
    category: f.category.value,
    stock: stock,
    desc: f.desc.value.trim(),
    icon: f.icon.value,
    img: f.id.value ? prod(f.id.value).img : null
  };
  var file = document.getElementById("photoInput").files[0];
  var done = function () {
    if (f.id.value) {
      var p = prod(f.id.value);
      Object.assign(p, data);
    } else {
      data.id = uid("p");
      state.products.push(data);
    }
    save();
    document.getElementById("editorOverlay").hidden = true;
    renderCats(); renderGrid(); renderCart();
  };
  if (file) {
    var r = new FileReader();
    r.onload = function () { data.img = r.result; data.icon = null; done(); };
    r.readAsDataURL(file);
  } else {
    if (!f.id.value || !prod(f.id.value).img) data.img = null;
    done();
  }
}

/* ---------------- Admin: categories ---------------- */
function renderCatList() {
  var ul = document.getElementById("catList");
  ul.innerHTML = "";
  state.categories.forEach(function (c) {
    var n = state.products.filter(function (p) { return p.category === c; }).length;
    var li = document.createElement("li");
    li.innerHTML = "<span>" + esc(c) + '<span class="count">' + n + " pen" + (n === 1 ? "" : "s") + "</span></span>" +
      '<span class="mini-btns"><button data-rename>rename</button><button data-delcat>delete</button></span>';
    li.querySelector("[data-rename]").addEventListener("click", function () {
      var v = prompt("Rename category:", c);
      if (v === null) return;
      v = v.trim();
      if (!v) return;
      if (state.categories.indexOf(v) !== -1 && v !== c) { alert("That category already exists."); return; }
      state.products.forEach(function (p) { if (p.category === c) p.category = v; });
      state.categories[state.categories.indexOf(c)] = v;
      if (activeCat === c) activeCat = v;
      save(); renderCatList(); renderCats(); renderGrid();
    });
    li.querySelector("[data-delcat]").addEventListener("click", function () {
      var n2 = state.products.filter(function (p) { return p.category === c; }).length;
      if (n2 > 0 && !confirm('Delete "' + c + '"? Its ' + n2 + ' pen(s) move to "Uncategorized".')) return;
      state.products.forEach(function (p) { if (p.category === c) p.category = "Uncategorized"; });
      if (state.categories.indexOf("Uncategorized") === -1) state.categories.push("Uncategorized");
      state.categories = state.categories.filter(function (x) { return x !== c; });
      if (activeCat === c) activeCat = "All";
      save(); renderCatList(); renderCats(); renderGrid();
    });
    ul.appendChild(li);
  });
}

/* ---------------- Shipping alerts (Mailpit backend, local dev only) ----------------
 * On a paid order the site POSTs the order to a tiny local backend
 * (server/mailer.js, http://localhost:3001) which emails a shipping alert
 * through Mailpit. If the backend isn't reachable (e.g. on GitHub Pages),
 * the alert is queued in localStorage and surfaced in admin mode — checkout
 * itself never breaks.
 */
var MAILER_URL = "http://localhost:3001/api/shipping-alert";
var QUEUE_KEY = "dp_alert_queue";

function getQueue() {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]"); }
  catch (e) { return []; }
}
function setQueue(q) { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); }

function sendShippingAlert(order) {
  var ctrl = new AbortController();
  var timer = setTimeout(function () { ctrl.abort(); }, 3000);
  fetch(MAILER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ order: order }),
    signal: ctrl.signal
  }).then(function (r) { return r.json(); })
    .then(function (data) {
      clearTimeout(timer);
      if (data && data.ok) {
        console.log("shipping alert sent, messageId:", data.messageId);
      } else {
        queueAlert(order);
      }
    })
    .catch(function () { clearTimeout(timer); queueAlert(order); });
}

function queueAlert(order) {
  var q = getQueue();
  if (!q.some(function (o) { return o.no === order.no; })) q.push(order);
  setQueue(q);
  renderAlertQueue();
}

function retryAlert(orderNo) {
  var order = getQueue().find(function (o) { return o.no === orderNo; });
  if (!order) return;
  fetch(MAILER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ order: order })
  }).then(function (r) { return r.json(); })
    .then(function (data) {
      if (data && data.ok) {
        setQueue(getQueue().filter(function (o) { return o.no !== orderNo; }));
        renderAlertQueue();
      } else { alert("Mailer still unreachable."); }
    })
    .catch(function () { alert("Mailer still unreachable."); });
}

function renderAlertQueue() {
  var box = document.getElementById("alertQueue");
  var q = getQueue();
  if (!admin || !q.length) { box.hidden = true; return; }
  box.hidden = false;
  document.getElementById("alertCount").textContent = "(" + q.length + ")";
  var ul = document.getElementById("alertList");
  ul.innerHTML = "";
  q.forEach(function (o) {
    var li = document.createElement("li");
    li.innerHTML = "<span><strong>" + esc(o.no) + "</strong> · " +
      o.items.map(function (it) { return it.qty + "x " + esc(it.name); }).join(", ") +
      " · " + money(o.total) + " · " + esc(o.shipTo.city) + ", " + esc(o.shipTo.state) +
      '</span><span class="mini-btns"><button data-retry="' + esc(o.no) + '">Retry send</button></span>';
    ul.appendChild(li);
  });
  ul.querySelectorAll("[data-retry]").forEach(function (b) {
    b.addEventListener("click", function () { retryAlert(b.dataset.retry); });
  });
}

/* ---------------- Admin mode toggle ---------------- */
function setAdmin(on) {
  admin = on;
  localStorage.setItem("dp_admin", on ? "1" : "0");
  if (on && new URLSearchParams(location.search).get("admin") === "1") {
    history.replaceState(null, "", location.pathname);
  }
  renderCats(); renderGrid();
}

/* ---------------- Wire up ---------------- */
document.getElementById("cartBtn").addEventListener("click", openCart);
document.getElementById("closeCartBtn").addEventListener("click", closeCart);
document.getElementById("drawerOverlay").addEventListener("click", closeCart);
document.getElementById("closeCheckoutBtn").addEventListener("click", function () {
  document.getElementById("checkoutOverlay").hidden = true;
});
document.getElementById("checkoutForm").addEventListener("submit", submitPayment);
document.getElementById("toPaymentBtn").addEventListener("click", gotoPaymentStep);
document.getElementById("backToAddrBtn").addEventListener("click", function () {
  document.getElementById("payStep2").hidden = true;
  document.getElementById("payStep1").hidden = false;
});
/* Stripe-like card field formatting, as-you-type */
document.getElementById("ccNum").addEventListener("input", function () {
  this.value = Payments.formatCardNumber(this.value);
});
document.getElementById("ccExp").addEventListener("input", function () {
  this.value = Payments.formatExpiry(this.value);
});
document.getElementById("ccCvc").addEventListener("input", function () {
  this.value = Payments.formatCVC(this.value);
});
document.getElementById("stateSelect").addEventListener("change", renderCheckoutTotals);
document.querySelectorAll('input[name="ship"]').forEach(function (r) {
  r.addEventListener("change", renderCheckoutTotals);
});
document.getElementById("adminLink").addEventListener("click", function (e) {
  e.preventDefault();
  setAdmin(!admin);
});
document.getElementById("addPenBtn").addEventListener("click", function () { openEditor(null); });
document.getElementById("manageCatsBtn").addEventListener("click", function () {
  renderCatList();
  document.getElementById("catOverlay").hidden = false;
});
document.getElementById("exitAdminBtn").addEventListener("click", function () { setAdmin(false); });
document.getElementById("closeEditorBtn").addEventListener("click", function () {
  document.getElementById("editorOverlay").hidden = true;
});
document.getElementById("editorForm").addEventListener("submit", saveEditor);
document.getElementById("photoInput").addEventListener("change", function () {
  var f = this.files[0];
  if (!f) return;
  var r = new FileReader();
  r.onload = function () {
    document.getElementById("imgPreview").innerHTML = '<img src="' + r.result + '" alt="preview">';
  };
  r.readAsDataURL(f);
});
document.getElementById("closeCatBtn").addEventListener("click", function () {
  document.getElementById("catOverlay").hidden = true;
});
document.getElementById("addCatForm").addEventListener("submit", function (e) {
  e.preventDefault();
  var v = this.newcat.value.trim();
  if (!v) return;
  if (state.categories.indexOf(v) !== -1) { alert("That category already exists."); return; }
  state.categories.push(v);
  this.reset();
  save(); renderCatList(); renderCats();
});
document.getElementById("editorIcon").addEventListener("change", function () {
  var ic = ICONS[this.value];
  if (ic) document.getElementById("imgPreview").innerHTML = penSVG(ic.style, ic.accent);
});
document.addEventListener("keydown", function (e) {
  if (e.key === "Escape") {
    closeCart();
    ["checkoutOverlay", "editorOverlay", "catOverlay"].forEach(function (id) {
      document.getElementById(id).hidden = true;
    });
  }
});

/* ---------------- Init ---------------- */
fillStates();
renderCats();
renderGrid();
renderCart();
