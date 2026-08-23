function num(value) { const n = Number(value); return Number.isFinite(n) ? n : null; }
function parseDuration(value='') {
  const text = String(value); let m; let total = 0;
  if ((m = text.match(/(\d+)h/))) total += Number(m[1]) * 60;
  if ((m = text.match(/(\d+)m/))) total += Number(m[1]);
  if ((m = text.match(/(\d+)s/))) total += Number(m[1]) / 60;
  return total;
}
function within30(value, nowMs) {
  const t = new Date(value).getTime();
  return Number.isFinite(t) && t >= nowMs - 30 * 86400_000 && t <= nowMs + 3600_000;
}
function fmt(value, digits=1) { return Number.isFinite(value) ? Number(value).toFixed(digits) : '—'; }

export function buildThirtyDayAnalysis(twitch, tracker, now = new Date()) {
  const nowMs = now.getTime();
  const start = new Date(nowMs - 30 * 86400_000);
  const summary = tracker?.summary || {};
  const videos = (twitch?.videos || []).filter((v) => within30(v.created_at, nowMs));
  const clips = (twitch?.clips || []).filter((c) => within30(c.created_at, nowMs));
  const events = (twitch?.events || []).filter((e) => within30(e.occurredAt, nowMs));
  const raids = events.filter((e) => e.type === 'channel.raid');
  const online = events.filter((e) => e.type === 'stream.online');
  const offline = events.filter((e) => e.type === 'stream.offline');
  const updates = events.filter((e) => e.type === 'channel.update');
  const raidViewers = raids.reduce((sum, e) => sum + (num(e.event?.viewers) || 0), 0);
  const vodMinutes = videos.reduce((sum, v) => sum + parseDuration(v.duration), 0);
  const clipViews = clips.reduce((sum, c) => sum + (num(c.view_count) || 0), 0);
  const avgViewers = num(summary.avg_viewers);
  const maxViewers = num(summary.max_viewers);
  const minutesStreamed = num(summary.minutes_streamed);
  const hoursWatched = num(summary.hours_watched);
  const followers = num(summary.followers);
  const activeHours = Number.isFinite(minutesStreamed) ? minutesStreamed / 60 : null;
  const avgVodHours = videos.length ? vodMinutes / videos.length / 60 : null;

  const dataCoverage = [avgViewers, maxViewers, minutesStreamed, hoursWatched, followers].filter(Number.isFinite).length;
  const confidence = dataCoverage >= 4 ? 'MODERATE' : dataCoverage >= 2 ? 'EARLY' : 'INSUFFICIENT';
  const trackerAvailable = Boolean(tracker && Object.keys(summary).length);

  const brief = trackerAvailable
    ? `Wayfinder has a ${confidence.toLowerCase()} 30-day aggregate baseline from TwitchTracker and first-party Twitch context for ${videos.length} archived VOD${videos.length === 1 ? '' : 's'} and ${clips.length} clip${clips.length === 1 ? '' : 's'}. This mode does not claim per-stream average viewers, historical categories, or best-day performance because Twitch Helix does not provide those historical analytics.`
    : `Twitch is connected, but TwitchTracker did not provide a usable 30-day aggregate summary. Wayfinder can still show official Twitch activity context, but it will not manufacture a performance baseline.`;

  const evidence = [
    { label: '30-day audience baseline', level: trackerAvailable && Number.isFinite(avgViewers) ? 'MODERATE' : 'INSUFFICIENT', detail: Number.isFinite(avgViewers) ? `${fmt(avgViewers)} average viewers from TwitchTracker's current 30-day summary.` : 'No supported 30-day average-viewer field was available.' },
    { label: 'Official activity context', level: videos.length >= 4 ? 'MODERATE' : videos.length ? 'EARLY' : 'INSUFFICIENT', detail: `${videos.length} Twitch archive VOD${videos.length === 1 ? '' : 's'} found in the last 30 days. VODs prove broadcasts existed, not their live average-viewer performance.` },
    { label: 'External-event context', level: raids.length ? 'MODERATE' : (twitch?.eventStorage ? 'EARLY' : 'INSUFFICIENT'), detail: raids.length ? `${raids.length} verified incoming raid event${raids.length === 1 ? '' : 's'} observed by EventSub, totaling ${raidViewers} incoming viewers.` : twitch?.eventStorage ? 'No verified incoming raid event is present in the retained 30-day EventSub window.' : 'Persistent EventSub history is not available.' },
    { label: 'Clip activity', level: clips.length >= 4 ? 'MODERATE' : clips.length ? 'EARLY' : 'INSUFFICIENT', detail: `${clips.length} Twitch clip${clips.length === 1 ? '' : 's'} with ${clipViews} total clip views in the period. Clip activity is context, not proof of growth causation.` },
  ];

  const actions = [];
  if (trackerAvailable && Number.isFinite(avgViewers)) actions.push({ type: 'protect', title: 'Use this as your rolling baseline', body: `${fmt(avgViewers)} average viewers is Wayfinder's current 30-day aggregate reference. It is a rolling snapshot, not a per-stream baseline.` });
  if (raids.length) actions.push({ type: 'watch', title: 'Treat raid influence separately', body: `${raids.length} verified raid event${raids.length === 1 ? '' : 's'} occurred in this window. Wayfinder will not pretend the aggregate TwitchTracker average can be precisely raid-adjusted without daily or stream-level analytics.` });
  if (videos.length >= 3 && Number.isFinite(avgVodHours)) actions.push({ type: 'test', title: 'Compare this month with a CSV export', body: `Twitch shows ${videos.length} archived broadcasts averaging about ${fmt(avgVodHours,1)} hours of VOD duration. Upload the matching Twitch CSV to unlock schedule, engagement, conversion, and external-influence-adjusted decisions.` });
  if (!trackerAvailable) actions.push({ type: 'investigate', title: 'Performance detail is limited', body: 'Twitch Helix supplies official context, but it does not expose historical per-stream average viewers. Use a Twitch Analytics CSV when you need performance decisions.' });

  const guardrails = [
    'Do not infer a best game from the current channel category or VOD title.',
    'Do not infer per-stream average viewers from VOD view counts.',
    'Do not treat Twitch schedule entries as proof that a stream happened.',
    'Do not mathematically remove raid viewers from a 30-day aggregate unless a matching first-party analytics breakdown supports it.',
  ];

  return {
    mode: 'last30', period: { start, end: now }, confidence, brief, evidence, actions, guardrails,
    metrics: [
      ['Avg viewers', avgViewers, 'TwitchTracker'], ['Peak viewers', maxViewers, 'TwitchTracker'], ['Hours streamed', activeHours, 'TwitchTracker'], ['Hours watched', hoursWatched, 'TwitchTracker'], ['Followers gained', followers, 'TwitchTracker'],
      ['Archive VODs', videos.length, 'Twitch API'], ['Clips', clips.length, 'Twitch API'], ['Clip views', clipViews, 'Twitch API'], ['Verified raids', raids.length, 'EventSub'], ['Raid viewers observed', raidViewers, 'EventSub'],
    ],
    context: { videos: videos.length, clips: clips.length, onlineEvents: online.length, offlineEvents: offline.length, channelUpdates: updates.length, raids: raids.length, raidViewers, avgVodHours, currentCategory: twitch?.channel?.game_name || null, currentTitle: twitch?.channel?.title || null },
    limitations: guardrails,
  };
}

