/* Dimitris Pens — payment seam.
 *
 * MOCK Stripe implementation. No real keys, no network calls.
 *
 * HOW TO GO LIVE LATER:
 *  1. TODO: put your publishable key here:
 *       var PUBLISHABLE_KEY = "pk_test_...";   // or "pk_live_..." in production
 *     and load Stripe.js in index.html:
 *       <script src="https://js.stripe.com/v3/"></script>
 *  2. TODO: GitHub Pages is static — real charges need a server. Add a backend
 *     endpoint (e.g. POST /api/create-payment-intent) that creates a
 *     PaymentIntent with your SECRET key and returns its client_secret.
 *  3. TODO: replace the mock body of processPayment() below with:
 *       var stripe = Stripe(PUBLISHABLE_KEY);
 *       var res = await fetch("/api/create-payment-intent", {
 *         method: "POST",
 *         body: JSON.stringify({ amount: opts.amount, currency: opts.currency })
 *       });
 *       var clientSecret = (await res.json()).clientSecret;
 *       return stripe.confirmCardPayment(clientSecret, {
 *         payment_method: { card: cardElement, billing_details: { name: opts.cardDetails.name } }
 *       });
 *     The public contract stays the same: resolves {id, status} on success,
 *     rejects {code, message} on failure — so checkout code needs no changes.
 */
"use strict";

var Payments = (function () {
  // TODO: PUBLISHABLE_KEY = "pk_test_...";  (see header notes)
  var MOCK = true;
  var MOCK_DELAY_MIN = 1000;
  var MOCK_DELAY_MAX = 2000;

  /**
   * Process a payment.
   * @param {Object} opts
   * @param {number} opts.amount    Amount in CENTS (integer), e.g. 1999 = $19.99
   * @param {string} opts.currency  ISO code, e.g. "usd"
   * @param {Object} opts.cardDetails { number, exp, cvc, name }
   * @returns {Promise} resolves {id, status:"succeeded", amount} or
   *                    rejects {code, message}
   */
  function processPayment(opts) {
    return new Promise(function (resolve, reject) {
      var delay = MOCK_DELAY_MIN + Math.random() * (MOCK_DELAY_MAX - MOCK_DELAY_MIN);
      setTimeout(function () {
        var digits = String(opts.cardDetails.number || "").replace(/\D/g, "");
        // Classic Stripe test pattern: cards ending 0002 are declined.
        if (/0002$/.test(digits)) {
          reject({ code: "card_declined", message: "Your card was declined. Try a different card." });
          return;
        }
        // TODO(live): replace this whole setTimeout body with the real
        // stripe.confirmCardPayment() flow described in the header.
        resolve({
          id: "pi_mock_" + Math.random().toString(36).slice(2, 10),
          status: "succeeded",
          amount: opts.amount,
          currency: opts.currency
        });
      }, delay);
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
    isMock: function () { return MOCK; }
  };
})();
