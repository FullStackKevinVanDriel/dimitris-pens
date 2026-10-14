/* Dimitris Pens — payment seam (client side).
 *
 * processPayment() now calls the server's mock endpoint:
 *   POST /api/payments/mock  {amount_cents, currency, card:{number,exp,cvc,name}}
 * The server simulates Stripe: 1-2s delay, success except cards ending 0002
 * (classic Stripe test decline pattern).
 *
 * TODO(live Stripe):
 *  1. Set your publishable key here and load Stripe.js in index.html:
 *       var PUBLISHABLE_KEY = "pk_test_..."; // "pk_live_..." in production
 *       <script src="https://js.stripe.com/v3/"></script>
 *  2. Server: add POST /api/payments/intent {amount_cents, currency} which
 *     creates a PaymentIntent with the SECRET key and returns {client_secret}.
 *     (GitHub Pages can't do this — needs the server. See server/index.js.)
 *  3. Replace the fetch() in processPayment() with:
 *       var stripe = Stripe(PUBLISHABLE_KEY);
 *       var {client_secret} = await (await fetch("/api/payments/intent", {...})).json();
 *       var result = await stripe.confirmCardPayment(client_secret, {
 *         payment_method: { card: cardElement, billing_details: { name } }
 *       });
 *     Keep the {ok,id}/{ok:false,code,message} contract so checkout code
 *     needs no changes.
 */
"use strict";

var Payments = (function () {
  // TODO(live): var PUBLISHABLE_KEY = "pk_test_...";

  /**
   * @param {Object} opts {amount_cents (int), currency, cardDetails:{number,exp,cvc,name}}
   * @returns {Promise} resolves {ok:true,id,status,amount_cents} or
   *                    rejects {ok:false,code,message}
   */
  function processPayment(opts) {
    // TODO(live): replace this fetch with the stripe.confirmCardPayment()
    // flow described in the header comment.
    return fetch("/api/payments/mock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount_cents: opts.amount_cents,
        currency: opts.currency || "usd",
        card: opts.cardDetails
      })
    }).then(function (r) {
      return r.json().then(function (data) {
        if (data && data.ok) return data;
        throw data; // {ok:false, code, message}
      });
    });
  }

  /* ---------- Card field helpers (formatting + validation) ---------- */

  function formatCardNumber(v) {
    var d = v.replace(/\D/g, "").slice(0, 16);
    return d.replace(/(.{4})/g, "$1 ").trim();
  }

  function formatExpiry(v) {
    var d = v.replace(/\D/g, "").slice(0, 4);
    if (d.length >= 3) return d.slice(0, 2) + "/" + d.slice(2);
    return d;
  }

  function formatCVC(v) {
    return v.replace(/\D/g, "").slice(0, 4);
  }

  function luhnOk(num) {
    var d = num.replace(/\D/g, "");
    if (d.length < 13 || d.length > 19) return false;
    var sum = 0, dbl = false;
    for (var i = d.length - 1; i >= 0; i--) {
      var n = parseInt(d[i], 10);
      if (dbl) { n *= 2; if (n > 9) n -= 9; }
      sum += n;
      dbl = !dbl;
    }
    return sum % 10 === 0;
  }

  function validateCard(c) {
    var errors = {};
    if (!luhnOk(c.number || "")) errors.number = "Enter a valid card number.";
    var m = /^(\d{2})\/(\d{2})$/.exec(c.exp || "");
    if (!m) {
      errors.exp = "Use MM/YY.";
    } else {
      var mm = parseInt(m[1], 10), yy = 2000 + parseInt(m[2], 10);
      var now = new Date();
      var endOfMonth = new Date(yy, mm, 0, 23, 59, 59);
      if (mm < 1 || mm > 12 || endOfMonth < now) errors.exp = "Card is expired.";
    }
    if (!/^\d{3,4}$/.test(c.cvc || "")) errors.cvc = "3–4 digits.";
    if (!String(c.name || "").trim()) errors.name = "Name is required.";
    return { valid: Object.keys(errors).length === 0, errors: errors };
  }

  return {
    processPayment: processPayment,
    formatCardNumber: formatCardNumber,
    formatExpiry: formatExpiry,
    formatCVC: formatCVC,
    validateCard: validateCard,
    isMock: function () { return true; }
  };
})();
