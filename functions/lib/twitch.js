import { timingSafeEqualText } from './crypto.js';
let cachedAppToken = null;
let appTokenExpiresAt = 0;
let cachedJwks = null;
let jwksExpiresAt = 0;

const OIDC_ISSUER = 'https://id.twitch.tv/oauth2';
const OIDC_JWKS = 'https://id.twitch.tv/oauth2/keys';
export const TWITCH_LOGIN_SCOPES = Object.freeze(['openid']);

async function readJson(response) {
  return response.json().catch(() => ({}));
}

function requireOAuthConfig(env) {
  if (!env.TWITCH_CLIENT_ID || !env.TWITCH_CLIENT_SECRET) throw new Error('Twitch OAuth is not configured.');
}

export function buildAuthorizeUrl(env, state, nonce) {
  requireOAuthConfig(env);
  if (!env.TWITCH_REDIRECT_URI) throw new Error('TWITCH_REDIRECT_URI is required.');
  if (!state || !nonce) throw new Error('OIDC state and nonce are required.');
  const url = new URL('https://id.twitch.tv/oauth2/authorize');
  url.searchParams.set('client_id', env.TWITCH_CLIENT_ID);
  url.searchParams.set('redirect_uri', env.TWITCH_REDIRECT_URI);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', TWITCH_LOGIN_SCOPES.join(' '));
  url.searchParams.set('state', state);
  url.searchParams.set('nonce', nonce);
  return url.toString();
}

export async function exchangeCode(env, code) {
  requireOAuthConfig(env);
  const body = new URLSearchParams({
    client_id: env.TWITCH_CLIENT_ID,
    client_secret: env.TWITCH_CLIENT_SECRET,
    code,
    grant_type: 'authorization_code',
    redirect_uri: env.TWITCH_REDIRECT_URI,
  });
  const response = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body,
  });
  const payload = await readJson(response);
  if (!response.ok || !payload.access_token || !payload.id_token) throw new Error(payload.message || 'Unable to complete Twitch OIDC authorization.');
  return payload;
}

function decodeBase64UrlJson(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function getJwks(force = false) {
  if (!force && cachedJwks && Date.now() < jwksExpiresAt) return cachedJwks;
  const response = await fetch(OIDC_JWKS, { headers: { Accept: 'application/json' } });
  const payload = await readJson(response);
  if (!response.ok || !Array.isArray(payload.keys)) throw new Error('Unable to load Twitch OIDC signing keys.');
  cachedJwks = payload.keys;
  jwksExpiresAt = Date.now() + 60 * 60 * 1000;
  return cachedJwks;
}

export async function verifyIdToken(env, idToken, expectedNonce) {
  requireOAuthConfig(env);
  const parts = String(idToken || '').split('.');
  if (parts.length !== 3) throw new Error('Invalid Twitch ID token format.');
  const header = decodeBase64UrlJson(parts[0]);
  const claims = decodeBase64UrlJson(parts[1]);
  if (header.alg !== 'RS256' || !header.kid) throw new Error('Unsupported Twitch ID token signature.');
  let jwks = await getJwks();
  let jwk = jwks.find(key => key.kid === header.kid && key.kty === 'RSA');
  if (!jwk) {
    jwks = await getJwks(true);
    jwk = jwks.find(key => key.kid === header.kid && key.kty === 'RSA');
  }
  if (!jwk) throw new Error('Twitch signing key was not found.');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const sigText = parts[2].replace(/-/g, '+').replace(/_/g, '/');
  const sigPadded = sigText + '='.repeat((4 - sigText.length % 4) % 4);
  const signature = Uint8Array.from(atob(sigPadded), c => c.charCodeAt(0));
  if (!await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, data)) throw new Error('Twitch ID token signature validation failed.');

  const now = Math.floor(Date.now() / 1000);
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.iss !== OIDC_ISSUER) throw new Error('Twitch ID token issuer mismatch.');
  if (!audience.includes(env.TWITCH_CLIENT_ID)) throw new Error('Twitch ID token audience mismatch.');
  if (claims.azp && claims.azp !== env.TWITCH_CLIENT_ID) throw new Error('Twitch ID token authorized-party mismatch.');
  if (!claims.sub) throw new Error('Twitch ID token is missing a subject.');
  if (!Number.isFinite(Number(claims.exp)) || Number(claims.exp) <= now - 60) throw new Error('Twitch ID token is expired.');
  if (Number(claims.iat || 0) > now + 120) throw new Error('Twitch ID token issue time is invalid.');
  if (!expectedNonce || !timingSafeEqualText(claims.nonce || '', expectedNonce)) throw new Error('Twitch OIDC nonce validation failed.');
  return claims;
}

export async function getAppToken(env) {
  requireOAuthConfig(env);
  if (cachedAppToken && Date.now() < appTokenExpiresAt - 60_000) return cachedAppToken;
  const body = new URLSearchParams({ client_id: env.TWITCH_CLIENT_ID, client_secret: env.TWITCH_CLIENT_SECRET, grant_type: 'client_credentials' });
  const response = await fetch('https://id.twitch.tv/oauth2/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
  const payload = await readJson(response);
  if (!response.ok || !payload.access_token) throw new Error(payload.message || 'Unable to get Twitch app access token.');
  cachedAppToken = payload.access_token;
  appTokenExpiresAt = Date.now() + (Number(payload.expires_in) || 3600) * 1000;
  return cachedAppToken;
}

export async function helix(env, token, path, params = {}) {
  const url = new URL(`https://api.twitch.tv/helix/${path}`);
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null && value !== '') url.searchParams.append(key, value);
  const response = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}`, 'Client-Id': env.TWITCH_CLIENT_ID, Accept: 'application/json' } });
  return { ok: response.ok, status: response.status, payload: await readJson(response) };
}

export async function helixOrThrow(env, token, path, params = {}) {
  const result = await helix(env, token, path, params);
  if (!result.ok) throw new Error(result.payload.message || `Twitch ${path} request failed (${result.status}).`);
  return result.payload;
}

export async function safeHelix(env, token, path, params = {}) {
  try { return await helixOrThrow(env, token, path, params); } catch (error) { return { data: [], error: error.message }; }
}

export async function safeHelixPaged(env, token, path, params = {}, maxPages = 5) {
  const data = []; let after = null; let pages = 0;
  try {
    do {
      const payload = await helixOrThrow(env, token, path, { ...params, ...(after ? { after } : {}) });
      data.push(...(payload.data || [])); after = payload.pagination?.cursor || null; pages += 1;
    } while (after && pages < maxPages);
    return { data, pages, truncated: Boolean(after), error: null };
  } catch (error) { return { data, pages, truncated: Boolean(after), error: error.message }; }
}
