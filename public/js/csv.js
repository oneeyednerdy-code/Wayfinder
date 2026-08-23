const FIELD_ALIASES = {
  date: ['date', 'stream date', 'broadcast date', 'start date', 'date streamed', 'started at', 'stream start', 'start time'],
  title: ['title', 'stream title', 'broadcast title'],
  category: ['category', 'game', 'game/category', 'game category', 'content category'],
  duration: ['duration', 'stream duration', 'broadcast duration', 'time streamed', 'stream time', 'hours streamed', 'minutes streamed'],
  avgViewers: ['average viewers', 'avg viewers', 'average concurrent viewers', 'avg concurrent viewers', 'average viewers (ccv)', 'avg ccv'],
  peakViewers: ['peak viewers', 'max viewers', 'maximum viewers', 'peak concurrent viewers'],
  uniqueViewers: ['unique viewers', 'unique live viewers'],
  followersGained: ['followers gained', 'new followers', 'follows', 'followers'],
  subscriptions: ['subscriptions', 'subs', 'new subscriptions', 'subscribers gained'],
  minutesWatched: ['minutes watched', 'watch minutes', 'total minutes watched'],
  hoursWatched: ['hours watched', 'watch hours', 'total hours watched'],
  liveViews: ['live views', 'views', 'stream views'],
  uniqueChatters: ['unique chatters', 'chatters'],
  chatMessages: ['chat messages', 'messages', 'messages sent'],
  engagedViewers: ['engaged viewers'],
  newEngagedViewers: ['new engaged viewers'],
  returningEngagedViewers: ['returning engaged viewers'],
  hostsRaidsViewerPct: ['hosts and raids viewers %', 'hosts and raids viewers (%)', 'host and raid viewers %', 'raid viewers %'],
  clipsCreated: ['clips created'],
  clipViews: ['clip views', 'clips views'],
  featuredClipViews: ['featured clip views'],
  unfeaturedClipViews: ['unfeatured clip views'],
  primeSubs: ['prime subs'],
  totalPaidSubs: ['total paid subs'],
  totalGiftedSubs: ['total gifted subs'],
};

const PRIVATE_MONETARY_HEADER_PATTERNS = [
  /\brevenue\b/i,
  /\bearnings?\b/i,
  /\bpayouts?\b/i,
  /\bproceeds?\b/i,
  /\bincome\b/i,
];

export function isPrivateMonetaryHeader(header) {
  const value = String(header ?? '').trim();
  return PRIVATE_MONETARY_HEADER_PATTERNS.some((pattern) => pattern.test(value));
}

