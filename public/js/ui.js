import { formatNumber, formatSignedPercent } from './analytics.js';
import { comparableStreams } from './intelligence.js';

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

export function setBusy(show, label = 'Working…') {
  const busy = document.querySelector('#busy');
  busy.hidden = !show;
  document.querySelector('#busy-label').textContent = label;
}

export function toast(message, kind = '') {
  const root = document.querySelector('#toasts');
  const node = document.createElement('div');
  node.className = `toast ${kind}`;
  node.textContent = message;
  root.appendChild(node);
  setTimeout(() => node.remove(), 4500);
}

export function renderAuth(session) {
  const button = document.querySelector('#twitch-connect');
  const details = document.querySelector('#auth-details');
  const title = document.querySelector('#auth-title');
  const copy = document.querySelector('#auth-copy');
  if (session?.connected) {
    button.textContent = 'Disconnect Twitch';
    button.dataset.connected = 'true';
    button.setAttribute('href', '#');
    title.textContent = `Connected as ${session.user.displayName || session.user.login}`;
    copy.textContent = 'Wayfinder uses Twitch OIDC for sign-in, stores no Twitch user access or refresh token, and uses a server-side app token for supported public channel context. Future EventSub raid context is available when EventSub persistence is configured.';
    details.innerHTML = `<span class="status-dot ok"></span><div><strong>${escapeHtml(session.user.login)}</strong><small>${(session.scopes || []).length ? `${session.scopes.length} authorized scope(s)` : 'No additional OAuth scopes requested'}</small></div>`;
  } else {
    button.textContent = 'Connect Twitch';
    button.dataset.connected = 'false';
    button.setAttribute('href', '/api/auth/login');
    title.textContent = 'Twitch connection is optional';
    copy.textContent = 'Connect your own Twitch account for supported VOD/clip metadata and verified EventSub context. Schedule data is treated only as planned context, never as proof of historical performance.';
    details.innerHTML = '<span class="status-dot idle"></span><strong>Not connected</strong>';
  }
}

export function renderMetrics(intelligence) {
  const raw = intelligence.rawAnalysis.summary;
  const daily = intelligence.rows.length > 0 && intelligence.rows.every((row) => row.dataGranularity === 'daily');
  const organic = intelligence.organicAnalysis.summary;
  const externalCount = intelligence.rows.filter((row) => row.confirmedExternal).length;
  const metrics = [
    ['Organic baseline', formatNumber(organic.avgViewers, 1), 'raid/front-page/promo adjusted'],
    ['Raw avg viewers', formatNumber(raw.avgViewers, 1), `${externalCount} external-event row${externalCount === 1 ? '' : 's'}`],
    ['Peak viewers', formatNumber(raw.peakViewers, 0), 'raw history'],
    ['Followers / hour', formatNumber(organic.followersPerHour, 2), 'organic streams'],
    [daily ? 'Hours streamed' : 'Stream hours', formatNumber(raw.totalHours, 1), daily ? `${raw.rows} active days used · ${intelligence.inactiveDailyRows || 0} inactive calendar days excluded` : `${raw.rows} streams analyzed`],
  ];
  return metrics.map(([label, value, note]) => `<article class="metric-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(note)}</small></article>`).join('');
}

export function renderBaselineCallout(intelligence) {
  const raw = intelligence.rawAnalysis.summary.avgViewers;
  const organic = intelligence.organicAnalysis.summary.avgViewers;
  const affected = intelligence.rows.filter((row) => row.confirmedExternal);
  const delta = Number.isFinite(raw) && Number.isFinite(organic) && organic ? ((raw - organic) / organic) * 100 : null;
  if (!affected.length) return `<div><span class="eyebrow">BASELINE STATUS</span><strong>No confirmed external audience events are currently excluded.</strong><p>High statistical outliers are still flagged for review, but Wayfinder does not guess that an unexplained spike was a raid.</p></div>`;
  return `<div><span class="eyebrow">RAID-ADJUSTED BASELINE</span><strong>${formatNumber(organic,1)} typical vs ${formatNumber(raw,1)} raw average</strong><p>${affected.length} confirmed externally influenced stream${affected.length === 1 ? '' : 's'} remain in history but are excluded from organic pattern recommendations${Number.isFinite(delta) ? `, changing the baseline by ${formatSignedPercent(delta)}` : ''}.</p></div>`;
}

