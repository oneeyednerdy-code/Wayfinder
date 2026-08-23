import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeRows } from '../public/js/analytics.js';

function row(date, avgViewers, durationMinutes = 240, followersGained = 2, category = 'SWTOR') {
  return { date: new Date(date), avgViewers, durationMinutes, followersGained, category };
}

test('computes weighted summary and follower conversion', () => {
  const analysis = analyzeRows([
    row('2026-08-03T12:00:00', 10, 120, 2),
    row('2026-08-05T12:00:00', 20, 240, 6),
  ]);
  assert.equal(analysis.summary.totalHours, 6);
  assert.equal(analysis.summary.totalFollowers, 8);
  assert.ok(Math.abs(analysis.summary.avgViewers - (50 / 3)) < 0.001);
  assert.ok(Math.abs(analysis.summary.followersPerHour - (8 / 6)) < 0.001);
});

test('creates day patterns from dated rows', () => {
  const analysis = analyzeRows([
    row('2026-08-03T12:00:00', 10),
    row('2026-08-10T12:00:00', 11),
    row('2026-08-17T12:00:00', 12),
    row('2026-08-05T12:00:00', 20),
    row('2026-08-12T12:00:00', 21),
    row('2026-08-19T12:00:00', 22),
  ]);
  const monday = analysis.byDay.find((item) => item.key === 'Monday');
  const wednesday = analysis.byDay.find((item) => item.key === 'Wednesday');
  assert.equal(monday.n, 3);
  assert.equal(wednesday.n, 3);
  assert.ok(wednesday.avgViewers > monday.avgViewers);
});

test('does not invent a strong pattern from one row', () => {
  const analysis = analyzeRows([row('2026-08-03T12:00:00', 99)]);
  assert.equal(analysis.insights[0].confidence, 'Insufficient');
});

test('analytics summaries have no revenue metric', () => {
  const result = analyzeRows([{
    date: new Date('2026-08-01T12:00:00Z'),
    durationMinutes: 240,
    avgViewers: 12,
    peakViewers: 20,
    followersGained: 3,
    minutesWatched: 2880,
    uniqueViewers: 40,
  }]);
  assert.equal(Object.hasOwn(result.summary, 'totalRevenue'), false);
  assert.equal(Object.hasOwn(result.summary, 'revenue'), false);
});
