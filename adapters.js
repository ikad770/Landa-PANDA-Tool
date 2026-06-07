import { SIGNAL_ALIASES } from './config.js';
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

function localEpoch(year, month, day, hour, minute, second, fraction) {
  const ms = Number(String(fraction || '').slice(0, 3).padEnd(3, '0')) || 0;
  return new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second), ms).getTime();
}

export function parseSlashTimestamp(value, order) {
  const text = String(value || '').trim();
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?$/);
  if (!match) return null;
  const first = Number(match[1]);
  const second = Number(match[2]);
  const month = order === 'DMY' ? second : first;
  const day = order === 'DMY' ? first : second;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const ts = localEpoch(match[3], month, day, match[4], match[5], match[6], match[7]);
  return Number.isFinite(ts) ? ts : null;
}

export function parseIsoTimestamp(value) {
  const text = String(value || '').trim();
  const match = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?/);
  if (!match) return null;
  const ts = localEpoch(match[1], match[2], match[3], match[4], match[5], match[6], match[7]);
  return Number.isFinite(ts) ? ts : null;
}

function normalizeRow(row) {
  const out = {};
  for (const [key, value] of Object.entries(row || {})) out[normalizeHeader(key)] = value;
  return out;
}

function pathStartsWith(path, prefixes) {
  const clean = String(path || '').replace(/\\/g, '/').toLowerCase();
  return prefixes.some(prefix => clean.includes(prefix.toLowerCase()));
}

function baseAdapter(sourceType, prefixes, order = 'ISO') {
  return {
    sourceType,
    prefixes,
    canHandlePath(path) { return pathStartsWith(path, prefixes) && (/\.csv$/i.test(path) || /\.txt$/i.test(path)); },
    canHandleContainerPath(path) { return pathStartsWith(path, prefixes) && /\.zip$/i.test(path); },
    cleanText: text => String(text || '').replace(/\uFEFF/g, '').replace(/\r\n/g, '\n'),
    normalizeRow,
    getTimestampMs(row) { return order === 'DMY' ? parseSlashTimestamp(row.Timestamp || row.Time || row.DateTime, 'DMY') : parseIsoTimestamp(row.Timestamp || row.Time || row.DateTime) ?? parseSlashTimestamp(row.Timestamp || row.Time || row.DateTime, 'MDY'); },
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
    getTimestampMs(row) { return parseSlashTimestamp(row.Timestamp, 'MDY'); },
    getPreferredSignal(row) { return row.SubComponent || ''; },
    getCompositeSignal(row) { return [row.Component, row.SubComponent, row.ParameterType].filter(Boolean).join(' '); },
    getNumericValue(row) { return parseNumber(row.Value); },
    getComponent(row) { return row.Component || ''; },
    getSubsystem(row, rule) { return row.SubComponent || rule.subsystem; }
  },
  IPSNotifications: baseAdapter('IPSNotifications', ['logs/LLCINotifications/IPS/'], 'MDY'),
  FECNotifications: baseAdapter('FECNotifications', ['logs/FECNotifications/'], 'ISO'),
  AlertsMonitoring: baseAdapter('AlertsMonitoring', ['logs/AlertsMonitoring.txt', 'logs/AletrsMonitoring.txt'], 'ISO'),
  MachineStates: baseAdapter('MachineStates', ['logs/MachineStates/'], 'DMY')
};

export function getAdapter(sourceType) {
  return ADAPTERS[sourceType] || null;
}

function aliasesFor(token) {
  return new Set([token, ...(SIGNAL_ALIASES[token] || [])]);
}

export function matchRuleForRow(adapter, row, rules) {
  if (!rules?.length) return [];
  if (adapter.sourceType === 'BSSNotifications') {
    const sub = normalizeToken(row.SubComponent);
    const parameter = normalizeToken(row.ParameterType);
    const composite = normalizeToken([row.Component, row.SubComponent, row.ParameterType].filter(Boolean).join(''));
    return rules.filter(rule => {
      const tokens = aliasesFor(rule.normSignal);
      if (tokens.has(sub)) return true;
      if (tokens.has(parameter)) return true;
      for (const token of tokens) if (token.length >= 5 && composite.includes(token)) return true;
      return false;
    });
  }
  const preferred = normalizeToken(adapter.getPreferredSignal(row));
  const composite = normalizeToken(adapter.getCompositeSignal(row));
  return rules.filter(rule => {
    for (const token of aliasesFor(rule.normSignal)) {
      if (preferred === token || composite === token || (token.length >= 5 && composite.includes(token))) return true;
    }
    return false;
  });
}