function planLabel(type) {
  return ({ protect: 'PROTECT', test: 'TEST', investigate: 'INVESTIGATE', ignore: 'IGNORE' })[type] || 'NEXT';
}

export function renderFlightPlan(items) {
  return items.map((item, index) => `<article class="flight-card ${item.type}"><span>${planLabel(item.type)}</span><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.body)}</p><button type="button" class="ghost-button flight-math" data-index="${index}">Show the math</button></article>`).join('');
}

function confidenceBadge(value) {
  return `<span class="confidence ${String(value || '').toLowerCase().replace(/\s+/g, '-')}">${escapeHtml(value || 'Unknown')}</span>`;
}

export function renderInsights(insights) {
  return insights.map((insight, index) => `<article class="insight-card ${insight.kind}">
    <div class="insight-top"><span class="insight-index">0${index + 1}</span>${confidenceBadge(insight.confidence)}</div>
    <h3>${escapeHtml(insight.title)}</h3><p>${escapeHtml(insight.body)}</p>
    <div class="recommendation"><span>TEST NEXT</span>${escapeHtml(insight.recommendation)}</div>
    <button class="ghost-button math-button" type="button" data-index="${index}">Show the math</button>
  </article>`).join('');
}

export function renderScorecard(items) {
  return items.map((item) => `<article class="score-card"><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.value)}</strong><small>${escapeHtml(item.detail)}</small></article>`).join('');
}

export function renderBars(items, valueKey, suffix = '', unit = 'streams') {
  if (!items?.length) return '<p class="muted">Not enough usable data.</p>';
  const max = Math.max(...items.map((item) => Number(item[valueKey]) || 0), 1);
  return items.map((item) => {
    const value = Number(item[valueKey]);
    const width = Number.isFinite(value) ? Math.max(2, (value / max) * 100) : 0;
    return `<div class="bar-row"><div class="bar-label"><span>${escapeHtml(item.key)}</span><small>${item.n} ${escapeHtml(unit)} · ${escapeHtml(item.confidence || '')}</small></div><div class="bar-track"><div class="bar-fill" style="width:${width}%"></div></div><div class="bar-value">${Number.isFinite(value) ? `${formatNumber(value, valueKey === 'followersPerHour' ? 2 : 1)}${suffix}` : '—'}</div></div>`;
  }).join('');
}

export function renderCategoryRoles(items, options = {}) {
  if (!items.length) {
    const daily = Boolean(options.daily);
    const title = daily ? 'Category roles are unavailable for this daily export' : 'No supported historical category data was found';
    const body = daily
      ? 'This Twitch CSV is aggregated by day and does not provide a supported category field. Wayfinder will not use the channel’s current category or a VOD title as proof of what was streamed historically.'
      : 'Wayfinder needs a supported category/game field tied to the analyzed observations before it can compare category performance.';
    const next = daily
      ? 'For category decisions, use a Twitch export that includes category/game data or let Wayfinder collect prospective Twitch EventSub context for future broadcasts.'
      : 'Upload a Twitch export with category/game data, then Wayfinder can compare reach, follower conversion, consistency, and sample size by category.';
    return `<article class="data-gap-card"><span>DATA GAP</span><h3>${escapeHtml(title)}</h3><p>${escapeHtml(body)}</p><strong>What to do</strong><p>${escapeHtml(next)}</p></article>`;
  }
  return items.map((item) => `<article class="role-card"><span>${escapeHtml(item.role)}</span><h3>${escapeHtml(item.key)}</h3><div class="role-stats"><div><small>Audience</small><strong>${formatSignedPercent(item.audienceDelta)}</strong></div><div><small>Conversion</small><strong>${formatSignedPercent(item.conversionDelta)}</strong></div><div><small>Consistency</small><strong>${Number.isFinite(item.consistency) ? `${formatNumber(item.consistency,0)}%` : '—'}</strong></div><div><small>Streams</small><strong>${item.n}</strong></div></div></article>`).join('');
}

function contextSummary(row) {
  const labels = [];
  if (row.raidEvents?.length) labels.push(`Raid ${row.raidViewers ? `(${row.raidViewers})` : ''}`);
  if (row.context?.raid && !row.raidEvents?.length) labels.push('Raid');
  if (row.context?.frontPage) labels.push('Feature');
  if (row.context?.promotion) labels.push('Promotion');
  if (row.context?.collab) labels.push('Collab');
  if (row.context?.technical) labels.push('Tech issue');
  return labels.join(' · ') || 'None';
}

