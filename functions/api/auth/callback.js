import { redirect } from '../../lib/http.js';
import { exchangeCode, verifyIdToken, getAppToken, helixOrThrow } from '../../lib/twitch.js';
import { readOauthState, clearOauthStateCookie, makeSessionCookie } from '../../lib/session.js';
import { randomToken, timingSafeEqualText } from '../../lib/crypto.js';
import { upsertCreator } from '../../lib/db.js';
import { ensureSubscriptions } from '../../lib/eventsub.js';
import { checkRateLimit } from '../../lib/rate-limit.js';

function home(request, query = '') { const url = new URL('/', request.url); url.search = query; return url.toString(); }

export async function onRequestGet({ request, env }) {
  const rate = checkRateLimit(request, 'oauth-callback', { limit: 30, windowMs: 10 * 60 * 1000 });
  if (!rate.allowed) return redirect(home(request, '?auth=rate_limited'), { 'Set-Cookie': clearOauthStateCookie(request), 'Retry-After': String(rate.retryAfter) });
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const oauthError = url.searchParams.get('error');
  const stateCookie = await readOauthState(request, env).catch(() => null);
  const clearState = clearOauthStateCookie(request);
  if (oauthError) {
    // Never forward Twitch's free-form error_description into the browser URL.
    // Map only known, non-sensitive OAuth error codes so the UI can explain what happened.
    const known = new Set(['access_denied', 'redirect_mismatch', 'invalid_request', 'invalid_client', 'invalid_scope', 'server_error', 'temporarily_unavailable']);
    const safeError = known.has(oauthError) ? oauthError : 'oauth_error';
    return redirect(home(request, `?auth=oauth_error&reason=${encodeURIComponent(safeError)}`), { 'Set-Cookie': clearState });
  }
  const stateFresh = stateCookie?.createdAt && Date.now() - Number(stateCookie.createdAt) <= 600_000;
  if (!code || !state || !stateCookie?.state || !stateCookie?.nonce || !stateFresh || !timingSafeEqualText(state, stateCookie.state)) {
    return redirect(home(request, '?auth=state_error'), { 'Set-Cookie': clearState });
  }

  try {
    const token = await exchangeCode(env, code);
    const claims = await verifyIdToken(env, token.id_token, stateCookie.nonce);
    const appToken = await getAppToken(env);
    const userPayload = await helixOrThrow(env, appToken, 'users', { id: claims.sub });
    const user = userPayload.data?.[0];
    if (!user || user.id !== claims.sub) throw new Error('Unable to confirm Twitch identity.');

    const session = {
      sessionId: randomToken(24), csrf: randomToken(24),
      user: { id: user.id, login: user.login, displayName: user.display_name, broadcasterType: user.broadcaster_type || '', profileImageUrl: user.profile_image_url || '' },
    };
    await upsertCreator(env, { id: user.id, login: user.login, display_name: user.display_name }).catch(() => false);
    const eventsub = await ensureSubscriptions(env, user.id).catch((error) => ({ configured: false, warnings: [error.message] }));
    const sessionCookie = await makeSessionCookie(request, env, { ...session, eventsub });
    const headers = new Headers({ Location: home(request, '?auth=connected'), 'cache-control': 'no-store' });
    headers.append('Set-Cookie', clearState); headers.append('Set-Cookie', sessionCookie);
    // The OIDC user access/refresh tokens are intentionally not copied into the session or any storage.
    return new Response(null, { status: 302, headers });
  } catch (error) {
    console.error('Wayfinder OIDC callback failed:', error?.message || error);
    return redirect(home(request, '?auth=error'), { 'Set-Cookie': clearState });
  }
}
