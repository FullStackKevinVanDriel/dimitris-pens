/* Dimitris Pens — editable site settings.
 *
 * FIELDS drives three things: defaults, server-side validation, and the
 * admin "Site settings" form (the frontend renders it from GET /api/settings).
 * Values live one-row-per-key in site_settings; a missing row = default.
 * Pricing fields here are authoritative — the server computes tax/shipping
 * from them, never from the client.
 */
"use strict";

const { pool } = require("./db");

const FONT_STACKS = {
  georgia: 'Georgia, "Times New Roman", serif',
  palatino: '"Palatino Linotype", Palatino, "Book Antiqua", serif',
  garamond: 'Garamond, "EB Garamond", Georgia, serif',
  sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
  mono: '"Courier New", Courier, monospace',
};

// type: text | textarea | color | font | percent | money | rates | email
// private: never sent to the public storefront (admin only)
const FIELDS = [
  // Branding
  {
    key: "page_title",
    group: "Branding",
    label: "Browser tab title",
    type: "text",
    max: 80,
    default: "Dimitris Pens — Fine Writing Instruments",
  },
  {
    key: "est_line",
    group: "Branding",
    label: "Small line above name",
    type: "text",
    max: 80,
    default: "Est. 2026 · Hand-finished",
  },
  {
    key: "shop_name",
    group: "Branding",
    label: "Shop name",
    type: "text",
    max: 60,
    default: "Dimitris Pens",
  },
  {
    key: "tagline",
    group: "Branding",
    label: "Tagline",
    type: "text",
    max: 120,
    default: "Fine writing instruments, made to be kept",
  },
  {
    key: "announcement",
    group: "Branding",
    label: "Announcement banner (blank = hidden)",
    type: "text",
    max: 200,
    default: "",
  },

  // Page text
  {
    key: "about_heading",
    group: "Page text",
    label: "About heading",
    type: "text",
    max: 80,
    default: "A note from the bench",
  },
  {
    key: "about_body",
    group: "Page text",
    label: "About text (blank line = new paragraph)",
    type: "textarea",
    max: 3000,
    default:
      "Every pen here is turned, fitted, and polished by hand in small batches. Nibs are tuned before they ship, and each instrument leaves the shop with a handwritten test card. If a pen is sold out, it is gone — the next batch is never quite the same.",
  },
  {
    key: "footer_address",
    group: "Page text",
    label: "Footer line",
    type: "text",
    max: 160,
    default: "Dimitris Pens · 412 Inkwell Lane, Olympia, WA 98501",
  },
  {
    key: "footer_fineprint",
    group: "Page text",
    label: "Footer fine print",
    type: "text",
    max: 160,
    default: "All sales final on custom work.",
  },
  {
    key: "all_label",
    group: "Page text",
    label: '"All" category label',
    type: "text",
    max: 30,
    default: "All",
  },
  {
    key: "add_to_cart_label",
    group: "Page text",
    label: "Add-to-cart button",
    type: "text",
    max: 30,
    default: "Add to Cart",
  },
  {
    key: "sold_out_label",
    group: "Page text",
    label: "Sold-out label",
    type: "text",
    max: 30,
    default: "Sold out",
  },
  {
    key: "empty_category_text",
    group: "Page text",
    label: "Empty category message",
    type: "text",
    max: 120,
    default: "No pens in this category yet.",
  },
  {
    key: "confirm_heading",
    group: "Page text",
    label: "Order confirmation heading",
    type: "text",
    max: 80,
    default: "Thank you.",
  },
  {
    key: "confirm_body",
    group: "Page text",
    label: "Order confirmation message",
    type: "text",
    max: 300,
    default:
      "Your pens are being wrapped. A confirmation is on its way to the bench.",
  },

  // Theme
  {
    key: "color_paper",
    group: "Theme",
    label: "Background",
    type: "color",
    default: "#faf6ee",
  },
  {
    key: "color_paper_deep",
    group: "Theme",
    label: "Background (deep)",
    type: "color",
    default: "#f1e9d6",
  },
  {
    key: "color_ink",
    group: "Theme",
    label: "Text",
    type: "color",
    default: "#1b1814",
  },
  {
    key: "color_ink_soft",
    group: "Theme",
    label: "Text (soft)",
    type: "color",
    default: "#57503f",
  },
  {
    key: "color_rule",
    group: "Theme",
    label: "Rules / borders",
    type: "color",
    default: "#d9cdae",
  },
  {
    key: "color_accent",
    group: "Theme",
    label: "Accent",
    type: "color",
    default: "#6b2222",
  },
  {
    key: "color_accent_dark",
    group: "Theme",
    label: "Accent (hover)",
    type: "color",
    default: "#521a1a",
  },
  {
    key: "color_brass",
    group: "Theme",
    label: "Brass highlight",
    type: "color",
    default: "#a67c3d",
  },
  {
    key: "color_sold",
    group: "Theme",
    label: "Sold-out text",
    type: "color",
    default: "#8a8474",
  },
  {
    key: "heading_font",
    group: "Theme",
    label: "Heading font",
    type: "font",
    options: Object.keys(FONT_STACKS),
    default: "georgia",
  },
  {
    key: "body_font",
    group: "Theme",
    label: "Body font",
    type: "font",
    options: Object.keys(FONT_STACKS),
    default: "sans",
  },

  // Pricing (authoritative, server-side)
  {
    key: "tax_rates",
    group: "Pricing",
    label: "Sales tax by state (e.g. WA=6.5)",
    type: "rates",
    default: { WA: 0.065, CA: 0.0725, OR: 0, NY: 0.08, TX: 0.0625 },
  },
  {
    key: "default_tax",
    group: "Pricing",
    label: "Tax for other states (%)",
    type: "percent",
    default: 0.05,
  },
  {
    key: "ship_standard_cents",
    group: "Pricing",
    label: "Standard shipping ($)",
    type: "money",
    default: 695,
  },
  {
    key: "ship_express_cents",
    group: "Pricing",
    label: "Express shipping ($)",
    type: "money",
    default: 1495,
  },
  {
    key: "free_ship_at_cents",
    group: "Pricing",
    label: "Free standard shipping at ($, 0 = never)",
    type: "money",
    default: 7500,
  },
  {
    key: "ship_standard_label",
    group: "Pricing",
    label: "Standard shipping label",
    type: "text",
    max: 60,
    default: "Standard (5–7 days)",
  },
  {
    key: "ship_express_label",
    group: "Pricing",
    label: "Express shipping label",
    type: "text",
    max: 60,
    default: "Express (2 days)",
  },
  {
    key: "tax_note",
    group: "Pricing",
    label: "Note under checkout totals",
    type: "text",
    max: 200,
    default:
      "Tax is estimated from the shipping state and finalized at packing.",
  },

  // Notifications
  {
    key: "alert_recipient",
    group: "Notifications",
    label: "Shipping alert email",
    type: "email",
    private: true,
    default: process.env.ALERT_TO || "orders@dimitris-pens.local",
  },
];
const BY_KEY = Object.fromEntries(FIELDS.map((f) => [f.key, f]));

