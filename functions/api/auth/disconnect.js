import { json, requireSameOrigin } from '../../lib/http.js';
import { readSession, clearSessionCookie } from '../../lib/session.js';
import { deleteCreatorData } from '../../lib/db.js';
import { deleteSubscriptionsForUser } from '../../lib/eventsub.js';
import { timingSafeEqualText } from '../../lib/crypto.js';
export async function onRequestPost({ request, env, waitUntil }) {
  if (!requireSameOrigin(request)) return json({ error: 'Cross-origin request rejected.' }, 403);
  const session = await readSession(request, env).catch(() => null);
  const csrf = request.headers.get('X-Wayfinder-CSRF') || '';
  if (!session?.csrf || !timingSafeEqualText(session.csrf, csrf)) return json({ error: 'CSRF validation failed.' }, 403);
  if (session?.user?.id) { waitUntil(deleteSubscriptionsForUser(env, session.user.id)); waitUntil(deleteCreatorData(env, session.user.id)); }
  return json({ disconnected: true }, 200, { 'Set-Cookie': clearSessionCookie(request) });
}
