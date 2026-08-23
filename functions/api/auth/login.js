import { redirect, json } from '../../lib/http.js';
import { randomToken } from '../../lib/crypto.js';
import { buildAuthorizeUrl } from '../../lib/twitch.js';
import { makeOauthStateCookie } from '../../lib/session.js';
import { checkRateLimit } from '../../lib/rate-limit.js';

export async function onRequestGet({ request, env }) {
  try {
    const rate = checkRateLimit(request, 'oauth-login', { limit: 20, windowMs: 10 * 60 * 1000 });
    if (!rate.allowed) return json({ error: 'Too many Twitch login attempts. Try again shortly.' }, 429, { 'Retry-After': String(rate.retryAfter) });
    const url = new URL(request.url);
    const forceVerify = url.searchParams.get('force') === '1';
    const state = randomToken(32);
    const nonce = randomToken(32);
    const cookie = await makeOauthStateCookie(request, env, state, nonce);
    return redirect(buildAuthorizeUrl(env, state, nonce, { forceVerify }), { 'Set-Cookie': cookie });
  } catch (error) { return json({ error: error.message || 'Unable to start Twitch authorization.' }, 503); }
}
