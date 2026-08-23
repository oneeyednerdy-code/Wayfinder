import { getAppToken, helixOrThrow } from './twitch.js';
import { saveSubscription } from './db.js';

const USER_SUBSCRIPTIONS = [
  { type: 'channel.raid', version: '1', condition: (id) => ({ to_broadcaster_user_id: id }) },
  { type: 'stream.online', version: '1', condition: (id) => ({ broadcaster_user_id: id }) },
  { type: 'stream.offline', version: '1', condition: (id) => ({ broadcaster_user_id: id }) },
  { type: 'channel.update', version: '2', condition: (id) => ({ broadcaster_user_id: id }) },
];

function sameCondition(a = {}, b = {}) {
  return Object.entries(b).every(([key, value]) => a?.[key] === value);
}

async function createSubscription(env, appToken, spec, condition) {
  const response = await fetch('https://api.twitch.tv/helix/eventsub/subscriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${appToken}`,
      'Client-Id': env.TWITCH_CLIENT_ID,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      type: spec.type,
      version: spec.version,
      condition,
      transport: {
        method: 'webhook',
        callback: env.TWITCH_EVENTSUB_CALLBACK,
        secret: env.TWITCH_EVENTSUB_SECRET,
      },
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || `HTTP ${response.status}`);
  return payload.data?.[0] || null;
}

export async function ensureSubscriptions(env, userId) {
  if (!env.WAYFINDER_DB) return { configured: false, created: [], warnings: ['WAYFINDER_DB is not bound, so EventSub history is disabled.'] };
  if (!env.TWITCH_EVENTSUB_CALLBACK || !env.TWITCH_EVENTSUB_SECRET) return { configured: false, created: [], warnings: ['EventSub is not configured.'] };
  if (env.TWITCH_EVENTSUB_SECRET.length < 10 || env.TWITCH_EVENTSUB_SECRET.length > 100) return { configured: false, created: [], warnings: ['TWITCH_EVENTSUB_SECRET must be 10–100 ASCII characters.'] };

  const appToken = await getAppToken(env);
  const existingPayload = await listSubscriptions(env, appToken, { user_id: userId });
  const existing = existingPayload;
  const created = [];
  const warnings = [];

  for (const spec of USER_SUBSCRIPTIONS) {
    const condition = spec.condition(userId);
    const already = existing.find((item) => item.type === spec.type && sameCondition(item.condition, condition) && !String(item.status).includes('revoked'));
    if (already) {
      created.push({ type: spec.type, status: already.status, id: already.id, reused: true });
      await saveSubscription(env, already, userId);
      continue;
    }
    try {
      const subscription = await createSubscription(env, appToken, spec, condition);
      if (subscription) {
        created.push({ type: spec.type, status: subscription.status, id: subscription.id, reused: false });
        await saveSubscription(env, subscription, userId);
      }
    } catch (error) {
      warnings.push(`${spec.type}: ${error.message}`);
    }
  }

  // One app-wide revoke subscription lets Wayfinder delete stored creator data even
  // when the creator revokes authorization from Twitch rather than our UI.
  const revokeSpec = { type: 'user.authorization.revoke', version: '1' };
  const revokeCondition = { client_id: env.TWITCH_CLIENT_ID };
  const revokeExisting = await listSubscriptions(env, appToken, { type: revokeSpec.type });
  const existingRevoke = revokeExisting.find((item) => item.type === revokeSpec.type && sameCondition(item.condition, revokeCondition) && !String(item.status).includes('revoked'));
  if (!existingRevoke) {
    try {
      const subscription = await createSubscription(env, appToken, revokeSpec, revokeCondition);
      if (subscription) await saveSubscription(env, subscription, '__app__');
    } catch (error) {
      warnings.push(`user.authorization.revoke: ${error.message}`);
    }
  }

  return { configured: true, created, warnings };
}

async function listSubscriptions(env, appToken, filter = {}) {
  const items = [];
  let after = null;
  let pages = 0;
  do {
    const payload = await helixOrThrow(env, appToken, 'eventsub/subscriptions', {
      ...filter,
      ...(after ? { after } : {}),
    });
    items.push(...(payload.data || []));
    after = payload.pagination?.cursor || null;
    pages += 1;
  } while (after && pages < 25);
  return items;
}

export async function deleteSubscriptionsForUser(env, userId) {
  if (!env.TWITCH_CLIENT_ID || !env.TWITCH_CLIENT_SECRET) return;
  try {
    const appToken = await getAppToken(env);
    const matches = await listSubscriptions(env, appToken, { user_id: userId });
    await Promise.all(matches.map((item) => fetch(`https://api.twitch.tv/helix/eventsub/subscriptions?id=${encodeURIComponent(item.id)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${appToken}`, 'Client-Id': env.TWITCH_CLIENT_ID },
    }).catch(() => null)));
  } catch {
    // Cleanup is best effort; local creator data is deleted separately.
  }
}