export function renderStreams(rows) {
  const sorted = [...rows].sort((a, b) => (b.date?.getTime?.() || 0) - (a.date?.getTime?.() || 0));
  return sorted.map((row) => {
    const date = row.date ? row.date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: row.dateHasTime ? 'short' : undefined }) : `CSV row ${row.sourceIndex}`;
    const comp = comparableStreams(row, rows, 4);
    const fph = Number.isFinite(followersPerHourUi(row)) ? formatNumber(followersPerHourUi(row), 2) : '—';
    return `<tr class="${row.confirmedExternal ? 'external-row' : ''}">
      <td><strong>${escapeHtml(date)}</strong>${row.title ? `<small>${escapeHtml(row.title)}</small>` : ''}</td>
      <td>${escapeHtml(row.category || '—')}${row.twitchObserved?.categories?.length ? `<small>Observed update: ${escapeHtml(row.twitchObserved.categories.join(' → '))}</small>` : ''}${row.twitch?.vodId ? `<small>${row.twitch.matchMethod === 'eventsub-stream-id' ? 'Exact Twitch session/VOD match' : `Twitch VOD match ${row.twitch.matchConfidence}%`}</small>` : ''}</td><td>${formatNumber(row.avgViewers,1)}</td><td>${formatNumber(row.peakViewers,0)}</td><td>${fph}</td>
      <td>${row.dataGranularity === 'daily' && (!Number.isFinite(row.durationMinutes) || row.durationMinutes <= 0) ? '<span class="source-pill idle">Not live</span><small>Excluded from performance decisions</small>' : row.confirmedExternal ? `<span class="source-pill external">External</span><small>${escapeHtml(row.externalReasons.join(' · '))}</small>` : '<span class="source-pill csv">Organic</span>'}</td>
      <td><strong>${comp.length}</strong><small>${comp.length ? `best score ${comp[0].score}/100` : 'no close matches'}</small></td>
      <td><button type="button" class="ghost-button context-button" data-row-id="${escapeHtml(row.id)}">Edit</button><small>${escapeHtml(contextSummary(row))}</small></td>
    </tr>`;
  }).join('');
}

function followersPerHourUi(row) {
  return Number.isFinite(row.followersGained) && Number.isFinite(row.durationMinutes) && row.durationMinutes > 0 ? row.followersGained / (row.durationMinutes / 60) : null;
}

export function renderChangeGrid(change) {
  if (!change) return '<article class="panel"><p class="muted">Wayfinder needs at least six dated organic streams to compare periods.</p></article>';
  return change.changes.map((item) => {
    let earlier = formatNumber(item.earlier, 1); let recent = formatNumber(item.recent, 1); let delta = formatSignedPercent(item.delta);
    if (item.format === 'minutes') { earlier = Number.isFinite(item.earlier) ? `${formatNumber(item.earlier/60,1)}h` : '—'; recent = Number.isFinite(item.recent) ? `${formatNumber(item.recent/60,1)}h` : '—'; }
    if (item.format === 'hourdiff') delta = Number.isFinite(item.delta) ? `${item.delta >= 0 ? '+' : ''}${item.delta.toFixed(1)}h` : '—';
    if (item.format === 'number2') { earlier = formatNumber(item.earlier,2); recent = formatNumber(item.recent,2); }
    return `<article class="change-card"><span>${escapeHtml(item.label)}</span><div><strong>${earlier}</strong><b>→</b><strong>${recent}</strong></div><small>${delta}</small></article>`;
  }).join('');
}

export function renderRaidRetention(items) {
  if (!items.length) return '<article class="panel"><p class="muted">No confirmed raid has enough before/after data yet. EventSub can only capture raids after it is configured and subscribed.</p></article>';
  return items.map((item) => `<article class="raid-card"><span>${item.date.toLocaleDateString()}</span><h3>${item.raidViewers ? `${formatNumber(item.raidViewers,0)}-viewer raid` : 'Confirmed raid'}</h3><div class="raid-flow"><div><small>Pre-raid baseline</small><strong>${formatNumber(item.beforeAvg,1)}</strong></div><b>→</b><div><small>Next ${item.afterN} streams</small><strong>${formatNumber(item.afterAvg,1)}</strong></div></div><p>${Number.isFinite(item.delta) ? `${formatSignedPercent(item.delta)} post-raid audience signal` : 'Not enough data'} · ${escapeHtml(item.confidence)}</p></article>`).join('');
}

