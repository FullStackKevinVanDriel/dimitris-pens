-- Up Migration
-- #40: admin feedback items, each tracked as a GitHub issue.
CREATE TABLE IF NOT EXISTS admin_feedback (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  category      TEXT NOT NULL DEFAULT 'change' CHECK (category IN ('bug', 'change', 'idea', 'content')),
  severity      TEXT NOT NULL DEFAULT 'normal' CHECK (severity IN ('low', 'normal', 'high', 'urgent')),
  -- open | in_progress | blocked | resolved | done (mirrors the GitHub issue)
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'blocked', 'resolved', 'done')),
  issue_number  INTEGER,
  issue_url     TEXT,
  sub_total     INTEGER NOT NULL DEFAULT 0,
  sub_done      INTEGER NOT NULL DEFAULT 0,
  last_error    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_admin_feedback_created ON admin_feedback(created_at DESC);

-- Down Migration
DROP TABLE IF EXISTS admin_feedback;
