import { SIGNAL_ALIASES, normalizeSourceIdentity } from './config.js';
import { normalizeToken, parseNumber } from './evaluation.js';

export function cleanCsvText(text) {
  return String(text || '')
    .replace(/\uFEFF/g, '')
    .replace(/"IsAlert"\\n\r?\n/g, '"IsAlert"\n')
    .replace(/"IsAlert"\\n/g, '"IsAlert"')
    .replace(/\r\n/g, '\n');
}

export function normalizeHeader(value) {
  return String(value || '')
    .replace(/\uFEFF/g, '')
    .replace(/\\n/g, '')
    .replace(/\\/g, '')
    .replace(/^"+|"+$/g, '')
    .trim();
}

export function cleanTimestampValue(value) {
  return String(value ?? '')
    .replace(/\uFEFF/g, '')
    .replace(/\u00A0/g, ' ')
    .replace(/\uFFFD/g, '')
    .replace(/\\n/g, '')
    .replace(/\r?\n/g, '')
    .replace(/^"+|"+$/g, '')
    .replace(/[;,]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function localEpoch(year, month, day, hour, minute, second, fraction) {
  const milliseconds = Number(String(fraction || '').padEnd(3, '0').slice(0, 3)) || 0;
  const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second), milliseconds);
  if (date.getFullYear() !== Number(year) || date.getMonth() !== Number(month) - 1 || date.getDate() !== Number(day) || date.getHours() !== Number(hour) || date.getMinutes() !== Number(minute) || date.getSeconds() !== Number(second) || date.getMilliseconds() !== milliseconds) return null;
  const ts = date.getTime();
  return Number.isFinite(ts) ? ts : null;
}

export function parseSlashTimestampDetailed(value, order) {
  if (!['MDY', 'DMY'].includes(order)) return { timestampMs: null, timestampFormat: '', timestampValid: false, timestampFailureReason: 'unsupported_order' };
  const text = cleanTimestampValue(value).replace(',', '.');
  if (!text) return { rawTimestamp: text, timestampMs: null, timestampFormat: '', timestampValid: false, timestampFailureReason: 'blank_timestamp' };
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:([:.])(\d{1,6}))?\s*(AM|PM)?$/i);
  if (!match) return { rawTimestamp: text, timestampMs: null, timestampFormat: '', timestampValid: false, timestampFailureReason: `not_${order}_slash_timestamp` };
  const first = Number(match[1]);
  const second = Number(match[2]);
  const year = Number(match[3].length === 2 ? `20${match[3]}` : match[3]);
  let hour = Number(match[4]);
  const ampm = String(match[9] || '').toUpperCase();
  if (ampm === 'PM' && hour < 12) hour += 12;
  if (ampm === 'AM' && hour === 12) hour = 0;
  const month = order === 'DMY' ? second : first;
  const day = order === 'DMY' ? first : second;
  if (month < 1 || month > 12 || day < 1 || day > 31) return { rawTimestamp: text, timestampMs: null, timestampFormat: '', timestampValid: false, timestampFailureReason: `invalid_${order}_calendar_date` };
  const timestampMs = localEpoch(year, month, day, hour, match[5], match[6] || '0', match[8]);
  return { rawTimestamp: text, timestampMs, timestampFormat: `${order} slash${match[7] === ':' ? ' colon_fraction' : match[7] === '.' ? ' dot_fraction' : ''}`, timestampValid: Number.isFinite(timestampMs), timestampFailureReason: Number.isFinite(timestampMs) ? '' : `invalid_${order}_calendar_date` };
}

export function parseSlashTimestamp(value, order) {
  const parsed = parseSlashTimestampDetailed(value, order);
  return parsed.timestampValid ? parsed.timestampMs : null;
}

export function parseIsoTimestamp(value) {
  const text = cleanTimestampValue(value).replace(',', '.');
  const zoned = text.match(/^\d{4}-\d{1,2}-\d{1,2}[ T]\d{1,2}:\d{2}(?::\d{2})?(?:\.\d{1,6})?(?:Z|[+-]\d{2}:?\d{2})$/i);
  if (zoned) {
    const parsed = Date.parse(text);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const match = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,6}))?/);
  if (!match) return null;
  const ts = localEpoch(match[1], match[2], match[3], match[4], match[5], match[6] || '0', match[7]);
  return Number.isFinite(ts) ? ts : null;
}

export function parseSourceTimestamp(value, preferredOrder = 'ISO') {
  const rawTimestamp = cleanTimestampValue(value);
  if (!rawTimestamp) return { rawTimestamp, timestampMs: null, timestampFormat: '', timestampValid: false, timestampFailureReason: 'blank_timestamp' };
  if (preferredOrder !== 'DMY' && preferredOrder !== 'MDY') {
    const iso = parseIsoTimestamp(rawTimestamp);
    if (iso !== null) return { rawTimestamp, timestampMs: iso, timestampFormat: 'ISO', timestampValid: true, timestampFailureReason: '' };
  }
  const orders = preferredOrder === 'DMY' ? ['DMY'] : preferredOrder === 'MDY' ? ['MDY'] : ['MDY', 'DMY'];
  for (const order of orders) {
    const parsed = parseSlashTimestampDetailed(rawTimestamp, order);
    if (parsed.timestampValid) return parsed;
  }
  if (!rawTimestamp.includes('/')) {
    const fallback = Date.parse(rawTimestamp);
    if (Number.isFinite(fallback)) return { rawTimestamp, timestampMs: fallback, timestampFormat: 'Date.parse_non_slash', timestampValid: true, timestampFailureReason: '' };
  }
  return { rawTimestamp, timestampMs: null, timestampFormat: '', timestampValid: false, timestampFailureReason: `unrecognized_${preferredOrder}_timestamp` };
}