export function renderHealth(health) {
  return `<article class="health-summary"><span>${escapeHtml(health.rating)}</span><strong>${formatNumber(health.score,0)}%</strong><small>core field completeness · ${health.rows} rows</small></article>` + health.metrics.map((item) => `<article class="health-item"><span>${escapeHtml(item.label)}</span><strong>${formatNumber(item.pct,0)}%</strong><div class="health-track"><i style="width:${Math.max(0, Math.min(100,item.pct))}%"></i></div></article>`).join('');
}

export function renderExperiments(items) {
  if (!items.length) return '<article class="panel"><p class="muted">No experiments yet. Create one to compare a start hour, duration band, or category while Wayfinder excludes confirmed external-event streams.</p></article>';
  return items.map((item) => `<article class="experiment-card"><div class="experiment-head"><div><span>${escapeHtml(item.type.toUpperCase())}</span><h3>${escapeHtml(item.name)}</h3></div>${confidenceBadge(item.confidence)}</div><div class="experiment-sides"><div><small>CONTROL · ${escapeHtml(item.control)}</small><strong>${formatNumber(item.controlAvg,1)}</strong><span>${item.controlN} streams</span></div><div><small>TEST · ${escapeHtml(item.test)}</small><strong>${formatNumber(item.testAvg,1)}</strong><span>${item.testN} streams</span></div></div><p>${item.ready ? `Current audience signal: ${formatSignedPercent(item.delta)}.` : `Keep collecting data. Need ${item.minimum} streams per side.`}</p><button class="text-button delete-experiment" type="button" data-id="${escapeHtml(item.id)}">Delete</button></article>`).join('');
}

export function sourceStatus(id, state, label, detail) {
  const node = document.querySelector(id);
  if (!node) return;
  node.className = `source-status ${state}`;
  node.querySelector('strong').textContent = label;
  if (detail) node.querySelector('small').textContent = detail;
}

