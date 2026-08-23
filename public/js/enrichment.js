function twitchDurationMinutes(value) {
  const raw = String(value || '').toLowerCase();
  const hours = Number((raw.match(/(\d+)h/) || [])[1] || 0);
  const minutes = Number((raw.match(/(\d+)m/) || [])[1] || 0);
  const seconds = Number((raw.match(/(\d+)s/) || [])[1] || 0);
  return hours * 60 + minutes + seconds / 60;
}

function sameLocalDate(a, b) {
  return a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export async function fetchTwitchData() {
  const response = await fetch('/api/twitch/data', { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Twitch enrichment failed (${response.status})`);
  return payload;
}

export async function fetchTrackerEnrichment() {
  const response = await fetch('/api/twitchtracker', { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `TwitchTracker enrichment failed (${response.status})`);
  return payload;
}

function matchingOnlineEvent(row, events) {
  if (!row.date) return null;
  const online = events.filter((entry) => entry.type === 'stream.online' && entry.event?.id && entry.event?.started_at)
    .map((entry) => ({ ...entry, started: new Date(entry.event.started_at) }))
    .filter((entry) => !Number.isNaN(entry.started.getTime()));
  if (!online.length) return null;
  if (!row.dateHasTime) {
    const sameDay = online.filter((entry) => sameLocalDate(row.date, entry.started));
    return sameDay.length === 1 ? sameDay[0] : null;
  }
  const candidates = online.map((entry) => ({ entry, diff: Math.abs(row.date - entry.started) / 36e5 })).filter((x) => x.diff <= 2).sort((a,b) => a.diff-b.diff);
  return candidates[0]?.entry || null;
}

export function attachObservedEventContext(rows, events = []) {
  return rows.map((row) => {
    if (!row.date) return row;
    const start = row.date.getTime();
    const end = start + ((Number.isFinite(row.durationMinutes) && row.durationMinutes > 0 ? row.durationMinutes : 24 * 60) + 30) * 60_000;
    const updates = events.filter((entry) => {
      if (entry.type !== 'channel.update' || !entry.occurredAt) return false;
      const at = new Date(entry.occurredAt).getTime();
      if (!Number.isFinite(at)) return false;
      if (!row.dateHasTime) return sameLocalDate(row.date, new Date(at));
      return at >= start - 10 * 60_000 && at <= end;
    });
    const categories = [...new Set(updates.map((e) => String(e.event?.category_name || '').trim()).filter(Boolean))];
    return {
      ...row,
      twitchObserved: {
        ...(row.twitchObserved || {}),
        channelUpdates: updates.length,
        categories,
        categoryEvidence: categories.length ? 'Twitch EventSub channel.update — observed during the matched window, not assumed for the whole broadcast' : null,
      },
    };
  });
}

export function matchRowsToVods(rows, videos = [], clips = [], events = []) {
  const normalizedVideos = videos.map((video) => ({
    ...video,
    createdDate: new Date(video.created_at),
    durationMinutes: twitchDurationMinutes(video.duration),
  }));

  return rows.map((row) => {
    if (!row.date) return row;
    let best = null;
    const online = matchingOnlineEvent(row, events);
    if (online) {
      const exact = normalizedVideos.find((video) => video.stream_id && video.stream_id === online.event.id);
      if (exact) best = { score: 100, video: exact, method: 'eventsub-stream-id' };
    }

    if (!best) {
      for (const video of normalizedVideos) {
        if (Number.isNaN(video.createdDate.getTime())) continue;
        let score = 0;
        const dateDiffHours = Math.abs(row.date - video.createdDate) / 36e5;
        if (!row.dateHasTime && sameLocalDate(row.date, video.createdDate)) score += 55;
        else if (dateDiffHours <= 0.5) score += 55;
        else if (dateDiffHours <= 2) score += 45;
        else if (dateDiffHours <= 8) score += 25;
        else if (sameLocalDate(row.date, video.createdDate)) score += 18;

        if (Number.isFinite(row.durationMinutes) && Number.isFinite(video.durationMinutes)) {
          const diff = Math.abs(row.durationMinutes - video.durationMinutes);
          if (diff <= 5) score += 35;
          else if (diff <= 15) score += 25;
          else if (diff <= 30) score += 12;
        }
        if (row.title && video.title) {
          const a = row.title.toLowerCase();
          const b = video.title.toLowerCase();
          if (a === b) score += 10;
          else if (a.includes(b.slice(0, 20)) || b.includes(a.slice(0, 20))) score += 5;
        }
        if (!best || score > best.score) best = { score, video, method: 'date-duration-title' };
      }
    }

    if (!best || best.score < 55) return row;
    const matchingClips = clips.filter((clip) => clip.video_id && clip.video_id === best.video.id);
    const clipGameIds = [...new Set(matchingClips.map((clip) => clip.game_id).filter(Boolean))];
    return {
      ...row,
      twitch: {
        matchConfidence: Math.min(100, best.score),
        matchMethod: best.method,
        vodId: best.video.id,
        streamId: best.video.stream_id || null,
        vodTitle: best.video.title,
        vodUrl: best.video.url,
        vodViews: best.video.view_count,
        vodDuration: best.video.duration,
        vodCreatedAt: best.video.created_at,
        clips: matchingClips.length,
        clipViews: matchingClips.reduce((total, clip) => total + (Number(clip.view_count) || 0), 0),
        clipGameIds,
        provenance: ['Twitch Helix Get Videos', ...(matchingClips.length ? ['Twitch Helix Get Clips'] : []), ...(best.method === 'eventsub-stream-id' ? ['Twitch EventSub stream.online'] : [])],
        categoryWarning: clipGameIds.length ? 'Clip game IDs are moment-level context only and are not used as the broadcast category.' : null,
      },
    };
  });
}
