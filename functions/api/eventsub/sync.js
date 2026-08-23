import { json, requireSameOrigin } from '../../lib/http.js';
import { ensureValidSession, clearSessionCookie, makeSessionCookie } from '../../lib/session.js';
import { timingSafeEqualText } from '../../lib/crypto.js';
import { ensureSubscriptions } from '../../lib/eventsub.js';

export async function onRequestPost({ request, env }) {
  if (!requireSameOrigin(request)) return json({ error: 'Cross-origin request rejected.' }, 403);

  const auth = await ensureValidSession(request, env).catch(() => ({ session: null }));
  if (!auth.session) {
    return json({ error: 'Connect Twitch to configure EventSub.' }, 401, { 'Set-Cookie': clearSessionCookie(request) });
  }

  const csrf = request.headers.get('X-Wayfinder-CSRF') || '';
  if (!auth.session.csrf || !timingSafeEqualText(auth.session.csrf, csrf)) {
    return json({ error: 'CSRF validation failed.' }, 403);
  }

  try {
    const eventsub = await ensureSubscriptions(env, auth.session.user.id);
    const sessionCookie = await makeSessionCookie(request, env, { ...auth.session, eventsub });
    return json({ eventsub }, 200, { 'Set-Cookie': sessionCookie });
  } catch (error) {
    return json({ error: error.message || 'Unable to configure EventSub.' }, 502, auth.setCookie ? { 'Set-Cookie': auth.setCookie } : {});
  }
}
