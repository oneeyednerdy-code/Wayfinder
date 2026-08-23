import { json } from '../lib/http.js';
import { ensureValidSession, clearSessionCookie } from '../lib/session.js';
import { sanitizeTrackerSummary, DATA_CONTRACT_VERSION } from '../lib/data-contract.js';

export async function onRequestGet({ request, env }) {
  const auth = await ensureValidSession(request, env).catch(() => ({ session: null }));
  if (!auth.session) return json({ error: 'Connect Twitch before requesting TwitchTracker context.' }, 401, { 'Set-Cookie': clearSessionCookie(request) });
  const login = auth.session.user.login;

  try {
    const response = await fetch(`https://twitchtracker.com/api/channels/summary/${encodeURIComponent(login)}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'Nerdspace-Labs-Wayfinder/0.6' },
    });
    if (!response.ok) return json({ error: `TwitchTracker returned ${response.status}. Wayfinder analysis remains available.` }, 502, auth.setCookie ? { 'Set-Cookie': auth.setCookie } : {});
    const raw = await response.json();
    const summary = sanitizeTrackerSummary(raw);
    if (!Object.keys(summary).length) return json({ error: 'TwitchTracker returned no supported summary fields. Wayfinder ignored the response.' }, 502, auth.setCookie ? { 'Set-Cookie': auth.setCookie } : {});
    return json({
      fetchedAt: new Date().toISOString(),
      source: 'TwitchTracker channel summary (30 days)',
      role: 'supplemental-corroboration-only',
      contractVersion: DATA_CONTRACT_VERSION,
      summary,
    }, 200, auth.setCookie ? { 'Set-Cookie': auth.setCookie } : {});
  } catch {
    return json({ error: 'TwitchTracker is temporarily unavailable. Wayfinder analysis remains available.' }, 502, auth.setCookie ? { 'Set-Cookie': auth.setCookie } : {});
  }
}
