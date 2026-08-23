import { openJson, sealJson, randomToken } from './crypto.js';
import { cookieName, parseCookies, serializeCookie, clearCookie, secureCookieForRequest } from './http.js';

const SESSION_BASE = 'wayfinder_session';
const STATE_BASE = 'wayfinder_oauth_state';
const SESSION_MAX_AGE = 60 * 60 * 8;
const STATE_MAX_AGE = 600;

function secret(env) {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) throw new Error('SESSION_SECRET must be configured with at least 32 random characters.');
  return env.SESSION_SECRET;
}

export async function makeOauthStateCookie(request, env, state, nonce) {
  const secure = secureCookieForRequest(request);
  const value = await sealJson({ state, nonce, createdAt: Date.now() }, secret(env));
  return serializeCookie(cookieName(request, STATE_BASE), value, { maxAge: STATE_MAX_AGE, secure });
}
export async function readOauthState(request, env) { return openJson(parseCookies(request)[cookieName(request, STATE_BASE)], secret(env)); }
export function clearOauthStateCookie(request) { return clearCookie(cookieName(request, STATE_BASE), secureCookieForRequest(request)); }

export async function makeSessionCookie(request, env, session) {
  const secure = secureCookieForRequest(request);
  const now = Date.now();
  const payload = {
    sessionId: session.sessionId || randomToken(24),
    user: session.user,
    csrf: session.csrf || randomToken(24),
    authMethod: 'twitch-oidc',
    issuedAt: session.issuedAt || now,
    absoluteExpiresAt: session.absoluteExpiresAt || now + SESSION_MAX_AGE * 1000,
    eventsub: session.eventsub || null,
  };
  const value = await sealJson(payload, secret(env));
  if (value.length > 3800) throw new Error('Encrypted session is too large for a secure cookie.');
  return serializeCookie(cookieName(request, SESSION_BASE), value, { maxAge: SESSION_MAX_AGE, secure });
}
export async function readSession(request, env) { return openJson(parseCookies(request)[cookieName(request, SESSION_BASE)], secret(env)); }
export function clearSessionCookie(request) { return clearCookie(cookieName(request, SESSION_BASE), secureCookieForRequest(request)); }

export async function ensureValidSession(request, env) {
  const session = await readSession(request, env);
  const now = Date.now();
  if (!session?.user?.id || !session?.csrf || session.authMethod !== 'twitch-oidc') return { session: null, setCookie: null, reason: 'missing' };
  if (!Number.isFinite(Number(session.absoluteExpiresAt)) || Number(session.absoluteExpiresAt) <= now) return { session: null, setCookie: null, reason: 'expired' };
  if (!Number.isFinite(Number(session.issuedAt)) || Number(session.issuedAt) > now + 120_000) return { session: null, setCookie: null, reason: 'invalid_time' };
  if (now - Number(session.issuedAt) >= 60 * 60 * 1000) {
    const rotated = { ...session, sessionId: randomToken(24), issuedAt: now };
    return { session: rotated, setCookie: await makeSessionCookie(request, env, rotated), reason: 'rotated' };
  }
  return { session, setCookie: null, reason: 'valid' };
}
