import { APP_CONFIG } from './config.js';

const DAY_ORDER = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function finite(values) {
  return values.filter((value) => Number.isFinite(value));
}

function sum(values) {
  return finite(values).reduce((total, value) => total + value, 0);
}

function avg(values) {
  const list = finite(values);
  return list.length ? sum(list) / list.length : null;
}

function weightedAverage(rows, valueKey, weightKey) {
  const usable = rows.filter((row) => Number.isFinite(row[valueKey]) && Number.isFinite(row[weightKey]) && row[weightKey] > 0);
  if (!usable.length) return avg(rows.map((row) => row[valueKey]));
  const weight = sum(usable.map((row) => row[weightKey]));
  return weight ? sum(usable.map((row) => row[valueKey] * row[weightKey])) / weight : null;
}

function pctDelta(value, baseline) {
  if (!Number.isFinite(value) || !Number.isFinite(baseline) || baseline === 0) return null;
  return ((value - baseline) / baseline) * 100;
}

function confidence(n) {
  if (n >= APP_CONFIG.confidence.high) return 'High';
  if (n >= APP_CONFIG.confidence.medium) return 'Medium';
  if (n >= APP_CONFIG.confidence.early) return 'Early signal';
  return 'Insufficient';
}

function groupBy(rows, getKey) {
  const map = new Map();
  rows.forEach((row) => {
    const key = getKey(row);
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  });
  return map;
}

function metricForGroup(key, rows, overallAvg) {
  const hours = sum(rows.map((row) => row.durationMinutes)) / 60;
  const averageViewers = weightedAverage(rows, 'avgViewers', 'durationMinutes');
  const followers = sum(rows.map((row) => row.followersGained));
  return {
    key,
    n: rows.length,
    hours,
    avgViewers: averageViewers,
    followers,
    followersPerHour: hours > 0 ? followers / hours : null,
    deltaAvgViewers: pctDelta(averageViewers, overallAvg),
    confidence: confidence(rows.length),
  };
}

function quartile(sorted, q) {
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * q;
  const base = Math.floor(position);
  const rest = position - base;
  return sorted[base + 1] !== undefined ? sorted[base] + rest * (sorted[base + 1] - sorted[base]) : sorted[base];
}

function findOutliers(rows) {
  const values = finite(rows.map((row) => row.avgViewers)).sort((a, b) => a - b);
  if (values.length < 4) return [];
  const q1 = quartile(values, 0.25);
  const q3 = quartile(values, 0.75);
  const iqr = q3 - q1;
  const low = q1 - 1.5 * iqr;
  const high = q3 + 1.5 * iqr;
  return rows.filter((row) => Number.isFinite(row.avgViewers) && (row.avgViewers < low || row.avgViewers > high)).map((row) => ({ ...row, outlierDirection: row.avgViewers > high ? 'high' : 'low' }));
}

function durationBucket(row) {
  const hours = Number.isFinite(row.durationMinutes) ? row.durationMinutes / 60 : null;
  if (hours == null) return null;
  if (hours < 2) return '< 2h';
  if (hours < 3) return '2–3h';
  if (hours < 4) return '3–4h';
  if (hours < 5) return '4–5h';
  return '5h+';
}