export function parseCSV(text) {
  const source = String(text ?? '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];

    if (char === '"') {
      if (quoted && next === '"') {
        value += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (char === ',' && !quoted) {
      row.push(value);
      value = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(value);
      value = '';
      if (row.some((cell) => String(cell).trim() !== '')) rows.push(row);
      row = [];
      continue;
    }

    value += char;
  }

  if (value.length || row.length) {
    row.push(value);
    if (row.some((cell) => String(cell).trim() !== '')) rows.push(row);
  }

  if (!rows.length) return { headers: [], rows: [], privateColumnsRemoved: 0 };

  const allHeaders = rows[0].map((header, index) => String(header).trim() || `Column ${index + 1}`);
  const safeColumns = allHeaders
    .map((header, index) => ({ header, index }))
    .filter(({ header }) => !isPrivateMonetaryHeader(header));
  const privateColumnsRemoved = allHeaders.length - safeColumns.length;
  const headers = safeColumns.map(({ header }) => header);
  const data = rows.slice(1).map((cells) => Object.fromEntries(
    safeColumns.map(({ header, index }) => [header, cells[index] ?? '']),
  ));

  // Revenue/earnings/payout values are intentionally discarded at the CSV import boundary.
  // They never enter Wayfinder's normalized row model, analytics engine, report export, or network layer.
  return { headers, rows: data, privateColumnsRemoved };
}

function norm(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[._/\\()-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function inferColumnMap(headers) {
  const normalized = headers.map((header) => ({ header, normalized: norm(header) }));
  const mapping = {};

  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    // Supported-data rule: exact normalized aliases only. Wayfinder does not guess
    // that a similarly named CSV column means the same thing.
    const match = normalized.find(({ normalized: header }) => aliases.includes(header));
    if (match) mapping[field] = match.header;
  }

  return mapping;
}

export function inferDatasetGranularity(fileName, parsed, mapping = inferColumnMap(parsed.headers)) {
  const name = String(fileName || '').toLowerCase();
  if (/\bby[ _-]?day\b/.test(name) || /daily/.test(name)) return 'daily';

  const hasDate = Boolean(mapping.date);
  const hasStreamIdentity = Boolean(mapping.title || mapping.category);
  const hasTimedDates = hasDate && parsed.rows.some((raw) => /\d:\d|[ap]m/i.test(String(raw[mapping.date] || '')));
  if (hasDate && !hasStreamIdentity && !hasTimedDates) return 'daily';
  return 'stream';
}

export function parseNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const cleaned = String(value ?? '').trim().replace(/[$,%]/g, '').replace(/,/g, '');
  if (!cleaned || /^(-|n\/a|na|null)$/i.test(cleaned)) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseDurationMinutes(value, header = '') {
  if (value == null || String(value).trim() === '') return null;
  const raw = String(value).trim().toLowerCase();
  const headerNorm = norm(header);

  if (/^\d+(?:\.\d+)?$/.test(raw)) {
    const numeric = Number(raw);
    if (headerNorm.includes('hour')) return numeric * 60;
    return numeric;
  }

  if (/^\d{1,3}:\d{1,2}(?::\d{1,2})?$/.test(raw)) {
    const parts = raw.split(':').map(Number);
    if (parts.length === 3) return parts[0] * 60 + parts[1] + parts[2] / 60;
    return parts[0] * 60 + parts[1];
  }

  const hours = Number((raw.match(/([\d.]+)\s*h/) || [])[1] || 0);
  const minutes = Number((raw.match(/([\d.]+)\s*m/) || [])[1] || 0);
  const seconds = Number((raw.match(/([\d.]+)\s*s/) || [])[1] || 0);
  if (hours || minutes || seconds) return hours * 60 + minutes + seconds / 60;

  const wordsHours = Number((raw.match(/([\d.]+)\s*hours?/) || [])[1] || 0);
  const wordsMinutes = Number((raw.match(/([\d.]+)\s*minutes?/) || [])[1] || 0);
  if (wordsHours || wordsMinutes) return wordsHours * 60 + wordsMinutes;

  return null;
}

export function parseDate(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  let parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed;

  const mdy = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?:\s*([ap]m))?)?$/i);
  if (mdy) {
    let [, month, day, year, hour = '0', minute = '0', ampm] = mdy;
    year = Number(year) < 100 ? String(2000 + Number(year)) : year;
    let h = Number(hour);
    if (ampm) {
      if (ampm.toLowerCase() === 'pm' && h !== 12) h += 12;
      if (ampm.toLowerCase() === 'am' && h === 12) h = 0;
    }
    parsed = new Date(Number(year), Number(month) - 1, Number(day), h, Number(minute));
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  return null;
}

export function normalizeRows(parsed, mapping = inferColumnMap(parsed.headers)) {
  return parsed.rows.map((raw, index) => {
    const durationHeader = mapping.duration || '';
    const date = mapping.date ? parseDate(raw[mapping.date]) : null;
    const durationMinutes = mapping.duration ? parseDurationMinutes(raw[mapping.duration], durationHeader) : null;
    const hoursWatched = mapping.hoursWatched ? parseNumber(raw[mapping.hoursWatched]) : null;
    const minutesWatched = mapping.minutesWatched ? parseNumber(raw[mapping.minutesWatched]) : null;

    return {
      id: `row-${index + 1}`,
      sourceIndex: index + 2,
      date,
      dateHasTime: mapping.date ? /\d:\d|[ap]m/i.test(String(raw[mapping.date])) : false,
      title: mapping.title ? String(raw[mapping.title] || '').trim() : '',
      category: mapping.category ? String(raw[mapping.category] || '').trim() : '',
      durationMinutes,
      avgViewers: mapping.avgViewers ? parseNumber(raw[mapping.avgViewers]) : null,
      peakViewers: mapping.peakViewers ? parseNumber(raw[mapping.peakViewers]) : null,
      uniqueViewers: mapping.uniqueViewers ? parseNumber(raw[mapping.uniqueViewers]) : null,
      followersGained: mapping.followersGained ? parseNumber(raw[mapping.followersGained]) : null,
      subscriptions: mapping.subscriptions ? parseNumber(raw[mapping.subscriptions]) : null,
      minutesWatched: minutesWatched ?? (hoursWatched != null ? hoursWatched * 60 : null),
      liveViews: mapping.liveViews ? parseNumber(raw[mapping.liveViews]) : null,
      uniqueChatters: mapping.uniqueChatters ? parseNumber(raw[mapping.uniqueChatters]) : null,
      chatMessages: mapping.chatMessages ? parseNumber(raw[mapping.chatMessages]) : null,
      engagedViewers: mapping.engagedViewers ? parseNumber(raw[mapping.engagedViewers]) : null,
      newEngagedViewers: mapping.newEngagedViewers ? parseNumber(raw[mapping.newEngagedViewers]) : null,
      returningEngagedViewers: mapping.returningEngagedViewers ? parseNumber(raw[mapping.returningEngagedViewers]) : null,
      hostsRaidsViewerPct: mapping.hostsRaidsViewerPct ? parseNumber(raw[mapping.hostsRaidsViewerPct]) : null,
      clipsCreated: mapping.clipsCreated ? parseNumber(raw[mapping.clipsCreated]) : null,
      clipViews: mapping.clipViews ? parseNumber(raw[mapping.clipViews]) : null,
      featuredClipViews: mapping.featuredClipViews ? parseNumber(raw[mapping.featuredClipViews]) : null,
      unfeaturedClipViews: mapping.unfeaturedClipViews ? parseNumber(raw[mapping.unfeaturedClipViews]) : null,
      primeSubs: mapping.primeSubs ? parseNumber(raw[mapping.primeSubs]) : null,
      totalPaidSubs: mapping.totalPaidSubs ? parseNumber(raw[mapping.totalPaidSubs]) : null,
      totalGiftedSubs: mapping.totalGiftedSubs ? parseNumber(raw[mapping.totalGiftedSubs]) : null,
      twitch: null,
    };
  });
}

export function recognizedFields(mapping) {
  return Object.keys(mapping);
}


export function unsupportedHeaders(headers, mapping = inferColumnMap(headers)) {
  const used = new Set(Object.values(mapping));
  return headers.filter((header) => !used.has(header));
}
