import { json } from '../lib/http.js';

export async function onRequestGet({ env }) {
  let d1 = { configured: false, reachable: false };
  if (env.WAYFINDER_DB) {
    d1.configured = true;
    try {
      const result = await env.WAYFINDER_DB.prepare('SELECT 1 AS ok').first();
      d1.reachable = Number(result?.ok) === 1;
    } catch {
      d1.reachable = false;
    }
  }

  return json({
    ok: true,
    app: 'Nerdspace Labs Wayfinder',
    version: '0.4.3',
    runtime: 'cloudflare-pages-functions',
    d1
  });
}
