CREATE TABLE IF NOT EXISTS connected_creators (
  user_id TEXT PRIMARY KEY,
  login TEXT NOT NULL,
  display_name TEXT,
  connected_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS eventsub_subscriptions (
  subscription_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS eventsub_events (
  message_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  subscription_type TEXT NOT NULL,
  occurred_at TEXT,
  received_at TEXT NOT NULL,
  event_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wayfinder_events_user_time ON eventsub_events(user_id, occurred_at);