function buildInsights({ rows, summary, byDay, byDuration, byCategory, outliers }) {
  const insights = [];
  const eligibleDay = byDay.filter((item) => item.n >= 3 && Number.isFinite(item.avgViewers)).sort((a, b) => b.avgViewers - a.avgViewers)[0];
  if (eligibleDay && Number.isFinite(eligibleDay.deltaAvgViewers) && Math.abs(eligibleDay.deltaAvgViewers) >= 8) {
    const direction = eligibleDay.deltaAvgViewers >= 0 ? 'outperforming' : 'underperforming';
    insights.push({
      kind: eligibleDay.deltaAvgViewers >= 0 ? 'positive' : 'warning',
      title: `${eligibleDay.key} is ${direction} your baseline`,
      body: `${eligibleDay.key} streams average ${formatNumber(eligibleDay.avgViewers, 1)} viewers, ${formatSignedPercent(eligibleDay.deltaAvgViewers)} versus your weighted channel baseline.`,
      confidence: eligibleDay.confidence,
      math: [
        ['Channel baseline', formatNumber(summary.avgViewers, 1)],
        [`${eligibleDay.key} average`, formatNumber(eligibleDay.avgViewers, 1)],
        ['Qualifying rows', String(eligibleDay.n)],
        ['Difference', formatSignedPercent(eligibleDay.deltaAvgViewers)],
      ],
      recommendation: `Keep ${eligibleDay.key} conditions stable for a few more comparable streams before changing multiple variables at once.`,
    });
  }

  const eligibleDurations = byDuration.filter((item) => item.n >= 3 && Number.isFinite(item.avgViewers));
  if (eligibleDurations.length >= 2) {
    const sorted = [...eligibleDurations].sort((a, b) => b.avgViewers - a.avgViewers);
    const best = sorted[0];
    const worst = sorted.at(-1);
    const difference = pctDelta(best.avgViewers, worst.avgViewers);
    if (Number.isFinite(difference) && difference >= 10) {
      insights.push({
        kind: 'neutral',
        title: `${best.key} streams are your strongest duration band`,
        body: `Streams in the ${best.key} band average ${formatNumber(best.avgViewers, 1)} viewers versus ${formatNumber(worst.avgViewers, 1)} in ${worst.key}.`,
        confidence: confidence(Math.min(best.n, worst.n)),
        math: [
          [`${best.key} average`, formatNumber(best.avgViewers, 1)],
          [`${worst.key} average`, formatNumber(worst.avgViewers, 1)],
          ['Relative difference', formatSignedPercent(difference)],
          ['Samples compared', `${best.n} vs ${worst.n}`],
        ],
        recommendation: `Test the ${best.key} range with similar categories and start times to see whether the duration effect holds.`,
      });
    }
  }

  const eligibleCategories = byCategory.filter((item) => item.n >= 3);
  const conversionCategories = eligibleCategories.filter((item) => Number.isFinite(item.followersPerHour)).sort((a, b) => b.followersPerHour - a.followersPerHour);
  if (conversionCategories.length >= 2) {
    const best = conversionCategories[0];
    const second = conversionCategories[1];
    const delta = pctDelta(best.followersPerHour, second.followersPerHour);
    if (Number.isFinite(delta) && delta >= 10) {
      insights.push({
        kind: 'positive',
        title: `${best.key} converts followers efficiently`,
        body: `${best.key} generated ${formatNumber(best.followersPerHour, 2)} followers per stream-hour in this dataset.`,
        confidence: best.confidence,
        math: [
          ['Followers', formatNumber(best.followers, 0)],
          ['Hours streamed', formatNumber(best.hours, 1)],
          ['Followers/hour', formatNumber(best.followersPerHour, 2)],
          ['Qualifying rows', String(best.n)],
        ],
        recommendation: `Treat this as a conversion signal, not proof that the category caused the growth. Re-test under similar conditions.`,
      });
    }
  }

  if (outliers.length) {
    const high = outliers.filter((row) => row.outlierDirection === 'high').length;
    insights.push({
      kind: 'warning',
      title: `${outliers.length} viewer outlier${outliers.length === 1 ? '' : 's'} detected`,
      body: `${high} unusually high stream${high === 1 ? '' : 's'} may distort simple averages. Wayfinder keeps them visible instead of silently deleting them.`,
      confidence: rows.length >= 6 ? 'High' : 'Early signal',
      math: [
        ['Rows analyzed', String(rows.length)],
        ['Outliers detected', String(outliers.length)],
        ['High outliers', String(high)],
        ['Method', '1.5× IQR'],
      ],
      recommendation: 'Review outlier streams for raids, special events, collabs, or unusual categories before treating them as a repeatable baseline.',
    });
  }

  if (rows.length >= 6 && rows.filter((row) => row.date && Number.isFinite(row.avgViewers)).length >= 6) {
    const chronological = rows.filter((row) => row.date && Number.isFinite(row.avgViewers)).sort((a, b) => a.date - b.date);
    const midpoint = Math.floor(chronological.length / 2);
    const earlier = chronological.slice(0, midpoint);
    const later = chronological.slice(midpoint);
    const earlierAvg = weightedAverage(earlier, 'avgViewers', 'durationMinutes');
    const laterAvg = weightedAverage(later, 'avgViewers', 'durationMinutes');
    const delta = pctDelta(laterAvg, earlierAvg);
    if (Number.isFinite(delta) && Math.abs(delta) >= 8) {
      insights.push({
        kind: delta > 0 ? 'positive' : 'warning',
        title: delta > 0 ? 'Your recent viewer baseline is trending upward' : 'Your recent viewer baseline is trending downward',
        body: `The newer half of this dataset averages ${formatNumber(laterAvg, 1)} viewers versus ${formatNumber(earlierAvg, 1)} in the earlier half.`,
        confidence: confidence(Math.min(earlier.length, later.length)),
        math: [
          ['Earlier-half average', formatNumber(earlierAvg, 1)],
          ['Recent-half average', formatNumber(laterAvg, 1)],
          ['Difference', formatSignedPercent(delta)],
          ['Rows compared', `${earlier.length} vs ${later.length}`],
        ],
        recommendation: delta > 0 ? 'Identify what changed between the two periods and test one likely factor at a time.' : 'Compare schedule, categories, duration, and outliers between the two periods before making major changes.',
      });
    }
  }

  if (!insights.length) {
    insights.push({
      kind: 'neutral',
      title: 'Not enough repeated evidence yet',
      body: 'The file was analyzed successfully, but no pattern cleared the minimum sample and effect thresholds for a useful recommendation.',
      confidence: 'Insufficient',
      math: [['Rows analyzed', String(rows.length)], ['Minimum repeat signal', '3 comparable rows'], ['Rule', 'No invented conclusions']],
      recommendation: 'Keep collecting comparable streams. Wayfinder will surface a signal when the data supports one.',
    });
  }

  return insights.slice(0, 5);
}

