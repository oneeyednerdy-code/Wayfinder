import test from 'node:test';
import assert from 'node:assert/strict';
import { attachRaidEvents, buildIntelligence, comparableStreams, evaluateExperiment } from '../public/js/intelligence.js';

function row(id, date, avgViewers, durationMinutes = 240, followersGained = 3, category = 'SWTOR') {
  return { id, sourceIndex: 2, date: new Date(date), dateHasTime: true, avgViewers, peakViewers: avgViewers * 2, durationMinutes, followersGained, category, title: id, twitch: null };
}

test('confirmed raid is excluded from organic baseline but preserved in raw history', () => {
  const rows = [
    row('a', '2026-08-01T12:00:00', 12),
    row('b', '2026-08-03T12:00:00', 13),
    row('raid', '2026-08-05T12:00:00', 46, 240, 24),
    row('c', '2026-08-07T12:00:00', 11),
  ];
  const intelligence = buildIntelligence(rows, { contexts: { raid: { raid: true } } });
  assert.equal(intelligence.rawAnalysis.rows.length, 4);
  assert.equal(intelligence.organicAnalysis.rows.length, 3);
  assert.ok(intelligence.rawAnalysis.summary.avgViewers > intelligence.organicAnalysis.summary.avgViewers);
  assert.equal(intelligence.rows.find((r) => r.id === 'raid').confirmedExternal, true);
});

test('EventSub raid is matched into a stream window', () => {
  const rows = [row('target', '2026-08-05T12:00:00-05:00', 20)];
  const events = [{ type: 'channel.raid', occurredAt: '2026-08-05T18:00:00Z', event: { viewers: 200, to_broadcaster_user_id: '1' } }];
  const attached = attachRaidEvents(rows, events, {});
  assert.equal(attached[0].raidEvents.length, 1);
  assert.equal(attached[0].raidViewers, 200);
  assert.equal(attached[0].confirmedExternal, true);
});

test('EventSub raid matching remains correct with explicit non-UTC stream offsets', () => {
  const rows = [row('target-offset', '2026-08-05T12:00:00-05:00', 20)];
  const events = [{ type: 'channel.raid', occurredAt: '2026-08-05T17:45:00Z', event: { viewers: 75, to_broadcaster_user_id: '1' } }];
  const attached = attachRaidEvents(rows, events, {});
  assert.equal(attached[0].raidEvents.length, 1);
  assert.equal(attached[0].raidViewers, 75);
});

test('comparable stream engine prefers similar category/start/duration', () => {
  const target = row('target', '2026-08-05T12:00:00', 16, 240, 4, 'SWTOR');
  const close = row('close', '2026-08-06T12:20:00', 15, 250, 4, 'SWTOR');
  const far = row('far', '2026-08-07T20:00:00', 30, 360, 5, 'Phasmophobia');
  const results = comparableStreams(target, [target, far, close]);
  assert.equal(results[0].row.id, 'close');
  assert.ok(results[0].score >= 80);
});

test('experiment evaluation ignores external-event rows', () => {
  const rows = [
    { ...row('a', '2026-08-01T12:00:00', 12), confirmedExternal: false },
    { ...row('b', '2026-08-02T12:20:00', 14), confirmedExternal: false },
    { ...row('raid', '2026-08-03T12:10:00', 70), confirmedExternal: true },
    { ...row('c', '2026-08-04T15:00:00', 10), confirmedExternal: false },
    { ...row('d', '2026-08-05T15:15:00', 11), confirmedExternal: false },
  ];
  const result = evaluateExperiment({ id: 'x', name: 'start', type: 'start', control: '15', test: '12', minimum: 2 }, rows);
  assert.equal(result.testN, 2);
  assert.equal(result.controlN, 2);
  assert.ok(result.testAvg < 20);
});

test('decision lab does not promote a one-off category into strong evidence', () => {
  const rows = [
    row('a', '2026-08-01T12:00:00', 12, 240, 2, 'SWTOR'),
    row('b', '2026-08-02T12:00:00', 13, 240, 2, 'SWTOR'),
    row('c', '2026-08-03T12:00:00', 40, 240, 8, 'One-Off Game'),
  ];
  const intelligence = buildIntelligence(rows);
  const evidence = intelligence.evidenceLedger.find((item) => item.claim.includes('One-Off Game'));
  assert.ok(!evidence || evidence.evidence !== 'Strong');
  assert.ok(intelligence.guardrails.some((item) => item.title.includes('best category')));
});

test('decision brief uses organic baseline when a confirmed raid distorts raw average', () => {
  const rows = [
    row('a', '2026-08-01T12:00:00', 12),
    row('b', '2026-08-03T12:00:00', 12),
    row('raid', '2026-08-05T12:00:00', 60),
    row('c', '2026-08-07T12:00:00', 13),
    row('d', '2026-08-09T12:00:00', 11),
    row('e', '2026-08-11T12:00:00', 12),
  ];
  const intelligence = buildIntelligence(rows, { contexts: { raid: { raid: true } } });
  assert.equal(intelligence.decisionBrief.external, 1);
  assert.ok(intelligence.decisionBrief.rawAverage > intelligence.decisionBrief.organicBaseline);
  assert.ok(intelligence.guardrails.some((item) => item.type === 'external'));
});

