import { APP_CONFIG } from './config.js';
import { parseCSV, inferColumnMap, inferDatasetGranularity, normalizeRows, recognizedFields, unsupportedHeaders } from './csv.js';
import { buildIntelligence } from './intelligence.js';
import { fetchAuthSession, connectTwitch, disconnectTwitch, syncEventSub } from './auth.js';
import { fetchTwitchData, fetchTrackerEnrichment, matchRowsToVods, attachObservedEventContext } from './enrichment.js';
import { DATA_CONTRACT, buildCrossSourceCheck } from './supported-data.js';
import { getContexts, setContext, getExperiments, addExperiment, removeExperiment, getGoal, setGoal } from './storage.js';
import {
  setBusy, toast, renderAuth, renderMetrics, renderBaselineCallout, renderFlightPlan, renderInsights, renderScorecard,
  renderBars, renderCategoryRoles, renderStreams, renderChangeGrid, renderRaidRetention, renderHealth, renderExperiments,
  renderDecisionBrief, renderEvidenceLedger, renderTestSuggestions, renderGuardrails, renderAudienceQuality,
  renderDataContract, renderCrossSourceCheck, sourceStatus, showMathModal, escapeHtml,
} from './ui.js';

const state = {
  rows: [],
  files: [],
  mappings: [],
  intelligence: null,
  auth: { connected: false },
  twitch: null,
  tracker: null,
  contexts: getContexts(),
  experiments: getExperiments(),
  goal: getGoal(),
  currentContextRow: null,
};

