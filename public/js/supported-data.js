export const DATA_CONTRACT = [
  {
    source: 'Twitch Analytics CSV',
    trust: 'Authoritative performance',
    allowed: 'Average/peak viewers, follows, watch time, stream minutes, engagement, clips, host/raid share and other explicitly mapped non-monetary export fields.',
    use: 'Primary performance calculations and organic baselines.',
    limits: 'Revenue/earnings/payout fields are discarded. Daily exports are not treated as individual broadcasts.',
  },
  {
    source: 'Twitch Helix — Videos',
    trust: 'Official observed metadata',
    allowed: 'VOD ID, stream ID, title, created/published time, duration, views, language and URL.',
    use: 'Match uploaded rows to archived broadcasts and clips.',
    limits: 'VOD data does not prove a historical category/game.',
  },
  {
    source: 'Twitch Helix — Clips',
    trust: 'Official observed metadata',
    allowed: 'Clip ID, VOD ID, game ID, title, view count, creation time, duration and VOD offset.',
    use: 'Clip activity around a matched broadcast.',
    limits: 'A clip category describes the clip moment; it is not treated as the category for an entire broadcast.',
  },
  {
    source: 'Twitch EventSub',
    trust: 'Official verified events',
    allowed: 'Incoming raids, stream online/offline boundaries and channel update events.',
    use: 'Confirmed raid influence, prospective stream timing and observed category/title changes.',
    limits: 'Only events received after Wayfinder subscribes exist; it cannot reconstruct events Twitch never sent to Wayfinder.',
  },
  {
    source: 'Twitch Schedule',
    trust: 'Official planned context',
    allowed: 'Scheduled start/end, title, category and recurrence.',
    use: 'Planned schedule context only.',
    limits: 'Never treated as proof that a stream occurred or that the scheduled category was actually played.',
  },
  {
    source: 'TwitchTracker',
    trust: 'Supplemental third-party',
    allowed: 'Allowlisted fields from TwitchTracker’s current 30-day channel summary response: rank, minutes streamed, average/max viewers, hours watched, follower gain and total followers.',
    use: 'In CSV Period mode, corroborate a matching 30-day Twitch CSV window. In Last 30 Days mode, provide the rolling aggregate performance snapshot.',
    limits: 'Never overrides an uploaded Twitch CSV. In Last 30 Days mode it may supply aggregate baseline metrics, but Wayfinder limits conclusions to what the aggregate can actually support.',
  },
  {
    source: 'Creator context',
    trust: 'Manual first-person context',
    allowed: 'Collab, special event, promotion, technical problem, schedule deviation and notes.',
    use: 'Explain confounders Twitch cannot reliably know.',
    limits: 'Kept locally in the browser and clearly labeled manual context.',
  },
];

function finite(v) { return Number.isFinite(Number(v)); }
function num(v) { return finite(v) ? Number(v) : null; }
function pctDiff(a, b) {
  if (!finite(a) || !finite(b) || Number(b) === 0) return null;
  return Math.abs((Number(a) - Number(b)) / Number(b)) * 100;
}
function sameDayKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}

export function buildCrossSourceCheck(rows = [], tracker = null, twitch = null) {
  const checks = [];
  const matchedVods = rows.filter((r) => r.twitch?.vodId).length;
  const exactVods = rows.filter((r) => r.twitch?.matchMethod === 'eventsub-stream-id').length;
  const eventCounts = (twitch?.events || []).reduce((acc, e) => { acc[e.type] = (acc[e.type] || 0) + 1; return acc; }, {});
  checks.push({
    source: 'Twitch API + EventSub',
    status: twitch ? 'available' : 'not loaded',
    headline: twitch ? `${matchedVods} uploaded row${matchedVods === 1 ? '' : 's'} matched to Twitch VOD metadata` : 'Connect Twitch for first-party context',
    detail: twitch ? `${exactVods} exact stream-ID match${exactVods === 1 ? '' : 'es'} · ${eventCounts['channel.raid'] || 0} verified incoming raid event(s) · ${eventCounts['channel.update'] || 0} verified channel update event(s)` : 'No Twitch data is used unless the creator connects their account.',
  });

  const summary = tracker?.summary;
  const fetchedAt = tracker?.fetchedAt ? new Date(tracker.fetchedAt) : null;
  if (!summary || !fetchedAt || Number.isNaN(fetchedAt.getTime())) {
    checks.push({ source: 'TwitchTracker 30-day summary', status: 'not loaded', headline: 'No corroboration available', detail: 'Wayfinder decisions remain based on the Twitch CSV and verified Twitch context.' });
    return checks;
  }

  const windowStart = new Date(fetchedAt.getTime() - 30 * 86400_000);
  const inWindow = rows.filter((r) => r.date && r.date >= windowStart && r.date <= fetchedAt);
  const daily = inWindow.filter((r) => r.dataGranularity === 'daily');
  const coveredDays = new Set(daily.map((r) => sameDayKey(r.date))).size;
  const fullWindow = coveredDays >= 25;
  if (!fullWindow) {
    checks.push({
      source: 'TwitchTracker 30-day summary',
      status: 'context only',
      headline: `${coveredDays || 0} comparable daily dates found in the same 30-day window`,
      detail: 'Wayfinder will not compare aggregate values because the uploaded CSV does not cover enough of TwitchTracker’s current 30-day window.',
    });
    return checks;
  }

  const active = inWindow.filter((r) => Number(r.durationMinutes) > 0);
  const minutes = active.reduce((s,r) => s + (num(r.durationMinutes) || 0), 0);
  const weightedNumerator = active.reduce((s,r) => s + ((num(r.avgViewers) || 0) * (num(r.durationMinutes) || 0)), 0);
  const avgViewers = minutes > 0 ? weightedNumerator / minutes : null;
  const maxViewers = active.reduce((m,r) => Math.max(m, num(r.peakViewers) || 0), 0) || null;
  const hoursWatched = active.reduce((s,r) => s + (num(r.minutesWatched) || 0), 0) / 60;
  const followers = active.reduce((s,r) => s + (num(r.followersGained) || 0), 0);
  const pairs = [
    ['Average viewers', avgViewers, summary.avg_viewers, 20],
    ['Minutes streamed', minutes, summary.minutes_streamed, 20],
    ['Max viewers', maxViewers, summary.max_viewers, 30],
    ['Hours watched', hoursWatched || null, summary.hours_watched, 25],
    ['Followers gained', followers, summary.followers, 30],
  ].filter(([,a,b]) => finite(a) && finite(b));
  const results = pairs.map(([label,a,b,tolerance]) => ({ label, csv: Number(a), tracker: Number(b), differencePct: pctDiff(a,b), aligned: pctDiff(a,b) <= tolerance }));
  const aligned = results.filter((r) => r.aligned).length;
  checks.push({
    source: 'TwitchTracker 30-day summary',
    status: results.length && aligned >= Math.ceil(results.length / 2) ? 'corroborates' : results.length ? 'differs' : 'insufficient',
    headline: results.length ? `${aligned}/${results.length} comparable aggregate metrics are within Wayfinder tolerance` : 'No directly comparable metrics',
    detail: 'This check is supplemental only. Differences are surfaced for investigation and never replace the Twitch CSV values.',
    metrics: results,
  });
  return checks;
}