test('decision lab generates a duration test suggestion from repeated meaningful differences', () => {
  const rows = [
    row('a', '2026-08-01T12:00:00', 10, 330),
    row('b', '2026-08-02T12:00:00', 11, 320),
    row('c', '2026-08-03T12:00:00', 10, 340),
    row('d', '2026-08-04T12:00:00', 18, 210),
    row('e', '2026-08-05T12:00:00', 19, 220),
    row('f', '2026-08-06T12:00:00', 20, 230),
  ];
  const intelligence = buildIntelligence(rows);
  assert.ok(intelligence.testSuggestions.some((item) => item.experiment?.type === 'duration'));
});

test('daily aggregate datasets do not create category experiment suggestions without category data', () => {
  const rows = [
    row('a', '2026-08-01T00:00:00', 10, 240, 2, ''),
    row('b', '2026-08-02T00:00:00', 12, 240, 2, ''),
    row('c', '2026-08-03T00:00:00', 14, 240, 2, ''),
    row('d', '2026-08-04T00:00:00', 15, 240, 2, ''),
    row('e', '2026-08-05T00:00:00', 16, 240, 2, ''),
    row('f', '2026-08-06T00:00:00', 18, 240, 2, ''),
  ].map((item) => ({ ...item, dataGranularity: 'daily', dateHasTime: false }));
  const intelligence = buildIntelligence(rows);
  assert.equal(intelligence.testSuggestions.some((item) => item.experiment?.type === 'category'), false);
});

test('inactive daily aggregate rows are excluded from decision analysis', () => {
  const rows = [
    { ...row('off', '2026-08-01T00:00:00', 0, 0, 0, ''), dataGranularity: 'daily', dateHasTime: false },
    { ...row('live1', '2026-08-02T00:00:00', 12, 240, 2, ''), dataGranularity: 'daily', dateHasTime: false },
    { ...row('live2', '2026-08-03T00:00:00', 14, 240, 2, ''), dataGranularity: 'daily', dateHasTime: false },
  ];
  const intelligence = buildIntelligence(rows);
  assert.equal(intelligence.rows.length, 3);
  assert.equal(intelligence.decisionRows.length, 2);
  assert.equal(intelligence.inactiveDailyRows, 1);
  assert.equal(intelligence.organicAnalysis.byDuration.some((item) => item.key === '< 2h'), false);
});

test('material Twitch CSV hosts/raids share is treated as external influence without inventing a specific raid event', () => {
  const rows = [
    { ...row('base1', '2026-08-01T12:00:00', 12), hostsRaidsViewerPct: 0 },
    { ...row('base2', '2026-08-02T12:00:00', 13), hostsRaidsViewerPct: 0 },
    { ...row('external', '2026-08-03T12:00:00', 40), hostsRaidsViewerPct: 60 },
  ];
  const intelligence = buildIntelligence(rows);
  const target = intelligence.rows.find((item) => item.id === 'external');
  assert.equal(target.confirmedExternal, true);
  assert.equal(target.raidEvents.length, 0);
  assert.ok(target.externalReasons.some((reason) => reason.includes('Twitch CSV hosts/raids share')));
  assert.equal(intelligence.organicAnalysis.rows.length, 2);
});

test('audience composition ignores missing engaged-viewer fields instead of treating them as zero', () => {
  const rows = [
    row('a', '2026-08-01T12:00:00', 10), row('b', '2026-08-02T12:00:00', 11), row('c', '2026-08-03T12:00:00', 12),
    row('d', '2026-08-04T12:00:00', 13), row('e', '2026-08-05T12:00:00', 14), row('f', '2026-08-06T12:00:00', 15),
  ];
  const intelligence = buildIntelligence(rows);
  assert.deepEqual(intelligence.audienceQuality, []);
});

test('audience composition compares returning engaged share across periods', () => {
  const rows = [
    { ...row('a', '2026-08-01T12:00:00', 10), engagedViewers: 20, returningEngagedViewers: 8, newEngagedViewers: 12 },
    { ...row('b', '2026-08-02T12:00:00', 11), engagedViewers: 20, returningEngagedViewers: 8, newEngagedViewers: 12 },
    { ...row('c', '2026-08-03T12:00:00', 12), engagedViewers: 20, returningEngagedViewers: 8, newEngagedViewers: 12 },
    { ...row('d', '2026-08-04T12:00:00', 13), engagedViewers: 20, returningEngagedViewers: 12, newEngagedViewers: 8 },
    { ...row('e', '2026-08-05T12:00:00', 14), engagedViewers: 20, returningEngagedViewers: 12, newEngagedViewers: 8 },
    { ...row('f', '2026-08-06T12:00:00', 15), engagedViewers: 20, returningEngagedViewers: 12, newEngagedViewers: 8 },
  ];
  const intelligence = buildIntelligence(rows);
  const returning = intelligence.audienceQuality.find((item) => item.key === 'returningShare');
  assert.ok(returning);
  assert.equal(Math.round(returning.earlier), 40);
  assert.equal(Math.round(returning.recent), 60);
  assert.equal(Math.round(returning.delta), 20);
});
