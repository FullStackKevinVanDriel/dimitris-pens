-- Up Migration
-- #32: the cleanup job deletes by age, so index the timestamps it filters on.
CREATE INDEX IF NOT EXISTS idx_login_failures_created ON login_failures(created_at);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires ON admin_sessions(expires_at);

-- Down Migration
DROP INDEX IF EXISTS idx_admin_sessions_expires;
DROP INDEX IF EXISTS idx_login_failures_created;