export function renderThirtyDayAnalysis(a) {
  const metricCards = a.metrics.map(([label, value, source]) => `<article class="metric-card"><span>${label}</span><strong>${Number.isFinite(value) ? (Number.isInteger(value) ? value : Number(value).toFixed(1)) : '—'}</strong><small>${source}</small></article>`).join('');
  const actions = a.actions.map((x) => `<article class="flight-card ${x.type}"><span>${x.type.toUpperCase()}</span><h3>${x.title}</h3><p>${x.body}</p></article>`).join('');
  const evidence = a.evidence.map((x) => `<article class="evidence-card"><div><span class="confidence ${x.level.toLowerCase()}">${x.level}</span><strong>${x.label}</strong></div><p>${x.detail}</p></article>`).join('');
  const guards = a.guardrails.map((g) => `<article class="guardrail-card"><strong>Do not overclaim</strong><p>${g}</p></article>`).join('');
  return `<section class="decision-brief"><span class="eyebrow">LAST 30 DAYS</span><h2>Rolling evidence snapshot</h2><p>${a.brief}</p><div class="brief-meta"><span>${a.period.start.toLocaleDateString()} – ${a.period.end.toLocaleDateString()}</span><span>Evidence: ${a.confidence}</span></div></section>
    <div class="section-heading"><div><span class="eyebrow">ROLLING BASELINE</span><h2>Supported 30-day signals</h2></div><p>TwitchTracker supplies aggregate performance; Twitch supplies first-party activity and event context.</p></div><div class="metric-grid">${metricCards}</div>
    <div class="section-heading"><div><span class="eyebrow">FLIGHT PLAN</span><h2>What this mode can support</h2></div></div><div class="flight-grid">${actions || '<p>No supported actions yet.</p>'}</div>
    <div class="section-heading"><div><span class="eyebrow">EVIDENCE LEDGER</span><h2>Source-aware confidence</h2></div></div><div class="evidence-grid">${evidence}</div>
    <div class="section-heading"><div><span class="eyebrow">GUARDRAILS</span><h2>What Wayfinder refuses to infer</h2></div></div><div class="guardrail-grid">${guards}</div>`;
}
