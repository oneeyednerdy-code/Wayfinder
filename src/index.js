import { onRequestGet as authLogin } from '../functions/api/auth/login.js';
import { onRequestGet as authCallback } from '../functions/api/auth/callback.js';
import { onRequestGet as authSession } from '../functions/api/auth/session.js';
import { onRequestPost as authDisconnect } from '../functions/api/auth/disconnect.js';
import { onRequestGet as twitchData } from '../functions/api/twitch/data.js';
import { onRequestPost as eventsubWebhook } from '../functions/api/eventsub.js';
import { onRequestPost as eventsubSync } from '../functions/api/eventsub/sync.js';
import { onRequestGet as twitchTracker } from '../functions/api/twitchtracker.js';
import { onRequestGet as health } from '../functions/api/health.js';

function secureHeaders(response, request) {
  const headers = new Headers(response.headers);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  headers.set('Content-Security-Policy', "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self'; img-src 'self' https://static-cdn.jtvnw.net data:; connect-src 'self'; font-src 'self'");
  if (new URL(request.url).protocol === 'https:') headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function jsonNotFound() {
  return new Response(JSON.stringify({ error: 'API route not found.' }), {
    status: 404,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function methodNotAllowed(allowed) {
  return new Response(JSON.stringify({ error: 'Method not allowed.' }), {
    status: 405,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', Allow: allowed },
  });
}

async function routeApi(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();
  const base = { request, env, waitUntil: ctx.waitUntil.bind(ctx) };

  if (path === '/api/health') return method === 'GET' ? health(base) : methodNotAllowed('GET');
  if (path === '/api/auth/login') return method === 'GET' ? authLogin(base) : methodNotAllowed('GET');
  if (path === '/api/auth/callback') return method === 'GET' ? authCallback(base) : methodNotAllowed('GET');
  if (path === '/api/auth/session') return method === 'GET' ? authSession(base) : methodNotAllowed('GET');
  if (path === '/api/auth/disconnect') return method === 'POST' ? authDisconnect(base) : methodNotAllowed('POST');
  if (path === '/api/twitch/data') return method === 'GET' ? twitchData(base) : methodNotAllowed('GET');
  if (path === '/api/eventsub') return method === 'POST' ? eventsubWebhook(base) : methodNotAllowed('POST');
  if (path === '/api/eventsub/sync') return method === 'POST' ? eventsubSync(base) : methodNotAllowed('POST');
  if (path === '/api/twitchtracker') return method === 'GET' ? twitchTracker(base) : methodNotAllowed('GET');
  return jsonNotFound();
}

export default {
  async fetch(request, env, ctx) {
    let response;
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith('/api/')) {
        response = await routeApi(request, env, ctx);
      } else {
        response = await env.ASSETS.fetch(request);
      }
    } catch (error) {
      console.error('Wayfinder Worker request failed:', error?.message || error);
      response = new Response(JSON.stringify({ error: 'Wayfinder request failed.' }), {
        status: 500,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      });
    }
    return secureHeaders(response, request);
  },
};
