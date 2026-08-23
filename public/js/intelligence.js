import { analyzeRows, confidenceForCount, formatNumber, formatSignedPercent } from './analytics.js';

const EXTERNAL_KEYS = ['raid', 'frontPage', 'promotion'];
const MATERIAL_HOST_RAID_PCT = 25;

function finite(values) { return values.filter(Number.isFinite); }
function sum(values) { return finite(values).reduce((a, b) => a + b, 0); }
function avg(values) { const x = finite(values); return x.length ? sum(x) / x.length : null; }
function pctDelta(value, baseline) { return Number.isFinite(value) && Number.isFinite(baseline) && baseline !== 0 ? ((value - baseline) / baseline) * 100 : null; }
function median(values) {
  const x = finite(values).sort((a, b) => a - b);
  if (!x.length) return null;
  const mid = Math.floor(x.length / 2);
  return x.length % 2 ? x[mid] : (x[mid - 1] + x[mid]) / 2;
}
function stddev(values) {
  const x = finite(values); if (x.length < 2) return null;
  const m = avg(x); return Math.sqrt(avg(x.map((v) => (v - m) ** 2)));
}
function hours(row) { return Number.isFinite(row.durationMinutes) ? row.durationMinutes / 60 : null; }
function followersPerHour(row) { const h = hours(row); return h > 0 && Number.isFinite(row.followersGained) ? row.followersGained / h : null; }
function startHour(row) { return row.date && row.dateHasTime ? row.date.getHours() + row.date.getMinutes() / 60 : null; }
function durationBand(row) {
  const h = hours(row); if (!Number.isFinite(h)) return null;
  if (h < 2) return '< 2h'; if (h < 3) return '2–3h'; if (h < 4) return '3–4h'; if (h < 5) return '4–5h'; return '5h+';
}
function sameDay(a, b) { return a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
function isDecisionObservation(row) {
  if (row.dataGranularity !== 'daily') return true;
  return Number.isFinite(row.durationMinutes) && row.durationMinutes > 0;
}

export function attachRaidEvents(inputRows, events = [], contexts = {}) {
  const raidEvents = events.filter((entry) => entry.type === 'channel.raid' && entry.event);
  return inputRows.map((row) => {
    const manual = contexts[row.id] || {};
    const matches = raidEvents.filter((entry) => {
      const eventDate = new Date(entry.occurredAt || 0);
      if (!row.date || Number.isNaN(eventDate.getTime())) return false;
      if (!row.dateHasTime) return sameDay(row.date, eventDate);
      const start = row.date.getTime() - 10 * 60_000;
      const end = row.date.getTime() + ((Number.isFinite(row.durationMinutes) ? row.durationMinutes : 360) + 30) * 60_000;
      return eventDate.getTime() >= start && eventDate.getTime() <= end;
    });
    const raidViewers = sum(matches.map((entry) => Number(entry.event.viewers)));
    const csvHostRaidPct = Number(row.hostsRaidsViewerPct);
    const csvMaterialExternal = Number.isFinite(csvHostRaidPct) && csvHostRaidPct >= MATERIAL_HOST_RAID_PCT;
    const confirmedExternal = EXTERNAL_KEYS.some((key) => Boolean(manual[key])) || matches.length > 0 || csvMaterialExternal;
    return {
      ...row,
      context: manual,
      raidEvents: matches,
      raidViewers,
      confirmedExternal,
      externalReasons: [
        ...(matches.length ? [`Twitch EventSub raid${matches.length > 1 ? 's' : ''}`] : []),
        ...(manual.raid && !matches.length ? ['Manually marked raid'] : []),
        ...(manual.frontPage ? ['Front-page / feature'] : []),
        ...(manual.promotion ? ['External promotion'] : []),
        ...(csvMaterialExternal ? [`Twitch CSV hosts/raids share ${csvHostRaidPct.toFixed(1)}%`] : []),
      ],
    };
  });
}

function similarityScore(a, b) {
  if (a.id === b.id) return 0;
  let score = 0;
  if (a.category && b.category && a.category.toLowerCase() === b.category.toLowerCase()) score += 35;
  const aStart = startHour(a); const bStart = startHour(b);
  if (Number.isFinite(aStart) && Number.isFinite(bStart)) {
    const diff = Math.abs(aStart - bStart);
    if (diff <= 0.5) score += 25; else if (diff <= 1.5) score += 18; else if (diff <= 3) score += 8;
  }
  if (Number.isFinite(a.durationMinutes) && Number.isFinite(b.durationMinutes)) {
    const diff = Math.abs(a.durationMinutes - b.durationMinutes);
    if (diff <= 20) score += 20; else if (diff <= 45) score += 14; else if (diff <= 90) score += 6;
  }
  if (a.date && b.date) {
    const days = Math.abs(a.date - b.date) / 86400_000;
    if (days <= 30) score += 10; else if (days <= 90) score += 5;
  }
  const aCollab = Boolean(a.context?.collab); const bCollab = Boolean(b.context?.collab);
  if (aCollab === bCollab) score += 10;
  return score;
}

export function comparableStreams(target, rows, limit = 4) {
  return rows.filter((row) => isDecisionObservation(row) && !row.confirmedExternal && row.id !== target.id && Number.isFinite(row.avgViewers))
    .map((row) => ({ row, score: similarityScore(target, row) }))
    .filter((item) => item.score >= 45)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function buildComparableDaySignals(rows) {
  const byDay = new Map();
  for (const row of rows) {
    if (!row.date || !Number.isFinite(row.avgViewers)) continue;
    const targetDay = row.date.toLocaleDateString('en-US', { weekday: 'long' });
    const comps = comparableStreams(row, rows, 8).filter((item) => item.row.date && item.row.date.getDay() !== row.date.getDay());
    if (!comps.length) continue;
    const comparisonAvg = avg(comps.map((item) => item.row.avgViewers));
    const delta = pctDelta(row.avgViewers, comparisonAvg);
    if (!Number.isFinite(delta)) continue;
    if (!byDay.has(targetDay)) byDay.set(targetDay, []);
    byDay.get(targetDay).push(delta);
  }
  return [...byDay.entries()].map(([key, values]) => ({ key, controlledDelta: avg(values), comparisons: values.length, confidence: confidenceForCount(values.length) }));
}

function buildCategoryRoles(analysis) {
  const overallConversion = analysis.summary.followersPerHour;
  return analysis.byCategory.map((category) => {
    const rows = analysis.rows.filter((row) => row.category === category.key);
    const variability = stddev(rows.map((row) => row.avgViewers));
    const consistency = Number.isFinite(variability) && category.avgViewers ? Math.max(0, 100 - (variability / category.avgViewers) * 100) : null;
    const audienceDelta = category.deltaAvgViewers;
    const conversionDelta = pctDelta(category.followersPerHour, overallConversion);
    let role = 'Experimental';
    if (category.n >= 6 && (audienceDelta ?? -999) >= 0 && (conversionDelta ?? -999) >= 0) role = 'Core Category';
    else if (category.n >= 3 && (conversionDelta ?? -999) >= 20) role = 'Conversion Category';
    else if (category.n >= 3 && (audienceDelta ?? -999) >= 20) role = 'Reach Category';
    else if (category.n >= 4 && Number.isFinite(consistency) && consistency >= 75) role = 'Stable Category';
    return { ...category, role, audienceDelta, conversionDelta, consistency };
  });
}

function completeness(rows, key) {
  if (!rows.length) return 0;
  return rows.filter((row) => {
    const value = row[key];
    return value !== null && value !== undefined && value !== '' && !(typeof value === 'number' && !Number.isFinite(value));
  }).length / rows.length * 100;
}

function buildDataHealth(rows) {
  const metrics = [
    ['Date / time', 'date'], ['Category', 'category'], ['Duration', 'durationMinutes'], ['Avg viewers', 'avgViewers'],
    ['Peak viewers', 'peakViewers'], ['Followers', 'followersGained'], ['Unique viewers', 'uniqueViewers'], ['Chatters', 'uniqueChatters'],
  ].map(([label, key]) => ({ label, key, pct: completeness(rows, key) }));
  const core = metrics.filter((item) => ['date', 'durationMinutes', 'avgViewers', 'followersGained'].includes(item.key));
  const score = avg(core.map((item) => item.pct)) || 0;
  const rating = rows.length < 3 ? 'Limited' : score >= 85 ? 'Good' : score >= 60 ? 'Fair' : 'Limited';
  return { rows: rows.length, score, rating, metrics };
}

function buildWhatChanged(rows) {
  const dated = rows.filter((row) => row.date && !row.confirmedExternal).sort((a, b) => a.date - b.date);
  if (dated.length < 6) return null;
  const midpoint = Math.floor(dated.length / 2);
  const earlier = dated.slice(0, midpoint); const recent = dated.slice(midpoint);
  const summarize = (set) => ({
    n: set.length,
    avgViewers: analyzeRows(set).summary.avgViewers,
    followersPerHour: analyzeRows(set).summary.followersPerHour,
    duration: avg(set.map((row) => row.durationMinutes)),
    startHour: avg(set.map(startHour)),
    hours: sum(set.map((row) => row.durationMinutes)) / 60,
    topCategory: analyzeRows(set).byCategory[0]?.key || '—',
  });
  const a = summarize(earlier); const b = summarize(recent);
  return {
    earlier: a, recent: b,
    changes: [
      { label: 'Average viewers', earlier: a.avgViewers, recent: b.avgViewers, delta: pctDelta(b.avgViewers, a.avgViewers), format: 'number' },
      { label: 'Followers/hour', earlier: a.followersPerHour, recent: b.followersPerHour, delta: pctDelta(b.followersPerHour, a.followersPerHour), format: 'number2' },
      { label: 'Avg duration', earlier: a.duration, recent: b.duration, delta: pctDelta(b.duration, a.duration), format: 'minutes' },
      { label: 'Avg start hour', earlier: a.startHour, recent: b.startHour, delta: Number.isFinite(a.startHour) && Number.isFinite(b.startHour) ? b.startHour - a.startHour : null, format: 'hourdiff' },
      { label: 'Stream hours', earlier: a.hours, recent: b.hours, delta: pctDelta(b.hours, a.hours), format: 'number' },
    ],
  };
}



function buildAudienceQuality(rows) {
  const dated = rows.filter((row) => row.date && !row.confirmedExternal).sort((a, b) => a.date - b.date);
  if (dated.length < 6) return [];
  const midpoint = Math.floor(dated.length / 2);
  const earlier = dated.slice(0, midpoint);
  const recent = dated.slice(midpoint);
  const safeRatio = (row, numerator, denominator) => {
    const n = Number(row[numerator]); const d = Number(row[denominator]);
    return Number.isFinite(n) && Number.isFinite(d) && d > 0 ? n / d : null;
  };
  const perHour = (row, key) => {
    const value = Number(row[key]); const h = hours(row);
    return Number.isFinite(value) && Number.isFinite(h) && h > 0 ? value / h : null;
  };
  const definitions = [
    { key: 'returningShare', label: 'Returning engaged share', get: (row) => { const value = safeRatio(row, 'returningEngagedViewers', 'engagedViewers'); return Number.isFinite(value) ? value * 100 : null; }, mode: 'points', detail: 'How much of the engaged audience is returning rather than new.' },
    { key: 'newShare', label: 'New engaged share', get: (row) => { const value = safeRatio(row, 'newEngagedViewers', 'engagedViewers'); return Number.isFinite(value) ? value * 100 : null; }, mode: 'points', detail: 'How much of the engaged audience is new.' },
    { key: 'chatDepth', label: 'Chat messages / engaged viewer', get: (row) => safeRatio(row, 'chatMessages', 'engagedViewers'), mode: 'percent', detail: 'A conversation-depth proxy, not a quality score.' },
    { key: 'clipRate', label: 'Clips created / streamed hour', get: (row) => perHour(row, 'clipsCreated'), mode: 'percent', detail: 'How often viewers create clips relative to time live.' },
  ];
  return definitions.map((definition) => {
    const aValues = earlier.map(definition.get).filter(Number.isFinite);
    const bValues = recent.map(definition.get).filter(Number.isFinite);
    const a = avg(aValues); const b = avg(bValues);
    const delta = definition.mode === 'points'
      ? (Number.isFinite(a) && Number.isFinite(b) ? b - a : null)
      : pctDelta(b, a);
    const n = Math.min(aValues.length, bValues.length);
    return { ...definition, earlier: a, recent: b, delta, n, confidence: confidenceForCount(n) };
  }).filter((item) => Number.isFinite(item.earlier) && Number.isFinite(item.recent));
}

function buildRaidRetention(rows) {
  const dated = rows.filter((row) => row.date && Number.isFinite(row.avgViewers)).sort((a, b) => a.date - b.date);
  const results = [];
  dated.forEach((raidRow, index) => {
    if (!raidRow.raidEvents?.length && !raidRow.context?.raid) return;
    const before = dated.slice(Math.max(0, index - 5), index).filter((row) => !row.confirmedExternal);
    const after = dated.slice(index + 1).filter((row) => !row.confirmedExternal).slice(0, 3);
    if (!before.length || !after.length) return;
    const beforeAvg = analyzeRows(before).summary.avgViewers;
    const afterAvg = analyzeRows(after).summary.avgViewers;
    results.push({
      id: raidRow.id,
      date: raidRow.date,
      raidViewers: raidRow.raidViewers || null,
      beforeAvg,
      afterAvg,
      delta: pctDelta(afterAvg, beforeAvg),
      afterN: after.length,
      confidence: after.length >= 3 && before.length >= 3 ? 'Early signal' : 'Insufficient',
    });
  });
  return results;
}

function buildScorecard(rawAnalysis, organicAnalysis, whatChanged, health) {
  const audienceDelta = whatChanged?.changes.find((item) => item.label === 'Average viewers')?.delta;
  const conversionDelta = whatChanged?.changes.find((item) => item.label === 'Followers/hour')?.delta;
  const anomalyImpact = pctDelta(rawAnalysis.summary.avgViewers, organicAnalysis.summary.avgViewers);
  return [
    { label: 'Audience trend', value: !Number.isFinite(audienceDelta) ? 'Unknown' : audienceDelta >= 8 ? 'Growing' : audienceDelta <= -8 ? 'Declining' : 'Stable', detail: Number.isFinite(audienceDelta) ? formatSignedPercent(audienceDelta) : 'Need more dated streams' },
    { label: 'Conversion', value: !Number.isFinite(conversionDelta) ? 'Unknown' : conversionDelta >= 10 ? 'Improving' : conversionDelta <= -10 ? 'Declining' : 'Stable', detail: Number.isFinite(conversionDelta) ? formatSignedPercent(conversionDelta) : 'Need follower data' },
    { label: 'External-event influence', value: Math.abs(anomalyImpact || 0) >= 10 ? 'Meaningful' : 'Low', detail: Number.isFinite(anomalyImpact) ? `${formatSignedPercent(anomalyImpact)} raw vs organic` : 'No distortion detected' },
    { label: 'Data quality', value: health.rating, detail: `${health.rows} rows · ${formatNumber(health.score, 0)}% core completeness` },
  ];
}

function buildFlightPlan({ goal, organicAnalysis, rawAnalysis, daySignals, categoryRoles, whatChanged, rows }) {
  const items = [];
  const strongestDay = organicAnalysis.byDay.filter((item) => item.n >= 3).sort((a, b) => (b.avgViewers || 0) - (a.avgViewers || 0))[0];
  const controlled = daySignals.filter((item) => item.comparisons >= 3 && Number.isFinite(item.controlledDelta)).sort((a, b) => b.controlledDelta - a.controlledDelta)[0];
  const topRole = categoryRoles.find((item) => item.role === 'Core Category') || categoryRoles.find((item) => item.n >= 3);
  const durations = organicAnalysis.byDuration.filter((item) => item.n >= 3).sort((a, b) => (b.avgViewers || 0) - (a.avgViewers || 0));
  const externalCount = rows.filter((row) => row.confirmedExternal).length;

  if (goal === 'followers') {
    const topConversion = [...organicAnalysis.byCategory].filter((x) => x.n >= 3 && Number.isFinite(x.followersPerHour)).sort((a,b) => b.followersPerHour-a.followersPerHour)[0];
    if (topConversion) items.push({ type: 'protect', title: `Protect ${topConversion.key} conversion`, body: `${formatNumber(topConversion.followersPerHour,2)} followers/hour across ${topConversion.n} qualifying streams.`, math: [['Followers/hour', formatNumber(topConversion.followersPerHour,2)], ['Streams', String(topConversion.n)]] });
  } else if (goal === 'schedule' && controlled) {
    items.push({ type: 'protect', title: `Protect the ${controlled.key} signal`, body: `Like-for-like checks estimate ${formatSignedPercent(controlled.controlledDelta)} performance versus comparable observations on other days.`, math: [['Comparable checks', String(controlled.comparisons)], ['Controlled difference', formatSignedPercent(controlled.controlledDelta)]] });
  } else if (controlled && controlled.controlledDelta >= 8) {
    items.push({ type: 'protect', title: `Protect the ${controlled.key} conditions while you verify them`, body: `This schedule signal still appears after a like-for-like comparison instead of relying on a simple day average.`, math: [['Comparable checks', String(controlled.comparisons)], ['Controlled difference', formatSignedPercent(controlled.controlledDelta)]] });
  } else if (topRole?.role === 'Core Category' && topRole.n >= 6) {
    items.push({ type: 'protect', title: `Protect ${topRole.key} as a core condition`, body: `It has repeated audience and conversion support instead of a single standout result.`, math: [['Role', topRole.role], ['Observations', String(topRole.n)], ['Audience delta', formatSignedPercent(topRole.audienceDelta)], ['Conversion delta', formatSignedPercent(topRole.conversionDelta)]] });
  } else {
    items.push({ type: 'protect', title: 'Protect your current baseline while testing', body: 'No single condition has earned enough controlled evidence to justify a broad strategy change yet. Change one variable at a time.', math: [['Organic observations', String(organicAnalysis.summary.rows)], ['Organic baseline', formatNumber(organicAnalysis.summary.avgViewers,1)]] });
  }

  if (goal === 'categories' && topRole) items.push({ type: 'test', title: `Re-test ${topRole.key}`, body: `${topRole.role} based on audience, conversion, sample size and consistency.`, math: [['Role', topRole.role], ['Streams', String(topRole.n)], ['Audience delta', formatSignedPercent(topRole.audienceDelta)]] });
  else if (durations.length >= 2) items.push({ type: 'test', title: `Test ${durations[0].key} streams`, body: `This duration band currently leads your organic viewer average. Keep category and start time as stable as possible.`, math: [['Band average', formatNumber(durations[0].avgViewers,1)], ['Streams', String(durations[0].n)]] });
  else items.push({ type: 'test', title: 'Collect more comparable broadcasts', body: 'Wayfinder needs repeated conditions before it can separate a real pattern from normal stream-to-stream noise.', math: [['Minimum useful repeat signal', '3 streams'], ['Preferred confidence', '6+ streams']] });

  if (whatChanged) {
    const changed = whatChanged.changes.filter((x) => Number.isFinite(x.delta)).sort((a,b) => Math.abs(b.delta)-Math.abs(a.delta))[0];
    if (changed) items.push({ type: 'investigate', title: `Investigate ${changed.label.toLowerCase()}`, body: `This changed the most between the earlier and recent halves of your organic dataset.`, math: [['Earlier', formatNumber(changed.earlier,1)], ['Recent', formatNumber(changed.recent,1)], ['Change', changed.format === 'hourdiff' ? `${changed.delta >= 0 ? '+' : ''}${changed.delta.toFixed(1)}h` : formatSignedPercent(changed.delta)]] });
  }

  if (externalCount) items.push({ type: 'ignore', title: `Ignore ${externalCount} external-event stream${externalCount === 1 ? '' : 's'} when setting your organic baseline`, body: 'They stay visible for raid/retention analysis but do not drive schedule, duration or category recommendations.', math: [['External-event rows', String(externalCount)], ['Raw average', formatNumber(rawAnalysis.summary.avgViewers,1)], ['Organic baseline', formatNumber(organicAnalysis.summary.avgViewers,1)]] });
  return items.slice(0, 4);
}

function augmentInsights(organicAnalysis, rawAnalysis, rows, daySignals) {
  const insights = [...organicAnalysis.insights];
  const external = rows.filter((row) => row.confirmedExternal);
  if (external.length) {
    const impact = pctDelta(rawAnalysis.summary.avgViewers, organicAnalysis.summary.avgViewers);
    insights.unshift({
      kind: 'warning',
      title: 'External audience events are separated from your organic baseline',
      body: `${external.length} stream${external.length === 1 ? '' : 's'} are confirmed as raid/front-page/promotion influenced. Raw history stays intact while organic recommendations exclude those rows.`,
      confidence: 'High',
      math: [['Raw average viewers', formatNumber(rawAnalysis.summary.avgViewers,1)], ['Organic baseline', formatNumber(organicAnalysis.summary.avgViewers,1)], ['Baseline distortion', formatSignedPercent(impact)], ['Excluded from organic recommendations', String(external.length)]],
      recommendation: 'Use the raw stream to study raid conversion and retention, not to redefine your normal channel baseline.',
    });
  }
  const strongestControlled = daySignals.filter((x) => x.comparisons >= 3 && Number.isFinite(x.controlledDelta) && Math.abs(x.controlledDelta) >= 8).sort((a,b) => Math.abs(b.controlledDelta)-Math.abs(a.controlledDelta))[0];
  if (strongestControlled) insights.unshift({
    kind: strongestControlled.controlledDelta >= 0 ? 'positive' : 'warning',
    title: `${strongestControlled.key} survives a comparable-stream check`,
    body: `After weighting similar category, start-time, duration and collab conditions, ${strongestControlled.key} is estimated at ${formatSignedPercent(strongestControlled.controlledDelta)} versus comparable streams on other days.`,
    confidence: strongestControlled.confidence,
    math: [['Comparable comparisons', String(strongestControlled.comparisons)], ['Controlled difference', formatSignedPercent(strongestControlled.controlledDelta)], ['Similarity factors', 'Category + start time + duration + recency + collab']],
    recommendation: 'Treat this as stronger evidence than a simple day-of-week average, but still test it prospectively.',
  });
  return insights.slice(0, 6);
}



function evidenceLevel({ n = 0, effect = null, comparisons = 0, dataQuality = 100 } = {}) {
  const magnitude = Math.abs(Number(effect));
  if (n < 2 || !Number.isFinite(magnitude)) return 'Insufficient';
  if (n >= 6 && magnitude >= 10 && dataQuality >= 70 && (comparisons === 0 || comparisons >= 4)) return 'Strong';
  if (n >= 4 && magnitude >= 8 && dataQuality >= 60) return 'Moderate';
  if (n >= 2 && magnitude >= 5) return 'Early';
  return 'Weak';
}

function buildEvidenceLedger({ organicAnalysis, daySignals, categoryRoles, whatChanged, rows, health }) {
  const evidence = [];
  const unit = rows.length && rows.every((row) => row.dataGranularity === 'daily') ? 'days' : 'streams';

  for (const item of daySignals.filter((x) => Number.isFinite(x.controlledDelta))) {
    evidence.push({
      id: `day-${item.key}`,
      factor: 'Schedule',
      claim: `${item.key} vs comparable days`,
      effect: item.controlledDelta,
      samples: item.comparisons,
      evidence: evidenceLevel({ n: item.comparisons, effect: item.controlledDelta, comparisons: item.comparisons, dataQuality: health.score }),
      basis: `${item.comparisons} like-for-like comparison${item.comparisons === 1 ? '' : 's'} controlling for category, start time, duration, recency and collab context where available.`,
      actionability: Math.abs(item.controlledDelta) >= 8 ? 'Testable' : 'Watch',
    });
  }

  for (const item of categoryRoles.filter((x) => Number.isFinite(x.audienceDelta))) {
    evidence.push({
      id: `category-${item.key}`,
      factor: 'Category',
      claim: `${item.key} audience performance`,
      effect: item.audienceDelta,
      samples: item.n,
      evidence: evidenceLevel({ n: item.n, effect: item.audienceDelta, dataQuality: health.score }),
      basis: `${item.n} organic ${unit}; role: ${item.role}. Conversion and consistency are evaluated separately from reach.`,
      actionability: item.n >= 3 ? 'Testable' : 'Collect more',
    });
  }

  for (const item of organicAnalysis.byDuration.filter((x) => Number.isFinite(x.deltaAvgViewers))) {
    evidence.push({
      id: `duration-${item.key}`,
      factor: 'Duration',
      claim: `${item.key} duration performance`,
      effect: item.deltaAvgViewers,
      samples: item.n,
      evidence: evidenceLevel({ n: item.n, effect: item.deltaAvgViewers, dataQuality: health.score }),
      basis: `${item.n} organic ${unit} compared with your own organic viewer baseline.`,
      actionability: item.n >= 3 ? 'Testable' : 'Collect more',
    });
  }

  if (whatChanged) {
    const periodN = Math.min(whatChanged.earlier.n, whatChanged.recent.n);
    for (const item of whatChanged.changes.filter((x) => Number.isFinite(x.delta) && x.format !== 'hourdiff')) {
      evidence.push({
        id: `change-${item.label}`,
        factor: 'Recent change',
        claim: `${item.label} shifted`,
        effect: item.delta,
        samples: periodN,
        evidence: evidenceLevel({ n: periodN, effect: item.delta, dataQuality: health.score }),
        basis: `Earlier ${periodN} vs recent ${periodN} organic observations. This is association, not proof of cause.`,
        actionability: 'Investigate',
      });
    }
  }

  return evidence
    .filter((item) => item.evidence !== 'Weak' || Math.abs(item.effect) >= 8)
    .sort((a, b) => {
      const rank = { Strong: 4, Moderate: 3, Early: 2, Weak: 1, Insufficient: 0 };
      return (rank[b.evidence] - rank[a.evidence]) || (Math.abs(b.effect) - Math.abs(a.effect));
    })
    .slice(0, 12);
}

function buildDecisionBrief({ goal, rawAnalysis, organicAnalysis, rows, evidenceLedger, dataHealth, whatChanged }) {
  const external = rows.filter((row) => row.confirmedExternal).length;
  const unexplained = organicAnalysis.outliers.length;
  const strongest = evidenceLedger.find((item) => ['Strong', 'Moderate'].includes(item.evidence)) || evidenceLedger[0] || null;
  const audienceChange = whatChanged?.changes.find((item) => item.label === 'Average viewers')?.delta;
  const direction = !Number.isFinite(audienceChange) ? 'Not enough history' : audienceChange >= 8 ? 'Recent audience is up' : audienceChange <= -8 ? 'Recent audience is down' : 'Recent audience is stable';
  const goalNames = {
    overall: 'overall channel decisions', audience: 'audience growth', followers: 'follower growth', schedule: 'schedule decisions',
    categories: 'category decisions', efficiency: 'time efficiency', decline: 'understanding the decline', growth: 'understanding the growth',
  };
  let next = 'Collect a few more comparable observations before making a large change.';
  if (strongest) {
    if (strongest.actionability === 'Testable') next = `Run a controlled test around ${strongest.claim.toLowerCase()} rather than changing several variables at once.`;
    else if (strongest.actionability === 'Investigate') next = `Investigate ${strongest.claim.toLowerCase()} before changing your strategy; the shift is real enough to inspect but does not identify a cause.`;
    else next = `Keep watching ${strongest.claim.toLowerCase()} until the sample is stronger.`;
  }
  if (goal === 'decline' && Number.isFinite(audienceChange)) next = 'Compare the recent period with the earlier baseline and test the largest changed condition first.';
  if (goal === 'growth' && Number.isFinite(audienceChange)) next = 'Protect the conditions that stayed strong in comparable observations before expanding them.';
  return {
    goal: goalNames[goal] || goalNames.overall,
    direction,
    strongest,
    next,
    external,
    unexplained,
    health: dataHealth.rating,
    organicBaseline: organicAnalysis.summary.avgViewers,
    rawAverage: rawAnalysis.summary.avgViewers,
  };
}

function buildTestSuggestions({ organicAnalysis, daySignals, categoryRoles, rows }) {
  const suggestions = [];
  const dailyOnly = rows.length > 0 && rows.every((row) => row.dataGranularity === 'daily');

  const day = daySignals
    .filter((x) => x.comparisons >= 2 && Number.isFinite(x.controlledDelta) && Math.abs(x.controlledDelta) >= 8)
    .sort((a, b) => Math.abs(b.controlledDelta) - Math.abs(a.controlledDelta))[0];
  if (day) suggestions.push({
    id: `suggest-day-${day.key}`,
    title: `Verify the ${day.key} signal`,
    hypothesis: `${day.key} performs differently even when broadcasts are compared like-for-like.`,
    reason: `${formatSignedPercent(day.controlledDelta)} across ${day.comparisons} comparable checks.`,
    keepStable: 'Category, start time and duration as much as practical',
    minimum: Math.max(4, Math.min(8, 8 - Math.min(day.comparisons, 4))),
    experiment: null,
  });

  const duration = organicAnalysis.byDuration
    .filter((x) => x.n >= 2 && Number.isFinite(x.deltaAvgViewers) && Math.abs(x.deltaAvgViewers) >= 8)
    .sort((a, b) => Math.abs(b.deltaAvgViewers) - Math.abs(a.deltaAvgViewers))[0];
  if (duration) {
    const control = organicAnalysis.byDuration.filter((x) => x.key !== duration.key && x.n >= 2 && Number.isFinite(x.avgViewers)).sort((a,b) => Math.abs(a.deltaAvgViewers || 0) - Math.abs(b.deltaAvgViewers || 0))[0];
    suggestions.push({
      id: `suggest-duration-${duration.key}`,
      title: `Test ${duration.key} deliberately`,
      hypothesis: `${duration.key} ${duration.deltaAvgViewers >= 0 ? 'may outperform' : 'may underperform'} your normal duration mix.`,
      reason: `${formatSignedPercent(duration.deltaAvgViewers)} vs organic baseline across ${duration.n} observations.`,
      keepStable: 'Category, day and start time',
      minimum: 4,
      experiment: control ? { name: `${duration.key} duration test`, type: 'duration', control: control.key, test: duration.key, minimum: 4 } : null,
    });
  }

  if (!dailyOnly) {
    const category = categoryRoles
      .filter((x) => x.n >= 2 && x.n < 8 && Number.isFinite(x.audienceDelta) && Math.abs(x.audienceDelta) >= 10)
      .sort((a,b) => Math.abs(b.audienceDelta) - Math.abs(a.audienceDelta))[0];
    if (category) {
      const control = categoryRoles.filter((x) => x.key !== category.key && x.n >= 2).sort((a,b) => b.n-a.n)[0];
      suggestions.push({
        id: `suggest-category-${category.key}`,
        title: `Re-test ${category.key}`,
        hypothesis: `${category.key} has a meaningful early audience signal, but the sample is not yet large enough to treat as settled.`,
        reason: `${formatSignedPercent(category.audienceDelta)} audience delta across ${category.n} organic streams.`,
        keepStable: 'Start time, duration and collab status',
        minimum: 4,
        experiment: control ? { name: `${category.key} category test`, type: 'category', control: control.key, test: category.key, minimum: 4 } : null,
      });
    }
  }

  if (!suggestions.length) suggestions.push({
    id: 'suggest-baseline',
    title: 'Build a clean comparison set',
    hypothesis: 'A repeatable decision needs comparable observations, not just a high or low headline metric.',
    reason: 'No current factor has enough effect size and repeat observations to justify a specific experiment.',
    keepStable: 'Choose one variable to change and hold the rest as stable as practical',
    minimum: 4,
    experiment: null,
  });
  return suggestions.slice(0, 3);
}

function buildGuardrails({ organicAnalysis, rows, categoryRoles, daySignals }) {
  const items = [];
  const external = rows.filter((row) => row.confirmedExternal);
  if (external.length) items.push({
    type: 'external',
    title: `Don't optimize around ${external.length} confirmed external spike${external.length === 1 ? '' : 's'}`,
    body: 'Raids, features and external promotions stay useful for retention analysis, but they do not redefine your normal baseline.',
  });
  if (organicAnalysis.outliers.length) items.push({
    type: 'outlier',
    title: `Review ${organicAnalysis.outliers.length} unexplained outlier${organicAnalysis.outliers.length === 1 ? '' : 's'} before reacting`,
    body: 'Wayfinder found unusual organic-looking values but does not know the cause. Add context before using them to change your strategy.',
  });
  const thinCategory = [...categoryRoles].sort((a,b) => (b.avgViewers || 0) - (a.avgViewers || 0)).find((x) => x.n < 3);
  if (thinCategory) items.push({
    type: 'sample',
    title: `Don't call ${thinCategory.key} your “best category” yet`,
    body: `It currently has only ${thinCategory.n} qualifying observation${thinCategory.n === 1 ? '' : 's'}. A standout result is a lead to test, not a conclusion.`,
  });
  const weakDay = daySignals.find((x) => x.comparisons < 3 && Math.abs(x.controlledDelta || 0) >= 10);
  if (weakDay) items.push({
    type: 'sample',
    title: `Don't rebuild your schedule around ${weakDay.key} yet`,
    body: `The difference is interesting, but only ${weakDay.comparisons} comparable checks support it so far.`,
  });
  if (!items.length) items.push({
    type: 'stable',
    title: 'No obvious trap is dominating this dataset',
    body: 'Keep changes small and measurable. Wayfinder will surface a guardrail when a spike, thin sample or missing context makes a conclusion unsafe.',
  });
  return items.slice(0, 4);
}

export function evaluateExperiment(experiment, rows) {
  const organic = rows.filter((row) => !row.confirmedExternal && isDecisionObservation(row));
  const match = (row, value) => {
    if (experiment.type === 'category') return String(row.category || '').toLowerCase() === String(value).toLowerCase();
    if (experiment.type === 'duration') return durationBand(row) === value;
    if (experiment.type === 'start') {
      const hour = Number(value); const actual = startHour(row);
      return Number.isFinite(hour) && Number.isFinite(actual) && Math.abs(actual - hour) <= 1;
    }
    return false;
  };
  const control = organic.filter((row) => match(row, experiment.control));
  const test = organic.filter((row) => match(row, experiment.test));
  const c = analyzeRows(control).summary; const t = analyzeRows(test).summary;
  const primary = pctDelta(t.avgViewers, c.avgViewers);
  return {
    ...experiment, controlN: control.length, testN: test.length,
    controlAvg: c.avgViewers, testAvg: t.avgViewers,
    controlFollowersPerHour: c.followersPerHour, testFollowersPerHour: t.followersPerHour,
    delta: primary,
    ready: control.length >= experiment.minimum && test.length >= experiment.minimum,
    confidence: confidenceForCount(Math.min(control.length, test.length)),
  };
}

export function buildIntelligence(inputRows, { contexts = {}, events = [], goal = 'overall', experiments = [] } = {}) {
  const enrichedRows = attachRaidEvents(inputRows, events, contexts);
  const decisionRows = enrichedRows.filter(isDecisionObservation);
  const inactiveDailyRows = enrichedRows.length - decisionRows.length;
  const rawAnalysis = analyzeRows(decisionRows);
  const organicRows = decisionRows.filter((row) => !row.confirmedExternal);
  const organicAnalysis = analyzeRows(organicRows);
  const daySignals = buildComparableDaySignals(organicRows);
  const categoryRoles = buildCategoryRoles(organicAnalysis);
  const dataHealth = buildDataHealth(decisionRows);
  const whatChanged = buildWhatChanged(decisionRows);
  const raidRetention = buildRaidRetention(decisionRows);
  const audienceQuality = buildAudienceQuality(organicRows);
  const scorecard = buildScorecard(rawAnalysis, organicAnalysis, whatChanged, dataHealth);
  const flightPlan = buildFlightPlan({ goal, organicAnalysis, rawAnalysis, daySignals, categoryRoles, whatChanged, rows: decisionRows });
  const insights = augmentInsights(organicAnalysis, rawAnalysis, decisionRows, daySignals);
  const evidenceLedger = buildEvidenceLedger({ organicAnalysis, daySignals, categoryRoles, whatChanged, rows: decisionRows, health: dataHealth });
  const decisionBrief = buildDecisionBrief({ goal, rawAnalysis, organicAnalysis, rows: decisionRows, evidenceLedger, dataHealth, whatChanged });
  const testSuggestions = buildTestSuggestions({ organicAnalysis, daySignals, categoryRoles, rows: decisionRows });
  const guardrails = buildGuardrails({ organicAnalysis, rows: decisionRows, categoryRoles, daySignals });
  const evaluatedExperiments = experiments.map((experiment) => evaluateExperiment(experiment, decisionRows));
  return {
    rows: enrichedRows,
    decisionRows,
    inactiveDailyRows,
    externalInfluenceThresholdPct: MATERIAL_HOST_RAID_PCT,
    rawAnalysis,
    organicAnalysis,
    daySignals,
    categoryRoles,
    dataHealth,
    whatChanged,
    raidRetention,
    audienceQuality,
    scorecard,
    flightPlan,
    insights,
    evidenceLedger,
    decisionBrief,
    testSuggestions,
    guardrails,
    experiments: evaluatedExperiments,
  };
}
