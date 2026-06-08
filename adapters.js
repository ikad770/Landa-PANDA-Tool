import { normalizeSourceIdentity } from './config.js';
import { normalizeState, normalizeText, normalizeToken, parseNumber } from './evaluation.js';

export function cleanCsvText(text) {
  return String(text || '').replace(/\uFEFF/g, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

export function normalizeHeader(value) {
  return normalizeText(value).replace(/^"+|"+$/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

export function parseFlexibleTimestamp(value) {
  if (value instanceof Date) return value.getTime();
  const text = normalizeText(value).replace(',', '.');
  if (!text) return null;
  const parsed = Date.parse(text);
  if (Number.isFinite(parsed)) return parsed;
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,6}))?\s*(AM|PM)?$/i);
  if (!match) return null;
  let first = Number(match[1]);
  let second = Number(match[2]);
  const year = Number(match[3].length === 2 ? `20${match[3]}` : match[3]);
  let hour = Number(match[4]);
  const ampm = String(match[8] || '').toUpperCase();
  if (ampm === 'PM' && hour < 12) hour += 12;
  if (ampm === 'AM' && hour === 12) hour = 0;
  let month = first;
  let day = second;
  if (first > 12 && second <= 12) { day = first; month = second; }
  const ms = Number(String(match[7] || '').padEnd(3, '0').slice(0, 3)) || 0;
  const date = new Date(year, month - 1, day, hour, Number(match[5]), Number(match[6] || 0), ms);
  const ts = date.getTime();
  return Number.isFinite(ts) ? ts : null;
}

export function normalizeSourceRow(row, sourceName = 'uploaded-log') {
  const normalized = {};
  for (const [key, value] of Object.entries(row || {})) normalized[normalizeHeader(key)] = value;
  const timestampRaw = firstValue(normalized, ['timestamp', 'time', 'date_time', 'datetime', 'date', 'logged_at']);
  const timestampMs = parseFlexibleTimestamp(timestampRaw);
  const signalName = normalizeText(firstValue(normalized, ['signal', 'signal_name', 'log_signal_name', 'name', 'parameter', 'tag', 'description']));
  const valueRaw = firstValue(normalized, ['value', 'numeric_value', 'actual', 'reading', 'metric']);
  const numericValue = parseNumber(valueRaw);
  const unit = normalizeText(firstValue(normalized, ['unit', 'units', 'uom']));
  const rawState = firstValue(normalized, ['machine_state', 'state', 'machine', 'system_state']);
  const machineState = normalizeState(rawState);
  const systemState = normalizeState(firstValue(normalized, ['system_state', 'subsystem_state']));
  const source = normalizeText(firstValue(normalized, ['source', 'log_source'])) || sourceName;
  if (!Number.isFinite(timestampMs) || !signalName) return null;
  return {
    sourceId: normalizeSourceIdentity(source),
    sourceName: source,
    signalName,
    normalizedSignal: normalizeToken(signalName),
    timestampMs,
    numericValue,
    unit: unit || null,
    rawState: normalizeText(rawState) || null,
    machineState,
    systemState
  };
}

function firstValue(row, names) {
  for (const name of names) if (row[name] !== undefined && row[name] !== null && row[name] !== '') return row[name];
  return null;
}

export function parseDelimitedText(text, sourceName = 'uploaded-log') {
  const clean = cleanCsvText(text);
  const lines = clean.split('\n').filter(line => line.trim());
  if (lines.length < 2) return [];
  const delimiter = chooseDelimiter(lines[0]);
  const headers = splitLine(lines[0], delimiter).map(normalizeHeader);
  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cells = splitLine(lines[i], delimiter);
    const row = {};
    for (let c = 0; c < headers.length; c += 1) row[headers[c]] = cells[c] ?? '';
    const normalized = normalizeSourceRow(row, sourceName);
    if (normalized) rows.push(normalized);
  }
  return rows;
}

function chooseDelimiter(header) {
  const candidates = [',', '\t', ';', '|'];
  let best = ',';
  let bestCount = 0;
  for (const delimiter of candidates) {
    const count = header.split(delimiter).length;
    if (count > bestCount) { best = delimiter; bestCount = count; }
  }
  return best;
}

function splitLine(line, delimiter) {
  const out = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') { quoted = !quoted; continue; }
    if (ch === delimiter && !quoted) { out.push(current.trim()); current = ''; continue; }
    current += ch;
  }
  out.push(current.trim());
  return out;
}