class SettingsError extends Error {
  constructor(msg) {
    super(msg);
    this.status = 422;
  }
}

// Strip control chars (keep \n in textareas) so values are safe plain text.
function cleanText(v, f) {
  const s = String(v)
    .replace(
      f.type === "textarea"
        ? /[\u0000-\u0009\u000b-\u001f\u007f]/g
        : /[\u0000-\u001f\u007f]/g,
      "",
    )
    .trim();
  if (s.length > f.max)
    throw new SettingsError(`${f.label}: max ${f.max} characters`);
  return s;
}

function validate(f, v) {
  switch (f.type) {
    case "text":
    case "textarea":
      return cleanText(v, f);
    case "color":
      if (!/^#[0-9a-fA-F]{6}$/.test(String(v)))
        throw new SettingsError(`${f.label}: use a #rrggbb color`);
      return String(v).toLowerCase();
    case "font":
      if (!f.options.includes(v))
        throw new SettingsError(`${f.label}: unknown font`);
      return v;
    case "percent": {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || n > 0.25)
        throw new SettingsError(`${f.label}: 0–25%`);
      return Math.round(n * 1e6) / 1e6;
    }
    case "money": {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0 || n > 10000000)
        throw new SettingsError(`${f.label}: invalid amount`);
      return n;
    }
    case "rates": {
      if (!v || typeof v !== "object" || Array.isArray(v))
        throw new SettingsError(`${f.label}: expected STATE=percent pairs`);
      const out = {};
      for (const [st, r] of Object.entries(v)) {
        const n = Number(r);
        if (!/^[A-Z]{2}$/.test(st) || !Number.isFinite(n) || n < 0 || n > 0.25)
          throw new SettingsError(`${f.label}: bad entry ${st}`);
        out[st] = Math.round(n * 1e6) / 1e6;
      }
      return out;
    }
    case "email": {
      const s = String(v).trim();
      if (!/^[^\s@<>"]+@[^\s@<>"]+$/.test(s) || s.length > 200)
        throw new SettingsError(`${f.label}: invalid email`);
      return s;
    }
    default:
      throw new SettingsError("unsupported field type");
  }
}

async function getAll() {
  const { rows } = await pool.query("SELECT key, value FROM site_settings");
  const out = Object.fromEntries(FIELDS.map((f) => [f.key, f.default]));
  for (const r of rows) if (BY_KEY[r.key]) out[r.key] = r.value;
  return out;
}

async function getPublic() {
  const all = await getAll();
  for (const f of FIELDS) if (f.private) delete all[f.key];
  return all;
}

/* patch: {key: value | null}. null resets to default. Validates everything
 * before writing anything. */
async function update(patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch))
    throw new SettingsError("expected an object");
  const writes = [];
  for (const [k, v] of Object.entries(patch)) {
    const f = BY_KEY[k];
    if (!f) throw new SettingsError("unknown setting: " + k);
    writes.push([k, v === null ? null : validate(f, v)]);
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const [k, v] of writes) {
      if (v === null)
        await client.query("DELETE FROM site_settings WHERE key = $1", [k]);
      else
        await client.query(
          `INSERT INTO site_settings (key, value, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
          [k, JSON.stringify(v)],
        );
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  return getAll();
}

/* Field metadata for the admin form (no defaults that could be private). */
function fieldMeta() {
  return FIELDS.map(({ key, group, label, type, max, options }) => ({
    key,
    group,
    label,
    type,
    max,
    options,
  }));
}

module.exports = {
  FIELDS,
  FONT_STACKS,
  getAll,
  getPublic,
  update,
  fieldMeta,
  SettingsError,
};
