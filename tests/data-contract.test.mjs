import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeTrackerSummary, sanitizeVideo, sanitizeClip, sanitizeEvent } from '../functions/lib/data-contract.js';
import { buildCrossSourceCheck } from '../public/js/supported-data.js';
import { matchRowsToVods } from '../public/js/enrichment.js';

test('TwitchTracker sanitizer keeps only supported 30-day summary fields', () => {
  const input = {
    rank: 100, minutes_streamed: 1200, avg_viewers: 12, max_viewers: 44,
    hours_watched: 240, followers: 15, followers_total: 900,
    revenue: 9999, mystery_score: 88, nested: { secret: 'x' },
  };
  assert.deepEqual(sanitizeTrackerSummary(input), {
    rank: 100, minutes_streamed: 1200, avg_viewers: 12, max_viewers: 44,
    hours_watched: 240, followers: 15, followers_total: 900,
  });
});

test('official Twitch sanitizers discard unneeded response fields', () => {
  const video = sanitizeVideo({ id:'1', stream_id:'s1', title:'x', created_at:'2026-08-01T12:00:00Z', duration:'4h', thumbnail_url:'private-ish-extra', muted_segments:[1] });
  assert.equal(video.id, '1');
  assert.equal(Object.hasOwn(video, 'thumbnail_url'), false);
  assert.equal(Object.hasOwn(video, 'muted_segments'), false);
  const clip = sanitizeClip({ id:'c', video_id:'1', game_id:'g', creator_name:'viewer', view_count:5 });
  assert.equal(Object.hasOwn(clip, 'creator_name'), false);
  assert.equal(clip.game_id, 'g');
  const event = sanitizeEvent('channel.update', { category_name:'SWTOR', category_id:'g', title:'x', irrelevant:'drop' });
  assert.equal(event.category_name, 'SWTOR');
  assert.equal(Object.hasOwn(event, 'irrelevant'), false);
});

test('EventSub stream id produces an exact VOD match', () => {
  const rows = [{ id:'r', date:new Date('2026-08-01T12:00:00Z'), dateHasTime:true, durationMinutes:240, title:'Test', avgViewers:12 }];
  const videos = [{ id:'v', stream_id:'stream-1', created_at:'2026-08-01T12:02:00Z', duration:'4h', title:'Test', url:'x', view_count:10 }];
  const events = [{ type:'stream.online', occurredAt:'2026-08-01T12:00:00Z', event:{ id:'stream-1', started_at:'2026-08-01T12:00:00Z' } }];
  const matched = matchRowsToVods(rows, videos, [], events);
  assert.equal(matched[0].twitch.matchMethod, 'eventsub-stream-id');
  assert.equal(matched[0].twitch.matchConfidence, 100);
});

test('TwitchTracker only corroborates when daily CSV covers the matching 30-day window', () => {
  const fetchedAt = '2026-08-23T12:00:00Z';
  const rows = [];
  for (let i = 0; i < 30; i += 1) {
    const d = new Date(Date.parse(fetchedAt) - i * 86400_000);
    rows.push({ date:d, dataGranularity:'daily', durationMinutes: i % 2 ? 240 : 0, avgViewers:12, peakViewers:20, minutesWatched:i%2 ? 2880 : 0, followersGained:i%2 ? 2 : 0, twitch:null });
  }
  const tracker = { fetchedAt, summary:{ minutes_streamed:3600, avg_viewers:12, max_viewers:20, hours_watched:720, followers:30 } };
  const result = buildCrossSourceCheck(rows, tracker, null).find((x) => x.source.startsWith('TwitchTracker'));
  assert.equal(result.status, 'corroborates');
  assert.ok(result.metrics.length >= 4);
});

test('partial CSV window cannot be treated as TwitchTracker corroboration', () => {
  const rows = [{ date:new Date('2026-08-22T00:00:00Z'), dataGranularity:'daily', durationMinutes:240, avgViewers:12 }];
  const tracker = { fetchedAt:'2026-08-23T12:00:00Z', summary:{ avg_viewers:12 } };
  const result = buildCrossSourceCheck(rows, tracker, null).find((x) => x.source.startsWith('TwitchTracker'));
  assert.equal(result.status, 'context only');
});