export function parseFlexibleTimestamp(value, preferredOrder = 'ISO') {
  const parsed = parseSourceTimestamp(value, preferredOrder);
  return parsed.timestampValid ? parsed.timestampMs : null;
}

function normalizeRow(row) {
  const out = {};
  for (const [key, value] of Object.entries(row || {})) out[normalizeHeader(key)] = value;
  return out;
}

function pathStartsWith(path, prefixes) {
  const canonical = normalizeSourceIdentity(path);
  const clean = String(path || '').replace(/\\/g, '/').toLowerCase();
  return prefixes.some(prefix => clean.includes(prefix.toLowerCase())) || canonical === normalizeSourceIdentity(prefixes[0]);
}

function baseAdapter(sourceType, prefixes, order = 'ISO') {
  return {
    sourceType,
    prefixes,
    canHandlePath(path) { return pathStartsWith(path, prefixes) && (/\.csv$/i.test(path) || /\.txt$/i.test(path)); },
    canHandleContainerPath(path) { return pathStartsWith(path, prefixes) && /\.zip$/i.test(path); },
    cleanText: text => String(text || '').replace(/\uFEFF/g, '').replace(/\r\n/g, '\n'),
    normalizeHeader,
    normalizeRow,
    getTimestampInfo(row) { return parseSourceTimestamp(row.Timestamp || row.Time || row.DateTime, order); },
    getTimestampMs(row) { return this.getTimestampInfo(row).timestampMs; },
    getPreferredSignal(row) { return row.Signal || row.Parameter || row.Name || row.Message || row.ParameterType || ''; },
    getCompositeSignal(row) { return [row.Component, row.SubComponent, row.ParameterType, row.Signal, row.Parameter].filter(Boolean).join(' '); },
    getNumericValue(row) { return parseNumber(row.Value ?? row.Actual ?? row.NumericValue); },
    getComponent(row) { return row.Component || ''; },
    getSubsystem(row, rule) { return row.Subsystem || rule.subsystem; }
  };
}

export const ADAPTERS = {
  BSSNotifications: {
    ...baseAdapter('BSSNotifications', ['logs/LLCINotifications/BSS/'], 'MDY'),
    requiredFields: ['Timestamp', 'Action', 'MessageType', 'LLCIKey', 'MachineType', 'Component', 'SubComponent', 'ParameterType', 'Value', 'IsAlert'],
    cleanText: cleanCsvText,
    getTimestampInfo(row) { return parseSourceTimestamp(row.Timestamp || row.Time || row.DateTime, 'MDY'); },
    getPreferredSignal(row) { return row.SubComponent || ''; },
    getCompositeSignal(row) { return [row.Component, row.SubComponent, row.ParameterType].filter(Boolean).join(' '); },
    getNumericValue(row) { return parseNumber(row.Value); },
    getComponent(row) { return row.Component || ''; },
    getSubsystem(row, rule) { return row.Subsystem || rule.subsystem || ''; }
  },
  IPSNotifications: baseAdapter('IPSNotifications', ['logs/LLCINotifications/IPS/'], 'MDY'),
  FECNotifications: baseAdapter('FECNotifications', ['logs/FECNotifications/'], 'ISO'),
  AlertsMonitoring: baseAdapter('AlertsMonitoring', ['logs/AlertsMonitoring.txt', 'logs/AletrsMonitoring.txt'], 'ISO'),
  MachineStates: baseAdapter('MachineStates', ['logs/MachineStates/'], 'DMY')
};

export function getAdapter(sourceType) {
  return ADAPTERS[normalizeSourceIdentity(sourceType)] || ADAPTERS[sourceType] || null;
}

function aliasesFor(token) {
  return new Set([token, ...(SIGNAL_ALIASES[token] || []), ...Object.entries(SIGNAL_ALIASES).filter(([, aliases]) => aliases.includes(token)).map(([key]) => key)]);
}

function matchReasonForRow(adapter, row, rule) {
  const ruleSource = normalizeSourceIdentity(rule.sourceType || rule.logSource || adapter.sourceType);
  if (ruleSource !== adapter.sourceType) return 'unmatched';
  const preferred = normalizeToken(adapter.getPreferredSignal(row));
  const composite = normalizeToken(adapter.getCompositeSignal(row));
  const componentPath = normalizeToken([row.Component, row.SubComponent, row.ParameterType].filter(Boolean).join(''));
  const ruleToken = rule.normSignal || normalizeToken(rule.signal);
  if (preferred === ruleToken || composite === ruleToken) return 'exact_signal';
  const aliases = aliasesFor(ruleToken);
  if ([...aliases].some(token => token !== ruleToken && (preferred === token || composite === token))) return 'alias';
  if (componentPath && [...aliases].some(token => token.length >= 5 && componentPath.includes(token))) return 'component_path';
  if (adapter.sourceType === 'BSSNotifications') {
    const sub = normalizeToken(row.SubComponent);
    const parameter = normalizeToken(row.ParameterType);
    if ([...aliases].some(token => token === sub || token === parameter)) return 'structured_fallback';
  }
  return 'unmatched';
}

export function getRuleMatchesForRow(adapter, row, rules) {
  if (!rules?.length) return [];
  return rules.map(rule => ({ rule, matchReason: matchReasonForRow(adapter, row, rule) })).filter(match => match.matchReason !== 'unmatched');
}

export function matchRuleForRow(adapter, row, rules) {
  return getRuleMatchesForRow(adapter, row, rules).map(match => match.rule);
}