export function showMathModal(item) {
  const modal = document.querySelector('#math-modal');
  modal.querySelector('[data-modal-title]').textContent = item.title || 'Calculation';
  modal.querySelector('[data-modal-body]').innerHTML = (item.math || []).map(([label, value]) => `<div class="math-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('');
  modal.showModal();
}

export function renderDecisionBrief(brief) {
  if (!brief) return '';
  const strongest = brief.strongest;
  return `<article class="decision-brief">
    <div class="decision-brief-main">
      <span class="eyebrow">WAYFINDER BRIEF</span>
      <h2>${escapeHtml(brief.direction)}</h2>
      <p>Current priority: <strong>${escapeHtml(brief.goal)}</strong>.</p>
      <div class="decision-directive do"><small>DO NOW</small><strong>${escapeHtml(brief.next)}</strong></div>
      <div class="decision-directive avoid"><small>DO NOT</small><strong>${escapeHtml(brief.avoid || 'Do not change several variables at once. Verify one signal before rebuilding your strategy.')}</strong></div>
    </div>
    <div class="decision-brief-grid">
      <div><small>STRONGEST EVIDENCE</small><strong>${strongest ? escapeHtml(strongest.claim) : 'Not enough yet'}</strong><span>${strongest ? `${escapeHtml(strongest.evidence)} evidence · ${formatSignedPercent(strongest.effect)}` : 'Keep collecting comparable data'}</span></div>
      <div><small>BASELINE</small><strong>${formatNumber(brief.organicBaseline, 1)} organic</strong><span>${formatNumber(brief.rawAverage, 1)} raw · ${brief.external} confirmed external event${brief.external === 1 ? '' : 's'}</span></div>
      <div><small>UNCERTAINTY</small><strong>${brief.unexplained} unexplained outlier${brief.unexplained === 1 ? '' : 's'}</strong><span>Dataset health: ${escapeHtml(brief.health)}</span></div>
    </div>
  </article>`;
}

export function renderEvidenceLedger(items) {
  if (!items?.length) return '<article class="panel"><p class="muted">No claim has enough repeat evidence yet. Wayfinder will not promote a one-off result into a recommendation.</p></article>';
  return items.map((item) => `<article class="evidence-card">
    <div class="evidence-card-top"><span>${escapeHtml(item.factor)}</span><span class="evidence-level ${String(item.evidence).toLowerCase()}">${escapeHtml(item.evidence)}</span></div>
    <h3>${escapeHtml(item.claim)}</h3>
    <div class="evidence-effect">${formatSignedPercent(item.effect)}</div>
    <p>${escapeHtml(item.basis)}</p>
    <small>${escapeHtml(item.actionability)} · ${item.samples} supporting observation${item.samples === 1 ? '' : 's'}</small>
  </article>`).join('');
}

export function renderTestSuggestions(items) {
  if (!items?.length) return '';
  return items.map((item, index) => `<article class="test-suggestion">
    <span class="eyebrow">HYPOTHESIS ${String(index + 1).padStart(2, '0')}</span>
    <h3>${escapeHtml(item.title)}</h3>
    <p>${escapeHtml(item.hypothesis)}</p>
    <dl><div><dt>Why now</dt><dd>${escapeHtml(item.reason)}</dd></div><div><dt>Keep stable</dt><dd>${escapeHtml(item.keepStable)}</dd></div><div><dt>Minimum</dt><dd>${item.minimum} observations per side</dd></div></dl>
    ${item.experiment ? `<button class="ghost-button seed-experiment" type="button" data-index="${index}">Set up this experiment</button>` : ''}
  </article>`).join('');
}

export function renderGuardrails(items) {
  if (!items?.length) return '';
  return items.map((item) => `<article class="guardrail-card ${escapeHtml(item.type)}"><span>DO NOT OVERREACT</span><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.body)}</p></article>`).join('');
}

export function renderAudienceQuality(items) {
  if (!items?.length) return '<article class="panel"><p class="muted">This dataset does not yet contain enough engaged-viewer, chat, or clip fields for an audience-composition comparison.</p></article>';
  return items.map((item) => {
    const format = (value) => item.mode === 'points' ? `${formatNumber(value, 1)}%` : formatNumber(value, 2);
    const change = item.mode === 'points'
      ? (Number.isFinite(item.delta) ? `${item.delta >= 0 ? '+' : ''}${item.delta.toFixed(1)} pts` : '—')
      : formatSignedPercent(item.delta);
    return `<article class="audience-quality-card"><span>${escapeHtml(item.label)}</span><div><strong>${format(item.earlier)}</strong><b>→</b><strong>${format(item.recent)}</strong></div><small>${change} · ${escapeHtml(item.confidence)} · ${item.n} paired-period observations</small><p>${escapeHtml(item.detail)}</p></article>`;
  }).join('');
}


export function renderDataContract(items = []) {
  return items.map((item) => `<article class="contract-card"><div class="contract-head"><h3>${escapeHtml(item.source)}</h3><span>${escapeHtml(item.trust)}</span></div><dl><div><dt>Allowed</dt><dd>${escapeHtml(item.allowed)}</dd></div><div><dt>Wayfinder use</dt><dd>${escapeHtml(item.use)}</dd></div><div><dt>Limits</dt><dd>${escapeHtml(item.limits)}</dd></div></dl></article>`).join('');
}

export function renderCrossSourceCheck(items = []) {
  if (!items.length) return '<article class="panel"><p class="muted">No cross-source checks are available yet.</p></article>';
  return items.map((item) => {
    const metrics = (item.metrics || []).map((metric) => `<div class="cross-metric"><span>${escapeHtml(metric.label)}</span><strong>${metric.aligned ? 'Aligned' : 'Different'}</strong><small>CSV ${formatNumber(metric.csv,1)} · TT ${formatNumber(metric.tracker,1)} · ${formatNumber(metric.differencePct,1)}% difference</small></div>`).join('');
    return `<article class="cross-card"><div class="cross-head"><div><span>${escapeHtml(item.source)}</span><h3>${escapeHtml(item.headline)}</h3></div><b class="source-pill ${item.status === 'corroborates' || item.status === 'available' ? 'csv' : item.status === 'differs' ? 'external' : 'idle'}">${escapeHtml(item.status)}</b></div><p>${escapeHtml(item.detail)}</p>${metrics ? `<div class="cross-metrics">${metrics}</div>` : ''}</article>`;
  }).join('');
}
