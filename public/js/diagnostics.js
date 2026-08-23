const MAX_EVENTS = 120;
const events = [];
const startedAt = Date.now();

function safeString(value, max = 180) {
  if (value == null) return undefined;
  const text = String(value)
    .replace(/https?:\/\/[^\s?#]+(?:\?[^\s#]*)?/gi, '[url-redacted]')
    .replace(/(?:access_token|refresh_token|id_token|code|state|nonce|client_secret|authorization)=?[^\s&,}]*/gi, '$1=[redacted]')
    .replace(/[A-Za-z0-9_-]{80,}/g, '[long-value-redacted]');
  return text.slice(0, max);
}

function sanitize(details = {}) {
  const allowed = {};
  const keys = ['endpoint','method','status','failureType','connected','rowCount','fileCount','privateColumnsRemoved','unsupportedColumns','granularity','source','eventType','message','runtime','d1Configured','d1Reachable'];
  for (const key of keys) {
    if (!(key in details)) continue;
    const value = details[key];
    allowed[key] = typeof value === 'number' || typeof value === 'boolean' ? value : safeString(value);
  }
  return allowed;
}

export function diagnostic(level, area, message, details = {}) {
  const entry = {
    at: new Date().toISOString(),
    level: String(level || 'info').toUpperCase(),
    area: safeString(area, 40) || 'app',
    message: safeString(message) || 'Event',
    details: sanitize(details),
  };
  events.push(entry);
  if (events.length > MAX_EVENTS) events.shift();
  renderDiagnostics();
  return entry;
}

function browserSummary() {
  const ua = navigator.userAgent || '';
  const match = ua.match(/(Firefox|Edg|Chrome|Safari)\/([\d.]+)/i);
  return match ? `${match[1]} ${match[2]}` : 'Browser';
}

export function diagnosticsText(config = {}) {
  const lines = [
    'NERDSPACE LABS WAYFINDER DIAGNOSTIC LOG',
    `Version: ${config.version || 'unknown'}`,
    `Generated: ${new Date().toISOString()}`,
    `Launch elapsed: ${Math.round((Date.now() - startedAt) / 1000)}s`,
    `Path: ${location.pathname}`,
    `Online: ${navigator.onLine}`,
    `Browser: ${browserSummary()}`,
    '',
    'PRIVACY',
    'OAuth tokens, authorization codes, URL queries, CSV contents, revenue values, creator identities, and message/chat content are excluded.',
    '',
    `EVENTS: ${events.length}`,
    '',
  ];
  for (const e of events) {
    lines.push(`[${e.at}] ${e.level} - ${e.area}`);
    lines.push(`Message: ${e.message}`);
    if (Object.keys(e.details).length) lines.push(`Details: ${JSON.stringify(e.details)}`);
    lines.push('');
  }
  return lines.join('\n').trimEnd() + '\n';
}

export function renderDiagnostics() {
  const output = document.querySelector('#diagnostics-output');
  const count = document.querySelector('#diagnostics-count');
  if (count) count.textContent = `${events.length} event${events.length === 1 ? '' : 's'}`;
  if (!output) return;
  if (!events.length) {
    output.textContent = 'No diagnostic events recorded yet.';
    return;
  }
  output.textContent = events.map((e) => {
    const details = Object.keys(e.details).length ? `\nDetails: ${JSON.stringify(e.details)}` : '';
    return `[${e.at}] ${e.level} - ${e.area}\nMessage: ${e.message}${details}`;
  }).join('\n\n');
}

export function clearDiagnostics() {
  events.length = 0;
  renderDiagnostics();
}

export function installGlobalDiagnostics() {
  window.addEventListener('error', (event) => diagnostic('error', 'client', 'Unhandled client error', { message: event.message }));
  window.addEventListener('unhandledrejection', (event) => diagnostic('error', 'client', 'Unhandled promise rejection', { message: event.reason?.message || event.reason || 'Unknown rejection' }));
  window.addEventListener('online', () => diagnostic('info', 'network', 'Browser returned online'));
  window.addEventListener('offline', () => diagnostic('warning', 'network', 'Browser went offline'));
}
