import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIntelligence, attachRaidEvents } from '../public/js/intelligence.js';

function row(day, avg, extra = {}) {
  return {
    id: `r-${day}-${avg}`,
    date: new Date(`2026-08-${String(day).padStart(2,'0')}T12:00:00-05:00`),
    dateHasTime: true,
    dataGranularity: 'stream',
    durationMinutes: 240,
    avgViewers: avg,
    peakViewers: avg + 8,
    followersGained: 4,
    engagedViewers: 20,
    newEngagedViewers: 5,
    returningEngagedViewers: 15,
    uniqueChatters: 8,
    clipsCreated: 2,
    category: day % 2 ? 'SWTOR' : 'Phasmophobia',
    ...extra,
  };
}

test('Evidence Engine 2 builds 7/30/90 day organic baselines', () => {
  const rows = Array.from({ length: 12 }, (_, i) => row(i + 1, 10 + i * 0.5));
  const result = buildIntelligence(rows);
  assert.deepEqual(result.baselineWindows.map((x) => x.days), [7, 30, 90]);
  assert.ok(result.baselineWindows[0].n > 0);
  assert.equal(result.engineVersion, '0.7');
});

test('Evidence Engine 2 detects a sustained baseline shift', () => {
  const rows = [
    ...Array.from({ length: 6 }, (_, i) => row(i + 1, 10)),
    ...Array.from({ length: 6 }, (_, i) => row(i + 7, 15)),
  ];
  const result = buildIntelligence(rows);
  assert.ok(result.changePoint);
  assert.ok(result.changePoint.delta >= 40);
});

test('external influence receives an explicit classification before recommendations', () => {
  const rows = attachRaidEvents([row(1, 40)], [{ type: 'channel.raid', occurredAt: '2026-08-01T18:00:00Z', event: { viewers: 200 } }], {});
  assert.equal(rows[0].influenceClass, 'confirmed-external');
  assert.equal(rows[0].confirmedExternal, true);
});

test('thin evidence can explicitly produce NO ACTION YET', () => {
  const result = buildIntelligence([row(1, 12), row(2, 13)]);
  assert.equal(result.recommendationStatus.status, 'NO ACTION YET');
});

test('efficiency model derives non-revenue creator efficiency metrics', () => {
  const result = buildIntelligence([row(1, 12), row(2, 13), row(3, 14), row(4, 15)]);
  assert.ok(Number.isFinite(result.efficiency.followersPerHour));
  assert.ok(Number.isFinite(result.efficiency.engagedPerHour));
  assert.equal('revenuePerHour' in result.efficiency, false);
});
