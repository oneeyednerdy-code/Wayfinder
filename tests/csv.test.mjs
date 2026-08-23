import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCSV, inferColumnMap, inferDatasetGranularity, normalizeRows, parseDurationMinutes } from '../public/js/csv.js';

test('parses quoted CSV fields', () => {
  const parsed = parseCSV('Date,Title,Average Viewers\n2026-08-01,"Game, but chill",12\n');
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].Title, 'Game, but chill');
});

test('detects common Twitch-style columns', () => {
  const headers = ['Date', 'Game', 'Duration', 'Average Viewers', 'Peak Viewers', 'Followers Gained'];
  const map = inferColumnMap(headers);
  assert.equal(map.date, 'Date');
  assert.equal(map.category, 'Game');
  assert.equal(map.avgViewers, 'Average Viewers');
  assert.equal(map.followersGained, 'Followers Gained');
});

test('normalizes rows and duration', () => {
  const parsed = parseCSV('Date,Game,Duration,Average Viewers,Followers Gained\n2026-08-01,SWTOR,4:30:00,15,5\n');
  const rows = normalizeRows(parsed);
  assert.equal(rows[0].category, 'SWTOR');
  assert.equal(rows[0].durationMinutes, 270);
  assert.equal(rows[0].avgViewers, 15);
  assert.equal(rows[0].followersGained, 5);
});

test('duration parser understands Twitch duration strings', () => {
  assert.equal(parseDurationMinutes('3h42m10s'), 222 + 10 / 60);
  assert.equal(parseDurationMinutes('4.5', 'Hours Streamed'), 270);
});

test('revenue and monetary columns are discarded at the import boundary', () => {
  const parsed = parseCSV('Date,Average Viewers,Sub Revenue,Prime Revenue,Ad Revenue,Estimated Earnings,Payout,Income\n2026-08-01,12,999.99,888.88,777.77,666.66,555.55,444.44\n');
  assert.deepEqual(parsed.headers, ['Date', 'Average Viewers']);
  assert.equal(parsed.privateColumnsRemoved, 6);
  assert.deepEqual(parsed.rows[0], { Date: '2026-08-01', 'Average Viewers': '12' });
  const serialized = JSON.stringify(parsed);
  for (const secret of ['999.99', '888.88', '777.77', '666.66', '555.55', '444.44']) {
    assert.equal(serialized.includes(secret), false);
  }
});

test('normalized Wayfinder rows contain no revenue field', () => {
  const parsed = parseCSV('Date,Average Viewers,Sub Revenue\n2026-08-01,12,999.99\n');
  const normalized = normalizeRows(parsed);
  assert.equal(Object.hasOwn(normalized[0], 'revenue'), false);
  assert.equal(Object.hasOwn(normalized[0], 'raw'), false);
});


test('recognizes the safe analytics fields in Twitch daily exports while blocking revenue columns', () => {
  const parsed = parseCSV('Date,Average Viewers,Follows,Minutes Streamed,Minutes Watched,Live Views,Max Viewers,Unique Viewers,Engaged Viewers,Hosts and Raids Viewers (%),Chatters,Chat Messages,Clips Created,Clip Views,Sub Revenue,Prime Revenue,Gifted Subs Revenue,Bits Revenue,Ad Revenue,Turbo Revenue,Game Sales Revenue,Extensions Revenue,Bounties Revenue,Other Bits Interactions Revenue,New Engaged Viewers,Returning Engaged Viewers,Prime Subs,Total Paid Subs,Total Gifted Subs\n2026-07-01,12,3,240,2880,100,20,50,25,30%,8,40,2,15,1,2,3,4,5,6,7,8,9,10,6,19,2,4,1\n');
  const mapping = inferColumnMap(parsed.headers);
  assert.equal(parsed.privateColumnsRemoved, 10);
  assert.equal(mapping.engagedViewers, 'Engaged Viewers');
  assert.equal(mapping.hostsRaidsViewerPct, 'Hosts and Raids Viewers (%)');
  assert.equal(mapping.clipsCreated, 'Clips Created');
  assert.equal(mapping.returningEngagedViewers, 'Returning Engaged Viewers');
  assert.equal(mapping.totalPaidSubs, 'Total Paid Subs');
  const normalized = normalizeRows(parsed, mapping)[0];
  assert.equal(normalized.hostsRaidsViewerPct, 30);
  assert.equal(normalized.engagedViewers, 25);
  assert.equal(Object.hasOwn(normalized, 'revenue'), false);
});

test('detects Twitch by-day exports as daily aggregates', () => {
  const parsed = parseCSV('Date,Average Viewers,Follows,Minutes Streamed\n2026-07-01,12,3,240\n');
  const mapping = inferColumnMap(parsed.headers);
  assert.equal(inferDatasetGranularity('Analytics and Revenue by day from Jul_1 to Jul_31.csv', parsed, mapping), 'daily');
});

test('supported-data import does not guess similarly named columns', () => {
  const parsed = parseCSV('Date,Average Viewer Score,Followers Quality\n2026-08-01,99,88\n');
  const mapping = inferColumnMap(parsed.headers);
  assert.equal(mapping.avgViewers, undefined);
  assert.equal(mapping.followersGained, undefined);
});
