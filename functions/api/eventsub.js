import { hmacSha256Hex, timingSafeEqualText } from '../lib/crypto.js';
import { eventAlreadySeen, saveEvent, updateSubscriptionStatus, deleteCreatorData } from '../lib/db.js';
import { deleteSubscriptionsForUser } from '../lib/eventsub.js';
import { sanitizeEvent } from '../lib/data-contract.js';

function text(body, status = 200) {
  return new Response(status === 204 ? null : body, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
}

function eventUserId(type, event, subscription) {
  if (type === 'channel.raid') return event.to_broadcaster_user_id || subscription?.condition?.to_broadcaster_user_id || null;
  return event.broadcaster_user_id || subscription?.condition?.broadcaster_user_id || null;
}

function eventTime(type, event, messageTimestamp) {
  if (type === 'stream.online') return event.started_at || messageTimestamp;
  if (type === 'channel.raid') return messageTimestamp;
  return messageTimestamp;
}

export async function onRequestPost({ request, env, waitUntil }) {
  if (!env.TWITCH_EVENTSUB_SECRET) return text('EventSub not configured.', 503);
  const messageId = request.headers.get('Twitch-Eventsub-Message-Id') || '';
  const timestamp = request.headers.get('Twitch-Eventsub-Message-Timestamp') || '';
  const signature = request.headers.get('Twitch-Eventsub-Message-Signature') || '';
  const messageType = request.headers.get('Twitch-Eventsub-Message-Type') || '';
  const rawBody = await request.text();

  const parsedTime = Date.parse(timestamp);
  if (!messageId || !timestamp || !signature || !Number.isFinite(parsedTime) || Math.abs(Date.now() - parsedTime) > 10 * 60_000) {
    return text('Invalid or stale EventSub message.', 403);
  }

  const expected = `sha256=${await hmacSha256Hex(env.TWITCH_EVENTSUB_SECRET, `${messageId}${timestamp}${rawBody}`)}`;
  if (!timingSafeEqualText(expected, signature)) return text('Invalid signature.', 403);

  let payload;
  try { payload = JSON.parse(rawBody); } catch { return text('Invalid JSON.', 400); }

  if (messageType === 'webhook_callback_verification') {
    return text(payload.challenge || '', 200);
  }

  if (messageType === 'revocation') {
    waitUntil(updateSubscriptionStatus(env, payload.subscription?.id, payload.subscription?.status || 'revoked'));
    return text('', 204);
  }

  if (messageType !== 'notification') return text('', 204);
  if (await eventAlreadySeen(env, messageId).catch(() => false)) return text('', 204);

  const type = payload.subscription?.type || request.headers.get('Twitch-Eventsub-Subscription-Type') || 'unknown';
  const event = payload.event || {};
  if (type === 'user.authorization.revoke' && event.user_id) {
    waitUntil(deleteSubscriptionsForUser(env, event.user_id));
    waitUntil(deleteCreatorData(env, event.user_id));
    return text('', 204);
  }
  const userId = eventUserId(type, event, payload.subscription);
  if (userId) {
    waitUntil(saveEvent(env, {
      messageId,
      userId,
      type,
      occurredAt: eventTime(type, event, timestamp),
      event: sanitizeEvent(type, event),
    }));
  }
  return text('', 204);
}