function simpleHash(value) {
  let hash = 2166136261;
  const text = String(value);
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function stableRowId(row) {
  const date = row.date ? row.date.toISOString() : `row:${row.sourceIndex}`;
  return `stream-${simpleHash([date, row.title, row.category, row.durationMinutes, row.avgViewers].join('|'))}`;
}

function dedupeRows(rows) {
  const seen = new Map();
  for (const row of rows) {
    const key = row.date
      ? `${row.date.toISOString().slice(0, 16)}|${String(row.title).toLowerCase()}|${row.durationMinutes ?? ''}`
      : `${row.sourceFile}|${row.sourceIndex}|${row.title}|${row.avgViewers}`;
    if (!seen.has(key)) seen.set(key, row);
  }
  return [...seen.values()];
}

async function parseFiles(files) {
  const allRows = [];
  const mappings = [];
  for (const file of files) {
    let text = await file.text();
    const parsed = parseCSV(text);
    text = ''; // Drop the original CSV text reference immediately after the privacy-filtered parse.
    if (!parsed.headers.length) continue;
    const mapping = inferColumnMap(parsed.headers);
    const granularity = inferDatasetGranularity(file.name, parsed, mapping);
    const rows = normalizeRows(parsed, mapping).map((row) => ({ ...row, sourceFile: file.name, dataGranularity: granularity }));
    rows.forEach((row) => { row.id = stableRowId(row); });
    allRows.push(...rows);
    mappings.push({ file: file.name, headers: parsed.headers, mapping, recognized: recognizedFields(mapping), unsupported: unsupportedHeaders(parsed.headers, mapping), rowCount: rows.length, privateColumnsRemoved: parsed.privateColumnsRemoved || 0, granularity });
  }
  return { rows: dedupeRows(allRows), mappings };
}

function rebuild() {
  if (!state.rows.length) return;
  state.intelligence = buildIntelligence(state.rows, {
    contexts: state.contexts,
    events: state.twitch?.events || [],
    goal: state.goal,
    experiments: state.experiments,
  });
  renderWorkspace();
}

function renderWorkspace() {
  const i = state.intelligence;
  if (!i) return;
  const dailyOnly = state.mappings.length > 0 && state.mappings.every((item) => item.granularity === 'daily');
  const patternUnit = dailyOnly ? 'active days' : 'streams';
  document.querySelector('#empty-state').hidden = true;
  document.querySelector('#workspace').hidden = false;
  document.querySelector('#download-button').disabled = false;
  document.querySelector('#goal-select').value = state.goal;
  document.querySelector('#decision-brief').innerHTML = renderDecisionBrief(i.decisionBrief);
  document.querySelector('#metric-grid').innerHTML = renderMetrics(i);
  document.querySelector('#baseline-callout').innerHTML = renderBaselineCallout(i);
  document.querySelector('#flight-plan').innerHTML = renderFlightPlan(i.flightPlan);
  document.querySelector('#evidence-ledger').innerHTML = renderEvidenceLedger(i.evidenceLedger);
  document.querySelector('#test-suggestions').innerHTML = renderTestSuggestions(i.testSuggestions);
  document.querySelector('#guardrails').innerHTML = renderGuardrails(i.guardrails);
  document.querySelector('#insights-grid').innerHTML = renderInsights(i.insights);
  document.querySelector('#audience-quality').innerHTML = renderAudienceQuality(i.audienceQuality);
  document.querySelector('#scorecard').innerHTML = renderScorecard(i.scorecard);
  document.querySelector('#streams-body').innerHTML = renderStreams(i.rows);
  document.querySelector('#day-bars').innerHTML = renderBars(i.organicAnalysis.byDay, 'avgViewers', '', patternUnit);
  document.querySelector('#duration-bars').innerHTML = renderBars(i.organicAnalysis.byDuration, 'avgViewers', '', patternUnit);
  document.querySelector('#category-bars').innerHTML = renderBars(i.organicAnalysis.byCategory.slice(0, 10), 'avgViewers', '', patternUnit);
  document.querySelector('#conversion-bars').innerHTML = renderBars([...i.organicAnalysis.byCategory].filter((x) => Number.isFinite(x.followersPerHour)).sort((a,b) => b.followersPerHour-a.followersPerHour).slice(0,10), 'followersPerHour', '', patternUnit);
  document.querySelector('#category-roles').innerHTML = renderCategoryRoles(i.categoryRoles.slice(0, 12));
  document.querySelector('#change-grid').innerHTML = renderChangeGrid(i.whatChanged);
  document.querySelector('#raid-retention').innerHTML = renderRaidRetention(i.raidRetention);
  document.querySelector('#data-health').innerHTML = renderHealth(i.dataHealth);
  document.querySelector('#data-contract').innerHTML = renderDataContract(DATA_CONTRACT);
  document.querySelector('#cross-source-check').innerHTML = renderCrossSourceCheck(buildCrossSourceCheck(i.rows, state.tracker, state.twitch));
  document.querySelector('#experiments-list').innerHTML = renderExperiments(i.experiments);
  renderFileInfo();
  const labTab = document.querySelector('[data-tab="lab"]');
  if (labTab) labTab.textContent = dailyOnly ? 'Daily Lab' : 'Stream Lab';
  const labTitle = document.querySelector('#lab-title');
  if (labTitle) labTitle.textContent = dailyOnly ? 'Analyze daily Twitch rollups in context' : 'Analyze broadcasts in context';
  const labCopy = document.querySelector('#lab-copy');
  if (labCopy) labCopy.textContent = dailyOnly
    ? 'This export is aggregated by day. Wayfinder will not claim that each CSV row is an individual broadcast; stream-level conclusions require stream-level data or a reliable Twitch match.'
    : 'External audience events remain visible, but confirmed distortions are removed from organic recommendation baselines.';
  bindDynamicActions();
}

function renderFileInfo() {
  const originalCount = state.mappings.reduce((total, file) => total + file.rowCount, 0);
  document.querySelector('#file-summary').textContent = `${state.files.length} CSV file${state.files.length === 1 ? '' : 's'} · ${state.rows.length} unique rows${state.intelligence?.inactiveDailyRows ? ` · ${state.intelligence.decisionRows.length} active days used for decisions · ${state.intelligence.inactiveDailyRows} inactive days kept as history` : ''}${originalCount !== state.rows.length ? ` · ${originalCount - state.rows.length} duplicate rows ignored` : ''}`;
  const privateColumnsRemoved = state.mappings.reduce((total, item) => total + (item.privateColumnsRemoved || 0), 0);
  document.querySelector('#detected-columns').innerHTML = state.mappings.map((item) => `<span class="column-chip"><strong>${escapeHtml(item.file)}</strong>${item.recognized.length} supported fields · ${item.unsupported?.length || 0} ignored · ${item.granularity === 'daily' ? 'daily aggregate' : 'stream-level'}</span>`).join('') + (privateColumnsRemoved ? `<span class="column-chip privacy-filter-chip"><strong>PRIVATE</strong>${privateColumnsRemoved} revenue/monetary column${privateColumnsRemoved === 1 ? '' : 's'} discarded</span>` : '<span class="column-chip privacy-filter-chip"><strong>PRIVATE</strong>No revenue fields imported</span>');
  sourceStatus('#source-csv', 'ok', `${state.rows.length} rows loaded`, `${state.files.length} local file${state.files.length === 1 ? '' : 's'}; ${state.intelligence?.inactiveDailyRows ? `${state.intelligence.inactiveDailyRows} inactive daily rows excluded from performance decisions; ` : ''}${privateColumnsRemoved ? `${privateColumnsRemoved} private monetary column${privateColumnsRemoved === 1 ? '' : 's'} discarded; ` : ''}never uploaded`);
}

function bindDynamicActions() {
  document.querySelectorAll('.math-button').forEach((button) => button.addEventListener('click', () => showMathModal(state.intelligence.insights[Number(button.dataset.index)])));
  document.querySelectorAll('.flight-math').forEach((button) => button.addEventListener('click', () => showMathModal(state.intelligence.flightPlan[Number(button.dataset.index)])));
  document.querySelectorAll('.context-button').forEach((button) => button.addEventListener('click', () => openContext(button.dataset.rowId)));
  document.querySelectorAll('.delete-experiment').forEach((button) => button.addEventListener('click', () => {
    state.experiments = removeExperiment(button.dataset.id);
    rebuild();
  }));
  document.querySelectorAll('.seed-experiment').forEach((button) => button.addEventListener('click', () => {
    const suggestion = state.intelligence.testSuggestions[Number(button.dataset.index)];
    if (!suggestion?.experiment) return;
    const form = document.querySelector('#experiment-form');
    form.elements.name.value = suggestion.experiment.name || '';
    form.elements.type.value = suggestion.experiment.type || 'duration';
    form.elements.control.value = suggestion.experiment.control || '';
    form.elements.test.value = suggestion.experiment.test || '';
    form.elements.minimum.value = suggestion.experiment.minimum || 4;
    document.querySelector('#experiment-modal').showModal();
  }));
}

async function handleFiles(fileList) {
  const files = [...fileList].filter((file) => file.name.toLowerCase().endsWith('.csv'));
  if (!files.length) return toast('Choose at least one CSV file.', 'warning');
  setBusy(true, 'Parsing CSV files locally…');
  try {
    const result = await parseFiles(files);
    if (!result.rows.length) throw new Error('No usable CSV rows were found.');
    state.files = files.map((file) => ({ name: file.name, size: file.size, type: file.type }));
    document.querySelector('#csv-file').value = ''; // Do not retain browser file handles after import.
    state.rows = result.rows;
    state.mappings = result.mappings;
    state.twitch = null;
    state.tracker = null;
    rebuild();
    if (state.auth.connected) await enrichConnectedAccount();
    toast(`Analyzed ${state.rows.length} unique rows.`, 'success');
  } catch (error) {
    toast(error.message || 'Unable to read the CSV.', 'error');
  } finally {
    setBusy(false);
  }
}

async function loadDemo() {
  setBusy(true, 'Loading demo data…');
  try {
    const response = await fetch('/sample-twitch-analytics.csv');
    const blob = await response.blob();
    const file = new File([blob], 'sample-twitch-analytics.csv', { type: 'text/csv' });
    await handleFiles([file]);
    const demoRaid = state.rows.find((row) => row.title === 'DEMO RAID STREAM');
    if (demoRaid) {
      state.contexts = { ...state.contexts, [demoRaid.id]: { raid: true, notes: 'Demo-only confirmed raid context: 200-viewer incoming raid.' } };
      rebuild();
      toast('Demo marks the 200-viewer raid so you can see the adjusted baseline.', 'success');
    }
  } finally {
    setBusy(false);
  }
}

async function enrichConnectedAccount() {
  if (!state.auth.connected || !state.rows.length) return;
  setBusy(true, 'Cross-referencing Twitch…');
  sourceStatus('#source-twitch', 'idle', 'Loading', 'Authenticated Twitch request in progress');
  try {
    let eventsub = state.auth.eventsub || null;
    try {
      eventsub = await syncEventSub(state.auth.csrf);
      state.auth = { ...state.auth, eventsub };
    } catch (syncError) {
      eventsub = { configured: false, created: [], warnings: [syncError.message] };
    }

    const twitch = await fetchTwitchData();
    state.twitch = { ...twitch, eventsub };
    state.rows = matchRowsToVods(state.rows, twitch.videos, twitch.clips, twitch.events);
    state.rows = attachObservedEventContext(state.rows, twitch.events);
    const activeSubscriptions = (eventsub?.created || []).filter((item) => item.status === 'enabled' || item.status === 'webhook_callback_verification_pending').length;
    const eventDetail = twitch.eventStorage
      ? `${twitch.events.length} supported EventSub events · ${activeSubscriptions}/4 subscriptions active or pending · ${twitch.videos.length} sanitized VOD records checked${twitch.completeness?.videos?.truncated || twitch.completeness?.clips?.truncated ? ' · safety cap reached' : ''}`
      : 'Twitch connected; D1 event history is not configured';
    sourceStatus('#source-twitch', eventsub?.warnings?.length ? 'warning' : 'ok', eventsub?.warnings?.length ? 'Connected with warning' : 'Connected', eventDetail);
    rebuild();
  } catch (error) {
    sourceStatus('#source-twitch', 'warning', 'Unavailable', error.message);
    toast(error.message, 'warning');
  }

  try {
    const tracker = await fetchTrackerEnrichment();
    state.tracker = tracker;
    sourceStatus('#source-tracker', 'ok', 'Loaded', 'Sanitized 30-day summary; corroboration only, never authoritative');
    document.querySelector('#tracker-data').textContent = JSON.stringify(tracker.summary, null, 2);
    rebuild();
  } catch (error) {
    sourceStatus('#source-tracker', 'warning', 'Unavailable', 'Analysis continues without TwitchTracker');
    document.querySelector('#tracker-data').textContent = error.message;
  } finally {
    setBusy(false);
  }
}

function openContext(rowId) {
  const row = state.intelligence.rows.find((item) => item.id === rowId);
  if (!row) return;
  state.currentContextRow = rowId;
  const form = document.querySelector('#context-form');
  const context = state.contexts[rowId] || {};
  for (const input of form.querySelectorAll('input[type="checkbox"]')) input.checked = Boolean(context[input.name]);
  form.elements.notes.value = context.notes || '';
  document.querySelector('#context-stream-label').textContent = `${row.date ? row.date.toLocaleString() : `CSV row ${row.sourceIndex}`} · ${row.category || 'No category'}${row.raidEvents?.length ? ` · Twitch already matched ${row.raidEvents.length} incoming raid event(s)` : ''}`;
  document.querySelector('#context-modal').showModal();
}

function saveCurrentContext() {
  if (!state.currentContextRow) return;
  const form = document.querySelector('#context-form');
  const context = { notes: form.elements.notes.value.trim() };
  for (const input of form.querySelectorAll('input[type="checkbox"]')) context[input.name] = input.checked;
  state.contexts = setContext(state.currentContextRow, context);
  state.currentContextRow = null;
  rebuild();
  toast('Stream context saved locally.', 'success');
}

function createExperimentFromForm() {
  const form = document.querySelector('#experiment-form');
  const data = new FormData(form);
  const experiment = {
    id: `exp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: String(data.get('name') || '').trim(),
    type: String(data.get('type') || 'start'),
    control: String(data.get('control') || '').trim(),
    test: String(data.get('test') || '').trim(),
    minimum: Math.min(20, Math.max(2, Number(data.get('minimum')) || 4)),
    createdAt: new Date().toISOString(),
  };
  if (!experiment.name || !experiment.control || !experiment.test) return toast('Complete the experiment fields.', 'warning');
  state.experiments = addExperiment(experiment);
  form.reset();
  form.elements.minimum.value = '4';
  rebuild();
  toast('Experiment created. Wayfinder will evaluate matching streams.', 'success');
}

function exportReport() {
  if (!state.intelligence) return;
  const report = {
    product: APP_CONFIG.productName,
    version: APP_CONFIG.version,
    generatedAt: new Date().toISOString(),
    goal: state.goal,
    privacy: 'CSV analyzed locally. Revenue/earnings/payout columns are discarded at import and are not analyzed, exported, logged, stored, or transmitted. OAuth tokens are not included in this export.',
    files: state.mappings.map(({ rowCount, mapping, privateColumnsRemoved, granularity, unsupported }, index) => ({ file: `CSV ${index + 1}`, rowCount, mapping, privateColumnsRemoved, granularity, unsupportedColumnsIgnored: unsupported || [] })),
    connectedTwitch: state.auth.connected ? { user: state.auth.user, scopes: state.auth.scopes || [], contractVersion: state.twitch?.contractVersion || null } : null,
    twitchTrackerSummary: state.tracker?.summary || null,
    rawSummary: state.intelligence.rawAnalysis.summary,
    organicSummary: state.intelligence.organicAnalysis.summary,
    decisionBrief: state.intelligence.decisionBrief,
    flightPlan: state.intelligence.flightPlan,
    evidenceLedger: state.intelligence.evidenceLedger,
    testSuggestions: state.intelligence.testSuggestions,
    guardrails: state.intelligence.guardrails,
    audienceQuality: state.intelligence.audienceQuality,
    insights: state.intelligence.insights,
    scorecard: state.intelligence.scorecard,
    categoryRoles: state.intelligence.categoryRoles,
    whatChanged: state.intelligence.whatChanged,
    raidRetention: state.intelligence.raidRetention,
    dataHealth: state.intelligence.dataHealth,
    supportedDataContract: DATA_CONTRACT,
    crossSourceCheck: buildCrossSourceCheck(state.intelligence.rows, state.tracker, state.twitch),
    decisionRules: { inactiveDailyRows: state.intelligence.inactiveDailyRows, materialHostsRaidsViewerPct: state.intelligence.externalInfluenceThresholdPct },
    experiments: state.intelligence.experiments,
    streamContext: state.intelligence.rows.map((row) => ({ id: row.id, date: row.date, title: row.title, category: row.category, confirmedExternal: row.confirmedExternal, externalReasons: row.externalReasons, raidViewers: row.raidViewers, context: row.context, twitch: row.twitch })),
  };
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `wayfinder-report-${new Date().toISOString().slice(0,10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function activateTab(name) {
  document.querySelectorAll('.tab-button').forEach((button) => button.classList.toggle('active', button.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach((panel) => { panel.hidden = panel.id !== `tab-${name}`; });
}

function resetDataset() {
  state.rows = []; state.files = []; state.mappings = []; state.intelligence = null; state.twitch = null; state.tracker = null;
  document.querySelector('#workspace').hidden = true;
  document.querySelector('#empty-state').hidden = false;
  document.querySelector('#download-button').disabled = true;
  document.querySelector('#csv-file').value = '';
  sourceStatus('#source-csv', 'idle', 'Waiting', 'Required source; processed locally');
  sourceStatus('#source-twitch', 'idle', state.auth.connected ? 'Connected account' : 'Optional', 'Supported Helix metadata + verified EventSub context');
  sourceStatus('#source-tracker', 'idle', 'Optional', 'Sanitized 30-day corroboration only');
}

async function refreshAuth({ initial = false } = {}) {
  try {
    state.auth = await fetchAuthSession();
    renderAuth(state.auth);
    if (!initial && state.auth.connected && state.rows.length) await enrichConnectedAccount();
  } catch (error) {
    state.auth = { connected: false };
    renderAuth(state.auth);
    if (!initial) toast(error.message, 'warning');
  }
}

function showAuthResult() {
  const url = new URL(window.location.href);
  const auth = url.searchParams.get('auth');
  if (!auth) return;
  if (auth === 'connected') toast('Twitch connected securely.', 'success');
  else if (auth === 'cancelled') toast('Twitch connection was cancelled.', 'warning');
  else if (auth === 'state_error') toast('OAuth state validation failed. No Twitch session was created.', 'error');
  else if (auth === 'error') toast('Twitch authorization failed. Check the Wayfinder server configuration or reconnect.', 'error');
  history.replaceState({}, '', url.pathname + url.hash);
}

function initStaticText() {
  document.querySelectorAll('[data-product]').forEach((el) => { el.textContent = APP_CONFIG.productName; });
  document.querySelectorAll('[data-version]').forEach((el) => { el.textContent = APP_CONFIG.version; });
  document.querySelectorAll('[data-tagline]').forEach((el) => { el.textContent = APP_CONFIG.tagline; });
  document.querySelector('[data-privacy]').textContent = APP_CONFIG.privacyLine;
  document.querySelector('#goal-select').value = state.goal;
}

async function init() {
  initStaticText();
  showAuthResult();
  await refreshAuth({ initial: true });
  setInterval(() => refreshAuth({ initial: true }), 55 * 60_000);

  const input = document.querySelector('#csv-file');
  const dropzone = document.querySelector('#dropzone');
  input.addEventListener('change', () => handleFiles(input.files));
  dropzone.addEventListener('dragover', (event) => { event.preventDefault(); dropzone.classList.add('dragging'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragging'));
  dropzone.addEventListener('drop', (event) => { event.preventDefault(); dropzone.classList.remove('dragging'); handleFiles(event.dataTransfer.files); });

  document.querySelector('#sample-button').addEventListener('click', loadDemo);
  document.querySelector('#download-button').addEventListener('click', exportReport);
  document.querySelector('#reset-button').addEventListener('click', resetDataset);
  document.querySelector('#goal-select').addEventListener('change', (event) => { state.goal = event.target.value; setGoal(state.goal); rebuild(); });
  document.querySelectorAll('.tab-button').forEach((button) => button.addEventListener('click', () => activateTab(button.dataset.tab)));
  document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => button.closest('dialog').close()));

  document.querySelector('#twitch-connect').addEventListener('click', async () => {
    if (!state.auth.connected) return connectTwitch();
    if (!window.confirm('Disconnect Twitch from Wayfinder? Stored Wayfinder EventSub history for this account will also be deleted.')) return;
    setBusy(true, 'Disconnecting Twitch…');
    try {
      await disconnectTwitch(state.auth.csrf);
      state.auth = { connected: false }; state.twitch = null; state.tracker = null;
      renderAuth(state.auth); rebuild();
      toast('Twitch disconnected and Wayfinder EventSub history deletion requested.', 'success');
    } catch (error) { toast(error.message, 'error'); }
    finally { setBusy(false); }
  });

  document.querySelector('#context-form').addEventListener('submit', (event) => {
    event.preventDefault(); saveCurrentContext(); document.querySelector('#context-modal').close();
  });
  document.querySelector('#new-experiment').addEventListener('click', () => document.querySelector('#experiment-modal').showModal());
  document.querySelector('#experiment-form').addEventListener('submit', (event) => {
    event.preventDefault(); createExperimentFromForm(); document.querySelector('#experiment-modal').close();
  });
}

init();
