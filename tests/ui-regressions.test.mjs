import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildThirtyDayAnalysis, renderThirtyDayAnalysis } from '../public/js/thirty-day.js';
import { renderCategoryRoles } from '../public/js/ui.js';

test('experiment and context Cancel controls are non-submit dialog buttons', () => {
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const cancelButtons = [...html.matchAll(/<button type="button" data-close class="ghost-button">Cancel<\/button>/g)];
  assert.ok(cancelButtons.length >= 2);
  assert.doesNotMatch(html, /<button value="cancel" class="ghost-button">Cancel<\/button>/);
});

test('Last 30 Days renders a structured brief instead of pill-shaped grid metadata', () => {
  const now = new Date('2026-08-23T18:00:00-05:00');
  const analysis = buildThirtyDayAnalysis({ videos: [], clips: [], events: [] }, { summary: { avg_viewers: 12, max_viewers: 20, minutes_streamed: 1800, hours_watched: 360, followers: 20 } }, now);
  const html = renderThirtyDayAnalysis(analysis);
  assert.match(html, /class="rolling-brief"/);
  assert.match(html, /class="rolling-brief-meta"/);
  assert.match(html, /What to do — and what not to do/);
  assert.doesNotMatch(html, /class="brief-meta"/);
});

test('Last 30 Days produces explicit do and do-not guidance', () => {
  const now = new Date('2026-08-23T18:00:00-05:00');
  const analysis = buildThirtyDayAnalysis({ videos: [{ created_at: '2026-08-20T17:00:00Z', duration: '4h0m' }, { created_at: '2026-08-15T17:00:00Z', duration: '4h0m' }, { created_at: '2026-08-10T17:00:00Z', duration: '4h0m' }], clips: [], events: [] }, { summary: { avg_viewers: 12, max_viewers: 20, minutes_streamed: 1800, hours_watched: 360, followers: 20 } }, now);
  assert.ok(analysis.directives.some((x) => x.label === 'DO NOW'));
  assert.ok(analysis.directives.some((x) => x.label === 'DO NOT'));
  assert.ok(analysis.directives.some((x) => x.label === 'TEST NEXT'));
});

test('missing category roles explain the supported-data gap and next step', () => {
  const html = renderCategoryRoles([], { daily: true });
  assert.match(html, /Category roles are unavailable for this daily export/);
  assert.match(html, /What to do/);
  assert.match(html, /will not use the channel’s current category or a VOD title/);
});
