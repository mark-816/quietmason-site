-- quietmason data schema — reuses the table names/shape of our existing tracker stack
-- (events / bot_visits / chat_logs) so the same dashboard queries work, in its own database.
-- Apply with:  npx wrangler d1 create qm-leads && npx wrangler d1 execute qm-leads --file=schema.sql

CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  site        TEXT NOT NULL DEFAULT 'quietmason',
  page        TEXT,
  event       TEXT,
  ip          TEXT,
  country     TEXT,
  device      TEXT,
  browser     TEXT,
  source      TEXT,
  ref         TEXT,
  dur         INTEGER DEFAULT 0,
  created_at  TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);
CREATE INDEX IF NOT EXISTS idx_events_site ON events(site, created_at);

CREATE TABLE IF NOT EXISTS bot_visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site TEXT, page TEXT, bot TEXT, ip TEXT, ua TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chat_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip TEXT, msg TEXT, reply TEXT, layer TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- hourly PV / UV, Beijing time (same convention as the existing dashboard)
-- SELECT date(created_at, '+8 hours') d, COUNT(*) pv, COUNT(DISTINCT ip) uv
--   FROM events WHERE site = 'quietmason' GROUP BY d ORDER BY d DESC LIMIT 14;

-- enquiries (from /api/contact, when QM_LEADS is KV this table is optional)
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT, topic TEXT, message TEXT, source TEXT, country TEXT, created_at TEXT DEFAULT (datetime('now'))
);