export function analyzeRows(inputRows) {
  const rows = inputRows.filter((row) => Object.values(row).some((value) => value !== null && value !== '' && value !== undefined));
  const totalMinutes = sum(rows.map((row) => row.durationMinutes));
  const totalHours = totalMinutes / 60;
  const totalFollowers = sum(rows.map((row) => row.followersGained));
  const totalMinutesWatched = sum(rows.map((row) => row.minutesWatched));
  const avgViewers = weightedAverage(rows, 'avgViewers', 'durationMinutes');

  const summary = {
    rows: rows.length,
    datedRows: rows.filter((row) => row.date).length,
    totalHours,
    avgViewers,
    peakViewers: finite(rows.map((row) => row.peakViewers)).length ? Math.max(...finite(rows.map((row) => row.peakViewers))) : null,
    totalFollowers,
    followersPerHour: totalHours > 0 ? totalFollowers / totalHours : null,
    totalWatchHours: totalMinutesWatched > 0 ? totalMinutesWatched / 60 : (Number.isFinite(avgViewers) ? avgViewers * totalHours : null),
    totalUniqueViewers: sum(rows.map((row) => row.uniqueViewers)),
  };

  const byDay = [...groupBy(rows, (row) => row.date ? DAY_ORDER[row.date.getDay()] : null)]
    .map(([key, grouped]) => metricForGroup(key, grouped, avgViewers))
    .sort((a, b) => DAY_ORDER.indexOf(a.key) - DAY_ORDER.indexOf(b.key));

  const durationOrder = ['< 2h', '2–3h', '3–4h', '4–5h', '5h+'];
  const byDuration = [...groupBy(rows, durationBucket)]
    .map(([key, grouped]) => metricForGroup(key, grouped, avgViewers))
    .sort((a, b) => durationOrder.indexOf(a.key) - durationOrder.indexOf(b.key));

  const byCategory = [...groupBy(rows, (row) => row.category || null)]
    .map(([key, grouped]) => metricForGroup(key, grouped, avgViewers))
    .sort((a, b) => (b.avgViewers ?? -Infinity) - (a.avgViewers ?? -Infinity));

  const outliers = findOutliers(rows);
  const insights = buildInsights({ rows, summary, byDay, byDuration, byCategory, outliers });

  return { rows, summary, byDay, byDuration, byCategory, outliers, insights };
}

export function formatNumber(value, digits = 1) {
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value);
}

export function formatSignedPercent(value) {
  if (!Number.isFinite(value)) return '—';
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
}

export function confidenceForCount(n) {
  return confidence(n);
}
