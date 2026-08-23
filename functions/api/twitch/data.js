import { json } from '../../lib/http.js';
import { ensureValidSession, clearSessionCookie } from '../../lib/session.js';
import { getAppToken, safeHelix, safeHelixPaged } from '../../lib/twitch.js';
import { getEvents } from '../../lib/db.js';
import { sanitizeChannel, sanitizeVideo, sanitizeClip, sanitizeSchedule, sanitizeEvent, DATA_CONTRACT_VERSION } from '../../lib/data-contract.js';

export async function onRequestGet({ request, env }) {
  try {
    const auth = await ensureValidSession(request, env);
    if (!auth.session) return json({ error: 'Connect Twitch to use enrichment.' }, 401, { 'Set-Cookie': clearSessionCookie(request) });
    const userId = auth.session.user.id;
    const appToken = await getAppToken(env);
    const now = new Date(); const startedAt = new Date(now.getTime() - 90 * 86400_000).toISOString();
    const [channelPayload, videosPayload, clipsPayload, schedulePayload, events] = await Promise.all([
      safeHelix(env, appToken, 'channels', { broadcaster_id: userId }),
      safeHelixPaged(env, appToken, 'videos', { user_id: userId, type: 'archive', first: '100' }, 5),
      safeHelixPaged(env, appToken, 'clips', { broadcaster_id: userId, started_at: startedAt, ended_at: now.toISOString(), first: '100' }, 5),
      safeHelix(env, appToken, 'schedule', { broadcaster_id: userId, first: '25' }),
      getEvents(env, userId, 180).catch(() => []),
    ]);
    const safeEvents = events.filter(e => ['channel.raid','stream.online','stream.offline','channel.update'].includes(e.type)).map(e => ({ messageId:e.messageId,type:e.type,occurredAt:e.occurredAt,event:sanitizeEvent(e.type,e.event) }));
    return json({
      fetchedAt:new Date().toISOString(), contractVersion:DATA_CONTRACT_VERSION, role:'official-context', authModel:'oidc-login-plus-app-token',
      user:auth.session.user, channel:sanitizeChannel(channelPayload.data?.[0] || null), videos:(videosPayload.data||[]).map(sanitizeVideo), clips:(clipsPayload.data||[]).map(sanitizeClip), schedule:sanitizeSchedule(schedulePayload.data||null), events:safeEvents,
      completeness:{ videos:{pages:videosPayload.pages||0,truncated:Boolean(videosPayload.truncated)}, clips:{pages:clipsPayload.pages||0,truncated:Boolean(clipsPayload.truncated)} },
      eventStorage:Boolean(env.WAYFINDER_DB), warnings:[channelPayload.error,videosPayload.error,clipsPayload.error,schedulePayload.error,videosPayload.truncated?'Video history hit the 500-record safety cap.':null,clipsPayload.truncated?'Clip history hit the 500-record safety cap.':null].filter(Boolean),
    }, 200, auth.setCookie ? { 'Set-Cookie': auth.setCookie } : {});
  } catch (error) { return json({ error:error.message || 'Twitch enrichment failed.' }, 502); }
}
