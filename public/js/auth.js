export async function fetchAuthSession() {
  const response = await fetch('/api/auth/session', { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Auth session failed (${response.status})`);
  return payload;
}

export function connectTwitch() {
  window.location.assign('/api/auth/login');
}

export async function disconnectTwitch(csrf) {
  const response = await fetch('/api/auth/disconnect', {
    method: 'POST',
    headers: { Accept: 'application/json', 'X-Wayfinder-CSRF': csrf || '' },
    credentials: 'same-origin',
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Disconnect failed (${response.status})`);
  return payload;
}


export async function syncEventSub(csrf) {
  const response = await fetch('/api/eventsub/sync', {
    method: 'POST',
    headers: { Accept: 'application/json', 'X-Wayfinder-CSRF': csrf || '' },
    credentials: 'same-origin',
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `EventSub sync failed (${response.status})`);
  return payload.eventsub || { configured: false, created: [], warnings: [] };
}
