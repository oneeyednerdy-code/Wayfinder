import { json } from '../../lib/http.js';
import { ensureValidSession, clearSessionCookie } from '../../lib/session.js';
export async function onRequestGet({ request, env }) {
  try {
    const result = await ensureValidSession(request, env);
    if (!result.session) return json({ connected: false }, 200, { 'Set-Cookie': clearSessionCookie(request) });
    return json({ connected: true, ...result.session }, 200, result.setCookie ? { 'Set-Cookie': result.setCookie } : {});
  } catch (error) { return json({ connected: false, error: error.message || 'Unable to validate Wayfinder session.' }, 503); }
}
