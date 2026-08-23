export async function ensureDb(env) {
  const db = env.WAYFINDER_DB;
  if (!db) return false;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS connected_creators (
      user_id TEXT PRIMARY KEY,
      login TEXT NOT NULL,
      display_name TEXT,
      connected_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS eventsub_subscriptions (
      subscription_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS eventsub_events (
      message_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      subscription_type TEXT NOT NULL,
      occurred_at TEXT,
      received_at TEXT NOT NULL,
      event_json TEXT NOT NULL
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_wayfinder_events_user_time ON eventsub_events(user_id, occurred_at)'),
  ]);
  return true;
}

export async function upsertCreator(env, user) {
  if (!await ensureDb(env)) return false;
  const now = new Date().toISOString();
  await env.WAYFINDER_DB.prepare(`INSERT INTO connected_creators(user_id, login, display_name, connected_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET login=excluded.login, display_name=excluded.display_name, last_seen_at=excluded.last_seen_at`)
    .bind(user.id, user.login, user.display_name || user.login, now, now).run();
  return true;
}

export async function deleteCreatorData(env, userId) {
  if (!env.WAYFINDER_DB) return;
  await ensureDb(env);
  await env.WAYFINDER_DB.batch([
    env.WAYFINDER_DB.prepare('DELETE FROM eventsub_events WHERE user_id = ?').bind(userId),
    env.WAYFINDER_DB.prepare('DELETE FROM eventsub_subscriptions WHERE user_id = ?').bind(userId),
    env.WAYFINDER_DB.prepare('DELETE FROM connected_creators WHERE user_id = ?').bind(userId),
  ]);
}

export async function saveSubscription(env, subscription, userId) {
  if (!env.WAYFINDER_DB) return;
  await ensureDb(env);
  const now = new Date().toISOString();
  await env.WAYFINDER_DB.prepare(`INSERT INTO eventsub_subscriptions(subscription_id, user_id, type, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(subscription_id) DO UPDATE SET status=excluded.status, updated_at=excluded.updated_at`)
    .bind(subscription.id, userId, subscription.type, subscription.status, subscription.created_at || now, now).run();
}

export async function updateSubscriptionStatus(env, subscriptionId, status) {
  if (!env.WAYFINDER_DB) return;
  await ensureDb(env);
  await env.WAYFINDER_DB.prepare('UPDATE eventsub_subscriptions SET status = ?, updated_at = ? WHERE subscription_id = ?')
    .bind(status, new Date().toISOString(), subscriptionId).run();
}

export async function eventAlreadySeen(env, messageId) {
  if (!env.WAYFINDER_DB) return false;
  await ensureDb(env);
  const row = await env.WAYFINDER_DB.prepare('SELECT message_id FROM eventsub_events WHERE message_id = ?').bind(messageId).first();
  return Boolean(row);
}

export async function saveEvent(env, { messageId, userId, type, occurredAt, event }) {
  if (!env.WAYFINDER_DB) return false;
  await ensureDb(env);
  await env.WAYFINDER_DB.prepare(`INSERT OR IGNORE INTO eventsub_events(message_id, user_id, subscription_type, occurred_at, received_at, event_json)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(messageId, userId, type, occurredAt || null, new Date().toISOString(), JSON.stringify(event)).run();
  return true;
}

export async function getEvents(env, userId, days = 180) {
  if (!env.WAYFINDER_DB) return [];
  await ensureDb(env);
  const cutoff = new Date(Date.now() - Math.min(Math.max(days, 1), 365) * 86400_000).toISOString();
  const result = await env.WAYFINDER_DB.prepare(`SELECT message_id, subscription_type, occurred_at, event_json
    FROM eventsub_events WHERE user_id = ? AND (occurred_at IS NULL OR occurred_at >= ?)
    ORDER BY COALESCE(occurred_at, received_at) DESC LIMIT 1000`).bind(userId, cutoff).all();
  return (result.results || []).map((row) => ({
    messageId: row.message_id,
    type: row.subscription_type,
    occurredAt: row.occurred_at,
    event: JSON.parse(row.event_json),
  }));
}
