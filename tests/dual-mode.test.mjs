import test from 'node:test';
import assert from 'node:assert/strict';
import { buildThirtyDayAnalysis } from '../public/js/thirty-day.js';
import fs from 'node:fs';

test('Last 30 Days uses TwitchTracker aggregate metrics and Twitch first-party context without inventing per-stream averages', () => {
  const now = new Date('2026-08-23T18:00:00-05:00');
  const analysis = buildThirtyDayAnalysis({
    videos:[{created_at:'2026-08-20T17:00:00Z',duration:'4h0m'}],
    clips:[{created_at:'2026-08-20T18:00:00Z',view_count:25}],
    events:[{type:'channel.raid',occurredAt:'2026-08-20T18:30:00Z',event:{viewers:200}}],
    eventStorage:true, channel:{game_name:'Just Chatting'}
  }, {summary:{avg_viewers:12,max_viewers:214,minutes_streamed:2400,hours_watched:500,followers:30}}, now);
  assert.equal(analysis.mode, 'last30');
  assert.equal(analysis.metrics.find(x=>x[0]==='Avg viewers')[1], 12);
  assert.equal(analysis.context.raids, 1);
  assert.match(analysis.brief, /does not claim per-stream average viewers/i);
  assert.ok(analysis.guardrails.some(x=>/VOD view counts/i.test(x)));
});

test('UI exposes both Last 30 Days and CSV Period modes', () => {
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /id="mode-last30"/);
  assert.match(html, /Last 30 Days/);
  assert.match(html, /id="mode-csv"/);
  assert.match(html, /CSV Period/);
});
