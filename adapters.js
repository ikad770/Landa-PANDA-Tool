import { normalizeToken, parseNumber } from './evaluation.js';

export function cleanCsvText(text) {
  return String(text || '')
    .replace(/\uFEFF/g, '')
    .replace(/"IsAlert"\\n\r?\n/g, '"IsAlert"\n')
    .replace(/"IsAlert"\\n/g, '"IsAlert"')
    .replace(/\r\n/g, '\n');
}

export function normalizeHeader(header) {
  return String(header || '')
    .replace(/\uFEFF/g, '')
    .replace(/\\n/g, '')
    .replace(/\\/g, '')
    .replace(/^"+|"+$/g, '')
    .trim();
}

function parseLocalEpoch(parts) {
  const [year, month, day, hour = 0, minute = 0, second = 0, millis = 0] = parts.map(Number);
  return new Date(year, month - 1, day, hour, minute, second, millis).getTime();
}

function parseFractionMs(fraction) {
  return Number(String(fraction || '').slice(0, 3).padEnd(3, '0')) || 0;
}

export function parseTimestampByFormat(value, order) {
  const text = String(value || '').trim();
  const m = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?$/);
  if (!m) return null;
  const a = Number(m[1]); const b = Number(m[2]); const year = Number(m[3]);
  const day = order === 'DMY' ? a : b;
  const month = order === 'DMY' ? b : a;
  const ts = parseLocalEpoch([year, month, day, Number(m[4]), Number(m[5]), Number(m[6]), parseFractionMs(m[7])]);
  return Number.isFinite(ts) ? ts : null;
}

function parseIsoLike(value) {
  const text = String(value || '').trim();
  const m = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?/);
  if (!m) return null;
  return parseLocalEpoch([Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]), parseFractionMs(m[7])]);
}

function normalizeRowKeys(row, normalizer = normalizeHeader) {
  const out = {};
  for (const [key, val] of Object.entries(row || {})) out[normalizer(key)] = val;
  return out;
}

const sourceFolders = {
  BSSNotifications: [/logs\/LLCINotifications\/BSS\//i],
  IPSNotifications: [/logs\/LLCINotifications\/IPS\//i],
  FECNotifications: [/logs\/FECNotifications\//i],
  AlertsMonitoring: [/logs\/AlertsMonitoring\//i],
  MachineStates: [/logs\/MachineStates\//i]
};

function baseAdapter(sourceType, pathPatterns, order = 'ISO') {
  return {
    sourceType,
    pathPatterns,
    requiredFields: [],
    canHandlePath(path) { return pathPatterns.some(re => re.test(path)) && /\.csv$/i.test(path); },
    canHandleContainerPath(path) { return pathPatterns.some(re => re.test(path)); },
    cleanText: text => String(text || '').replace(/\uFEFF/g, '').replace(/\r\n/g, '\n'),
    normalizeHeader,
    normalizeRow: row => normalizeRowKeys(row),
    getTimestampMs(row) { return order === 'DMY' ? parseTimestampByFormat(row.Timestamp || row.Time || row.DateTime, 'DMY') : parseIsoLike(row.Timestamp || row.Time || row.DateTime) ?? parseTimestampByFormat(row.Timestamp || row.Time || row.DateTime, 'MDY'); },
    getPreferredSignal(row) { return row.Signal || row.Parameter || row.Name || row.Message || row.ParameterType || ''; },
    getCompositeSignal(row) { return [row.Component, row.SubComponent, row.ParameterType, row.Signal].filter(Boolean).join(' '); },
    getNumericValue(row) { return parseNumber(row.Value ?? row.Actual ?? row.NumericValue); },
    getComponent(row) { return row.Component || ''; },
    getSystem(row, rule) { return row.System || rule.system; },
    getSubsystem(row, rule) { return row.Subsystem || rule.subsystem; }
  };
}

export const ADAPTERS = {
  BSSNotifications: {
    ...baseAdapter('BSSNotifications', sourceFolders.BSSNotifications, 'MDY'),
    requiredFields: ['Timestamp', 'Action', 'MessageType', 'LLCIKey', 'MachineType', 'Component', 'SubComponent', 'ParameterType', 'Value', 'IsAlert'],
    cleanText: cleanCsvText,
    normalizeHeader,
    getTimestampMs(row) { return parseTimestampByFormat(row.Timestamp, 'MDY'); },
    getPreferredSignal(row) { return row.SubComponent || row.ParameterType || ''; },
    getCompositeSignal(row) { return [row.Component, row.SubComponent, row.ParameterType].filter(Boolean).join(' '); },
    getNumericValue(row) { return parseNumber(row.Value); },
    getComponent(row) { return row.Component || ''; },
    getSubsystem(row, rule) { return row.SubComponent || rule.subsystem; }
  },
  IPSNotifications: baseAdapter('IPSNotifications', sourceFolders.IPSNotifications, 'MDY'),
  FECNotifications: baseAdapter('FECNotifications', sourceFolders.FECNotifications, 'ISO'),
  AlertsMonitoring: baseAdapter('AlertsMonitoring', sourceFolders.AlertsMonitoring, 'ISO'),
  MachineStates: {
    ...baseAdapter('MachineStates', sourceFolders.MachineStates, 'DMY'),
    getTimestampMs(row) { return parseTimestampByFormat(row.Timestamp || row.Time || row.DateTime, 'DMY'); }
  }
};

export function getAdapter(sourceType) {
  return ADAPTERS[sourceType] || null;
}

export function matchRuleForRow(adapter, row, rules) {
  if (!rules?.length) return [];
  if (adapter.sourceType === 'BSSNotifications') {
    const sub = normalizeToken(row.SubComponent);
    const parameter = normalizeToken(row.ParameterType);
    const composite = normalizeToken([row.Component, row.SubComponent, row.ParameterType].filter(Boolean).join(' '));
    return rules.filter(rule => {
      if (rule.normSignal === sub) return true;
      if (rule.normSignal === parameter) return true;
      if (rule.normSignal === composite) return true;
      const raw = [sub, parameter, composite].filter(Boolean);
      return rule.normSignal.length >= 5 && raw.some(part => part.includes(rule.normSignal) || rule.normSignal.includes(part));
    });
  }
  const preferred = normalizeToken(adapter.getPreferredSignal(row));
  const composite = normalizeToken(adapter.getCompositeSignal(row));
  return rules.filter(rule => rule.normSignal === preferred || rule.normSignal === composite || (rule.normSignal.length >= 5 && (preferred.includes(rule.normSignal) || composite.includes(rule.normSignal))));
}
