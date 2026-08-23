function pick(obj, keys) {
  const out = {};
  for (const key of keys) if (obj && obj[key] !== undefined) out[key] = obj[key];
  return out;
}
function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function sanitizeChannel(channel) {
  if (!channel) return null;
  const out = pick(channel, ['broadcaster_id','broadcaster_login','broadcaster_name','broadcaster_language','game_id','game_name','title','tags','content_classification_labels','is_branded_content']);
  return out;
}

export function sanitizeVideo(video) {
  return pick(video, ['id','stream_id','user_id','user_login','user_name','title','created_at','published_at','url','view_count','language','type','duration']);
}

export function sanitizeClip(clip) {
  return pick(clip, ['id','video_id','game_id','title','view_count','created_at','duration','vod_offset','url']);
}

export function sanitizeSchedule(schedule) {
  if (!schedule || typeof schedule !== 'object') return null;
  return {
    broadcaster_id: schedule.broadcaster_id,
    broadcaster_name: schedule.broadcaster_name,
    broadcaster_login: schedule.broadcaster_login,
    vacation: schedule.vacation ? pick(schedule.vacation, ['start_time','end_time']) : null,
    segments: Array.isArray(schedule.segments) ? schedule.segments.map((segment) => ({
      ...pick(segment, ['id','start_time','end_time','title','canceled_until','is_recurring']),
      category: segment.category ? pick(segment.category, ['id','name']) : null,
    })) : [],
  };
}

export function sanitizeEvent(type, event = {}) {
  if (type === 'channel.raid') return pick(event, ['from_broadcaster_user_id','from_broadcaster_user_login','from_broadcaster_user_name','to_broadcaster_user_id','to_broadcaster_user_login','to_broadcaster_user_name','viewers']);
  if (type === 'stream.online') return pick(event, ['id','broadcaster_user_id','broadcaster_user_login','broadcaster_user_name','type','started_at']);
  if (type === 'stream.offline') return pick(event, ['broadcaster_user_id','broadcaster_user_login','broadcaster_user_name']);
  if (type === 'channel.update') return pick(event, ['broadcaster_user_id','broadcaster_user_login','broadcaster_user_name','title','language','category_id','category_name','content_classification_labels']);
  return {};
}

const TRACKER_KEYS = ['rank','minutes_streamed','avg_viewers','max_viewers','hours_watched','followers','followers_total'];
export function sanitizeTrackerSummary(data) {
  const out = {};
  for (const key of TRACKER_KEYS) {
    const value = numberOrNull(data?.[key]);
    if (value !== null) out[key] = value;
  }
  return out;
}

export const DATA_CONTRACT_VERSION = '2026-08-23';
