import test from 'node:test';
import assert from 'node:assert/strict';
import { sealJson, openJson, timingSafeEqualText } from '../functions/lib/crypto.js';
import { cookieName, serializeCookie, requireSameOrigin } from '../functions/lib/http.js';
import { renderStreams } from '../public/js/ui.js';

test('production session cookie uses Host prefix and secure browser protections', () => {
  const request = new Request('https://wayfinder.example.com/api/auth/session');
  assert.equal(cookieName(request, 'wayfinder_session'), '__Host-wayfinder_session');
  const cookie = serializeCookie('__Host-wayfinder_session', 'sealed', { maxAge: 60, secure: true });
  assert.match(cookie, /Path=\//);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
});

test('same-origin protection rejects a cross-origin browser mutation', () => {
  const crossOrigin = new Request('https://wayfinder.example.com/api/auth/disconnect', {
    method: 'POST',
    headers: { Origin: 'https://evil.example' },
  });
  const sameOrigin = new Request('https://wayfinder.example.com/api/auth/disconnect', {
    method: 'POST',
    headers: { Origin: 'https://wayfinder.example.com' },
  });
  assert.equal(requireSameOrigin(crossOrigin), false);
  assert.equal(requireSameOrigin(sameOrigin), true);
});

test('encrypted session payload rejects tampering', async () => {
  const secret = '0123456789abcdef0123456789abcdef';
  const sealed = await sealJson({ accessToken: 'secret-token', csrf: 'csrf-token' }, secret);
  const opened = await openJson(sealed, secret);
  assert.equal(opened.accessToken, 'secret-token');
  const last = sealed.at(-1);
  const tampered = `${sealed.slice(0, -1)}${last === 'A' ? 'B' : 'A'}`;
  assert.equal(await openJson(tampered, secret), null);
});

test('constant-work text comparison accepts exact signatures only', () => {
  assert.equal(timingSafeEqualText('sha256=abc123', 'sha256=abc123'), true);
  assert.equal(timingSafeEqualText('sha256=abc123', 'sha256=abc124'), false);
  assert.equal(timingSafeEqualText('short', 'longer'), false);
});


test('uploaded CSV text is escaped before HTML rendering', () => {
  const html = renderStreams([{
    id: 'row-safe',
    sourceIndex: 1,
    date: new Date('2026-08-22T12:00:00Z'),
    dateHasTime: true,
    title: '<img src=x onerror=alert(1)>',
    category: '<script>alert(1)</script>',
    avgViewers: 12,
    peakViewers: 20,
    followersGained: 2,
    durationMinutes: 240,
    confirmedExternal: false,
    externalReasons: [],
    context: {},
    raidEvents: [],
  }]);
  assert.doesNotMatch(html, /<script>/i);
  assert.doesNotMatch(html, /<img\s/i);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

import { buildAuthorizeUrl, TWITCH_LOGIN_SCOPES, verifyIdToken } from '../functions/lib/twitch.js';
import { makeSessionCookie } from '../functions/lib/session.js';

function b64url(bytes) {
  return Buffer.from(bytes).toString('base64url');
}

async function makeSignedIdToken({ privateKey, kid, claims }) {
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid }));
  const payload = b64url(JSON.stringify(claims));
  const data = new TextEncoder().encode(`${header}.${payload}`);
  const signature = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, data));
  return `${header}.${payload}.${b64url(signature)}`;
}

test('Twitch OIDC login hardcodes the openid-only scope and includes state plus nonce', () => {
  assert.deepEqual(TWITCH_LOGIN_SCOPES, ['openid']);
  const url = new URL(buildAuthorizeUrl({
    TWITCH_CLIENT_ID: 'client123',
    TWITCH_CLIENT_SECRET: 'secret123',
    TWITCH_REDIRECT_URI: 'https://wayfinder.example.com/api/auth/callback',
    TWITCH_SCOPES: 'user:read:email channel:manage:polls',
  }, 'state123', 'nonce123'));
  assert.equal(url.searchParams.get('scope'), 'openid');
  assert.equal(url.searchParams.get('state'), 'state123');
  assert.equal(url.searchParams.get('nonce'), 'nonce123');
  assert.equal(url.searchParams.get('response_type'), 'code');
});

test('OIDC ID-token verification checks Twitch signature, issuer, audience, expiry, and nonce', async () => {
  const keys = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1,0,1]), hash: 'SHA-256' }, true, ['sign','verify']);
  const publicJwk = await crypto.subtle.exportKey('jwk', keys.publicKey);
  publicJwk.kid = 'test-key';
  publicJwk.alg = 'RS256';
  publicJwk.use = 'sig';
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url) === 'https://id.twitch.tv/oauth2/keys') return new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200, headers: { 'content-type': 'application/json' } });
    throw new Error(`Unexpected fetch: ${url}`);
  };
  try {
    const now = Math.floor(Date.now()/1000);
    const token = await makeSignedIdToken({ privateKey: keys.privateKey, kid: 'test-key', claims: {
      iss: 'https://id.twitch.tv/oauth2', aud: 'client123', azp: 'client123', sub: '4242', nonce: 'nonce-ok', iat: now, exp: now + 600,
    }});
    const claims = await verifyIdToken({ TWITCH_CLIENT_ID: 'client123', TWITCH_CLIENT_SECRET: 'secret123' }, token, 'nonce-ok');
    assert.equal(claims.sub, '4242');
    await assert.rejects(() => verifyIdToken({ TWITCH_CLIENT_ID: 'client123', TWITCH_CLIENT_SECRET: 'secret123' }, token, 'wrong-nonce'), /nonce/i);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('Wayfinder session cookie contains identity but no Twitch user access or refresh token', async () => {
  const request = new Request('https://wayfinder.example.com/api/auth/callback');
  const env = { SESSION_SECRET: '0123456789abcdef0123456789abcdef' };
  const cookie = await makeSessionCookie(request, env, { user: { id: '42', login: 'creator', displayName: 'Creator' }, csrf: 'csrf123' });
  const encoded = cookie.split(';')[0].split('=').slice(1).join('=');
  const payload = await openJson(encoded, env.SESSION_SECRET);
  assert.equal(payload.user.id, '42');
  assert.equal(payload.authMethod, 'twitch-oidc');
  assert.equal('accessToken' in payload, false);
  assert.equal('refreshToken' in payload, false);
  assert.ok(payload.absoluteExpiresAt - payload.issuedAt <= 8 * 60 * 60 * 1000 + 1000);
});
