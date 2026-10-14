/* Dimitris Pens — shipping alert mailer.
 *
 * Tiny backend for local dev only. Exposes:
 *   GET  /api/health          -> { ok: true }
 *   POST /api/shipping-alert  -> sends a plain-text shipping alert email
 *                                via Mailpit and logs the message ID.
 *
 * The static GitHub Pages site POSTs here on successful checkout
 * (http://localhost:3001/api/shipping-alert). If this server isn't running,
 * the site queues the alert in localStorage instead — checkout never breaks.
 *
 * Run:  npm install && npm start        (from this server/ directory)
 * Mail: view the inbox at http://localhost:8025 (Mailpit web UI)
 */
"use strict";

var http = require("http");
var nodemailer = require("nodemailer");

var PORT = parseInt(process.env.PORT || "3001", 10);
var MP_HOST = process.env.MP_HOST || "localhost";
var MP_PORT = parseInt(process.env.MP_PORT || "1025", 10);
var ALERT_TO = process.env.ALERT_TO || "orders@dimitris-pens.local";
var ALERT_FROM = process.env.ALERT_FROM || "Dimitris Pens <shop@dimitris-pens.local>";

var transporter = nodemailer.createTransport({
  host: MP_HOST,
  port: MP_PORT,
  secure: false,
  tls: { rejectUnauthorized: false }
});

function money(n) { return "$" + Number(n).toFixed(2); }

function buildBody(o) {
  var lines = [];
  lines.push("New paid order " + o.no + " (" + o.date + ")");
  lines.push("");
  lines.push("Items:");
  (o.items || []).forEach(function (it) {
    lines.push("  " + it.qty + "x " + it.name + " @ " + money(it.price) +
               " = " + money(it.qty * it.price));
  });
  lines.push("");
  lines.push("Subtotal:        " + money(o.sub));
  lines.push("Tax (est):       " + money(o.tax));
  lines.push("Shipping (" + (o.shipMethod || "standard") + "): " +
             (o.ship === 0 ? "FREE" : money(o.ship)));
  lines.push("Total charged:   " + money(o.total));
  lines.push("");
  lines.push("Ship to:");
  var s = o.shipTo || {};
  lines.push("  " + (s.name || ""));
  lines.push("  " + (s.street || ""));
  lines.push("  " + (s.city || "") + ", " + (s.state || "") + " " + (s.zip || ""));
  lines.push("");
  lines.push("Payment: " + (o.payment || "n/a") + " (mock/test mode)");
  lines.push("");
  lines.push("-- Dimitris Pens mailer");
  return lines.join("\n");
}

function sendAlert(order, cb) {
  var mail = {
    from: ALERT_FROM,
    to: ALERT_TO,
    subject: "Shipping alert — order " + order.no,
    text: buildBody(order)
  };
  transporter.sendMail(mail, function (err, info) {
    if (err) return cb(err);
    console.log(new Date().toISOString(),
      "sent shipping alert for", order.no, "messageId:", info.messageId);
    cb(null, info.messageId);
  });
}

function readBody(req, cb) {
  var chunks = [];
  req.on("data", function (c) { chunks.push(c); });
  req.on("end", function () { cb(null, Buffer.concat(chunks).toString("utf8")); });
  req.on("error", cb);
}

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

var server = http.createServer(function (req, res) {
  cors(res);
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  if (req.method === "GET" && req.url === "/api/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === "POST" && req.url === "/api/shipping-alert") {
    readBody(req, function (err, raw) {
      if (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "bad body" }));
        return;
      }
      var payload;
      try { payload = JSON.parse(raw); }
      catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "invalid JSON" }));
        return;
      }
      var order = payload.order;
      if (!order || !order.no) {
        res.writeHead(422, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "missing order.no" }));
        return;
      }
      sendAlert(order, function (sendErr, messageId) {
        if (sendErr) {
          console.error("mail send failed:", sendErr.message);
          res.writeHead(502, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: sendErr.message }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, messageId: messageId }));
      });
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: false, error: "not found" }));
});

server.listen(PORT, function () {
  console.log("dimitris-pens mailer listening on :" + PORT,
    "| SMTP " + MP_HOST + ":" + MP_PORT, "| alerts to " + ALERT_TO);
});
