/* Dimitris Pens — admin feedback tracked as GitHub issues (#40).
 *
 * Each item an admin submits is saved here and opened as an issue on
 * FEEDBACK_REPO (default FullStackKevinVanDriel/dimitris-pens) with
 * GITHUB_TOKEN: a fine-grained token limited to that repo, Issues
 * read/write. The token stays on the server. Without it, items are saved
 * and can be sent later. GITHUB_API_URL overrides the API host for tests.
 *
 * Status comes from the issue: closed as completed -> done, closed as not
 * planned -> resolved, open with label "blocked" -> blocked, open with label
 * "in progress" -> in_progress, else open. Sub-issue counts come from
 * GitHub's sub_issues_summary.
 */
"use strict";

const { pool, uid } = require("./db");

const API = () =>
  (process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/$/, "");
const REPO = () =>
  process.env.FEEDBACK_REPO || "FullStackKevinVanDriel/dimitris-pens";
const enabled = () => Boolean(process.env.GITHUB_TOKEN);

const CATEGORIES = ["bug", "change", "idea", "content"];
const SEVERITIES = ["low", "normal", "high", "urgent"];

async function gh(method, path, body) {
  const r = await fetch(API() + path, {
    method,
    headers: {
      Authorization: "Bearer " + process.env.GITHUB_TOKEN,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "dimitris-pens",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8000),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok)
    throw new Error(
      `GitHub ${r.status}: ${String(data.message || "").slice(0, 200)}`,
    );
  return data;
}

function statusFromIssue(issue) {
  const labels = (issue.labels || []).map((l) =>
    String(l.name || l).toLowerCase(),
  );
  if (issue.state === "closed")
    return issue.state_reason === "not_planned" ? "resolved" : "done";
  if (labels.includes("blocked")) return "blocked";
  if (labels.includes("in progress") || labels.includes("in-progress"))
    return "in_progress";
  return "open";
}

function issueBody(f) {
  return [
    f.description || "(no description)",
    "",
    "---",
    `From admin feedback item \`${f.id}\` in the shop's admin mode.`,
    `Category: ${f.category} · Severity: ${f.severity}`,
    "",
    "Close this issue as completed when the change is live; the admin panel then shows it as done.",
  ].join("\n");
}

const getRow = async (id) =>
  (await pool.query("SELECT * FROM admin_feedback WHERE id = $1", [id]))
    .rows[0];

/* Opens the GitHub issue for a saved item. Never throws: a failure is
 * recorded on the row so the admin can retry. */
async function sendIssue(id) {
  const f = await getRow(id);
  if (!f || f.issue_number) return f;
  let error = null;
  if (!enabled()) {
    error = "GitHub not configured (GITHUB_TOKEN)";
  } else {
    try {
      const issue = await gh("POST", `/repos/${REPO()}/issues`, {
        title: f.title,
        body: issueBody(f),
        labels: ["admin-feedback", `severity:${f.severity}`, f.category],
      });
      await pool.query(
        "UPDATE admin_feedback SET issue_number = $2, issue_url = $3, last_error = NULL, updated_at = NOW() WHERE id = $1",
        [id, issue.number, issue.html_url],
      );
    } catch (e) {
      error = String(e.message).slice(0, 300);
    }
  }
  if (error)
    await pool.query(
      "UPDATE admin_feedback SET last_error = $2, updated_at = NOW() WHERE id = $1",
      [id, error],
    );
  return getRow(id);
}

async function create(input) {
  const title = String(input.title || "")
    .trim()
    .slice(0, 150);
  if (!title) throw Object.assign(new Error("title required"), { status: 422 });
  const description = String(input.description || "")
    .trim()
    .slice(0, 5000);
  const category = CATEGORIES.includes(input.category)
    ? input.category
    : "change";
  const severity = SEVERITIES.includes(input.severity)
    ? input.severity
    : "normal";
  const id = uid("fb");
  await pool.query(
    "INSERT INTO admin_feedback (id, title, description, category, severity) VALUES ($1, $2, $3, $4, $5)",
    [id, title, description, category, severity],
  );
  return sendIssue(id);
}

/* Refreshes status from GitHub for every linked item, then lists them all.
 * A GitHub failure keeps the last known status and is reported, not thrown. */
async function list() {
  const { rows } = await pool.query(
    "SELECT * FROM admin_feedback ORDER BY created_at DESC LIMIT 200",
  );
  let syncError = null;
  if (enabled()) {
    for (const f of rows.filter((x) => x.issue_number)) {
      try {
        const issue = await gh(
          "GET",
          `/repos/${REPO()}/issues/${f.issue_number}`,
        );
        const sub = issue.sub_issues_summary || {};
        f.status = statusFromIssue(issue);
        f.sub_total = sub.total || 0;
        f.sub_done = sub.completed || 0;
        await pool.query(
          "UPDATE admin_feedback SET status = $2, sub_total = $3, sub_done = $4, updated_at = NOW() WHERE id = $1",
          [f.id, f.status, f.sub_total, f.sub_done],
        );
      } catch (e) {
        syncError = String(e.message).slice(0, 200);
      }
    }
  }
  const finished = rows.filter(
    (x) => x.status === "done" || x.status === "resolved",
  ).length;
  return {
    items: rows,
    summary: {
      total: rows.length,
      finished,
      all_complete: rows.length > 0 && finished === rows.length,
    },
    github: { configured: enabled(), repo: REPO(), sync_error: syncError },
  };
}

module.exports = {
  create,
  list,
  sendIssue,
  statusFromIssue,
  CATEGORIES,
  SEVERITIES,
};
