import { normalizeSourceIdentity } from './config.js';
import { normalizeState, normalizeText, normalizeToken, parseNumber } from './evaluation.js';

const BSS_HEADERS = ['Timestamp', 'Action', 'MessageType', 'LLCIKey', 'MachineType', 'Component', 'SubComponent', 'ParameterType', 'Value', 'IsAlert'];
const FEC_HEADERS = ['Timestamp', 'Type', 'CableId', 'PSSID', 'SetPoint', 'Enabled', 'HasErrors', 'HasWarnings', 'PSCState', 'Status', 'State'];
export const MACHINE_STATE_COLUMNS = ['Machine', 'BSS', 'IPS', 'PSS', 'Dryer', 'IPU', 'Ventilation', 'CWS', 'IRD', 'DFES', 'DPS', 'QCS', 'ICS', 'ECS', 'MSPS', 'ITS'];
const MACHINE_STATES_HEADERS = ['Time', ...MACHINE_STATE_COLUMNS];

export function cleanCsvText(text) {
  return String(text || '').replace(/\uFEFF/g, '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\uFFFD]/g, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

export function normalizeHeader(value) {
  return normalizeText(value).replace(/^"+|"+$/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function sameHeaders(headers, expected) {
  if (headers.length !== expected.length) return false;
  return expected.every((header, index) => normalizeHeader(headers[index]) === normalizeHeader(header));
}

export function detectLogSchema(headers = [], sourceName = '') {
  const rawHeaders = headers.map(header => normalizeText(header));
  if (sameHeaders(rawHeaders, BSS_HEADERS)) return 'bss_notification';
  if (sameHeaders(rawHeaders, FEC_HEADERS)) return 'fec_notification';
  if (sameHeaders(rawHeaders, MACHINE_STATES_HEADERS)) return 'machine_states';
  if (/machinestates/i.test(sourceName || '') && sameHeaders(rawHeaders, MACHINE_STATES_HEADERS)) return 'machine_states';
  return 'generic';
}

export function parseFlexibleTimestamp(value) {
  if (value instanceof Date) return value.getTime();
  const text = cleanTimestampText(value);
  if (!text) return null;
  const dmy = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})(?::(\d{1,6})|\.(\d{1,6}))?\s*$/);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    const year = Number(dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3]);
    const hour = Number(dmy[4]);
    const minute = Number(dmy[5]);
    const second = Number(dmy[6]);
    const fraction = dmy[7] || dmy[8] || '';
    const ms = Number(fraction.padEnd(3, '0').slice(0, 3)) || 0;
    return localTimestamp(year, month, day, hour, minute, second, ms);
  }
  const isoParsed = Date.parse(text);
  if (Number.isFinite(isoParsed) && /^\d{4}-\d{2}-\d{2}/.test(text)) return isoParsed;
  const ampmMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,6}))?\s*(AM|PM)$/i);
  if (!ampmMatch) return null;
  let hour = Number(ampmMatch[4]);
  const ampm = ampmMatch[8].toUpperCase();
  if (ampm === 'PM' && hour < 12) hour += 12;
  if (ampm === 'AM' && hour === 12) hour = 0;
  return localTimestamp(Number(ampmMatch[3].length === 2 ? `20${ampmMatch[3]}` : ampmMatch[3]), Number(ampmMatch[2]), Number(ampmMatch[1]), hour, Number(ampmMatch[5]), Number(ampmMatch[6] || 0), Number(String(ampmMatch[7] || '').padEnd(3, '0').slice(0, 3)) || 0);
}

function cleanTimestampText(value) {
  return String(value ?? '').replace(/\uFEFF/g, '').replace(/[\u0000-\u001F\u007F\uFFFD]/g, '').replace(',', '.').trim();
}

function localTimestamp(year, month, day, hour, minute, second, ms) {
  if (![year, month, day, hour, minute, second, ms].every(Number.isFinite)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return null;
  const date = new Date(year, month - 1, day, hour, minute, second, ms);
  const ts = date.getTime();
  return Number.isFinite(ts) ? ts : null;
}

export function parseBssNotificationRow(row, context = {}) {
  const timestampMs = parseFlexibleTimestamp(row.Timestamp);
  const action = normalizeText(row.Action);
  const messageType = normalizeText(row.MessageType);
  const component = normalizeText(row.Component) || 'Unclassified';
  const signalName = normalizeText(row.SubComponent);
  if (!Number.isFinite(timestampMs)) return null;
  if (action === 'StateMachine') {
    const state = normalizeText(row.ParameterType);
    return state ? { kind: 'state_update', sourceType: 'bss', sourceName: context.sourceName || 'BSS Notifications', timestampMs, scope: 'machine', machineState: normalizeState(state) || state, rawState: state, metadata: { action } } : null;
  }
  if (action === 'SubsystemState') {
    const state = normalizeText(row.Value);
    return state ? { kind: 'state_update', sourceType: 'bss', sourceName: context.sourceName || 'BSS Notifications', timestampMs, scope: 'system', subsystem: 'BSS', component, stateStream: signalName || component, systemState: normalizeState(state) || state, rawState: state, metadata: { action } } : null;
  }
  if (messageType !== 'Parameter' || !signalName) return null;
  const numericValue = parseNumber(row.Value);
  const metadata = { valueType: normalizeText(row.ParameterType) || null, machineType: normalizeText(row.MachineType) || null, isAlert: parseBoolean(row.IsAlert), action };
  if (!Number.isFinite(numericValue)) return { kind: 'metadata_signal', sourceType: 'bss', sourceName: context.sourceName || 'BSS Notifications', subsystem: 'BSS', component, deviceGroup: component, signalId: normalizeText(row.LLCIKey) || null, signalName, normalizedSignal: normalizeToken(signalName), timestampMs, unit: inferUnit(signalName), dataType: metadata.valueType || 'metadata', metadata };
  return { kind: 'sample', sourceType: 'bss', sourceId: normalizeSourceIdentity('BSS'), sourceName: context.sourceName || 'BSS Notifications', subsystem: 'BSS', component, deviceGroup: component, signalId: normalizeText(row.LLCIKey) || null, signalName, normalizedSignal: normalizeToken(signalName), timestampMs, numericValue, unit: inferUnit(signalName), machineState: null, systemState: null, metadata };
}

export function parseFecNotificationRow(row, context = {}) {
  const timestampMs = parseFlexibleTimestamp(row.Timestamp);
  const type = normalizeText(row.Type);
  if (!Number.isFinite(timestampMs)) return null;
  const parsed = parsePssid(row.PSSID);
  if (type === 'StateMachine') {
    const subsystem = normalizeText(row.PSSID) || 'FEC';
    const state = normalizeText(row.State);
    return state ? { kind: 'state_update', sourceType: 'fec', sourceName: context.sourceName || 'FEC Notifications', timestampMs, scope: 'system', subsystem: canonicalFecSubsystem(subsystem), component: subsystem, stateStream: subsystem, systemState: normalizeState(state) || state, rawState: state, metadata: { type } } : null;
  }
  if (!['DeviceStatus', 'ControlStatus'].includes(type) || !parsed.signalName) return null;
  const numericValue = parseNumber(row.SetPoint);
  const inferred = inferFecSignal(parsed.signalName);
  const metadata = { type, rawPssid: normalizeText(row.PSSID), signalNumericId: parsed.signalNumericId, deviceInstance: normalizeText(row.CableId) || null, enabled: parseBoolean(row.Enabled), hasErrors: parseBoolean(row.HasErrors), hasWarnings: parseBoolean(row.HasWarnings), deviceState: normalizeText(row.PSCState) || null, statusCode: normalizeText(row.Status) || null, state: normalizeText(row.State) || null };
  if (!Number.isFinite(numericValue)) return { kind: 'metadata_signal', sourceType: 'fec', sourceName: context.sourceName || 'FEC Notifications', subsystem: inferred.subsystem, component: inferred.component, deviceGroup: inferred.deviceGroup, signalId: parsed.signalNumericId || metadata.deviceInstance || null, signalName: parsed.signalName, normalizedSignal: normalizeToken(parsed.signalName), timestampMs, unit: inferUnit(parsed.signalName), dataType: type, metadata };
  return { kind: 'sample', sourceType: 'fec', sourceId: normalizeSourceIdentity('FEC'), sourceName: context.sourceName || 'FEC Notifications', subsystem: inferred.subsystem, component: inferred.component, deviceGroup: inferred.deviceGroup, signalId: parsed.signalNumericId || metadata.deviceInstance || null, signalName: parsed.signalName, normalizedSignal: normalizeToken(parsed.signalName), timestampMs, numericValue, unit: inferUnit(parsed.signalName), machineState: null, systemState: null, metadata };
}

export function parsePssid(value) {
  const raw = normalizeText(value);
  const match = raw.match(/^(.*?)(?:\((\d+)\))\s*$/);
  return { signalName: normalizeText(match ? match[1] : raw), signalNumericId: match ? match[2] : null, rawPssid: raw };
}

export function inferFecSignal(signalName) {
  const name = normalizeText(signalName);
  const ipu = name.match(/\b(IPU[1-7])\b/i) || name.match(/^(IPU[1-7])/i);
  if (ipu) return { subsystem: 'IPU', component: ipu[1].toUpperCase(), deviceGroup: ipu[1].toUpperCase() };
  const dry = name.match(/\b(DRY\s*(?:1[01]|[1-9]))\b/i) || name.match(/^(?:AL\s*(1[01]|[1-9])\s+Temp|Ch\s*(1[01]|[1-9])\s+Heater|Ch(1[01]|[1-9])PeakCurrent)/i);
  if (dry) {
    const unit = dry[1] ? dry[1].replace(/\s+/g, '').toUpperCase() : `DRY${dry[2] || dry[3]}`;
    return { subsystem: 'IRD', component: unit, deviceGroup: unit };
  }
  if (/WaterInTemp|WaterOutTemp|CWSSupplyTemp|CWSReturnTemp/i.test(name)) return { subsystem: 'CWS', component: 'CWS', deviceGroup: 'CWS' };
  if (/Ventilation/i.test(name)) return { subsystem: 'Ventilation', component: 'Ventilation', deviceGroup: 'Ventilation' };
  return { subsystem: 'FEC', component: 'Unclassified', deviceGroup: 'Unclassified' };
}

function canonicalFecSubsystem(value) {
  if (/^Dryer$/i.test(value) || /^IRD$/i.test(value)) return 'IRD';
  return normalizeText(value) || 'FEC';
}

export function parseMachineStatesRows(rows, context = {}) {
  const transitions = [];
  const current = Object.fromEntries(MACHINE_STATE_COLUMNS.map(column => [column, null]));
  for (const row of rows) {
    const timestampMs = parseFlexibleTimestamp(row.Time);
    if (!Number.isFinite(timestampMs)) continue;
    for (const column of MACHINE_STATE_COLUMNS) {
      const raw = normalizeText(row[column]);
      if (!raw || raw === '---') continue;
      const state = normalizeState(raw) || raw;
      if (current[column] === state) continue;
      current[column] = state;
      transitions.push({ kind: 'state_update', sourceType: 'machine_states', sourceName: context.sourceName || 'MachineStates', timestampMs, scope: column === 'Machine' ? 'machine' : 'system', subsystem: column === 'Machine' ? null : column, component: column, stateStream: column, machineState: column === 'Machine' ? state : null, systemState: column === 'Machine' ? null : state, rawState: raw, metadata: { column } });
    }
  }
  return transitions;
}

export function normalizeGenericRow(row, sourceName = 'uploaded-log') {
  const normalized = {};
  for (const [key, value] of Object.entries(row || {})) normalized[normalizeHeader(key)] = value;
  const timestampRaw = firstValue(normalized, ['timestamp', 'time', 'date_time', 'datetime', 'date', 'logged_at']);
  const timestampMs = parseFlexibleTimestamp(timestampRaw);
  const signalName = normalizeText(firstValue(normalized, ['signal', 'signal_name', 'log_signal_name', 'name', 'parameter', 'tag', 'description']));
  const valueRaw = firstValue(normalized, ['value', 'numeric_value', 'actual', 'reading', 'metric']);
  const numericValue = parseNumber(valueRaw);
  const unit = normalizeText(firstValue(normalized, ['unit', 'units', 'uom']));
  const rawState = firstValue(normalized, ['machine_state', 'state', 'machine', 'system_state']);
  const machineState = normalizeState(rawState) || normalizeText(rawState) || null;
  const systemStateRaw = firstValue(normalized, ['system_state', 'subsystem_state']);
  const systemState = normalizeState(systemStateRaw) || normalizeText(systemStateRaw) || null;
  const source = normalizeText(firstValue(normalized, ['source', 'log_source'])) || sourceName;
  if (!Number.isFinite(timestampMs) || !signalName || !Number.isFinite(numericValue)) return null;
  return { kind: 'sample', sourceType: 'generic', sourceId: normalizeSourceIdentity(source), sourceName: source, subsystem: normalizeText(firstValue(normalized, ['subsystem', 'system'])) || 'Generic', component: normalizeText(firstValue(normalized, ['component', 'device_group'])) || 'Unclassified', deviceGroup: normalizeText(firstValue(normalized, ['device_group', 'component'])) || 'Unclassified', signalName, normalizedSignal: normalizeToken(signalName), timestampMs, numericValue, unit: unit || null, rawState: normalizeText(rawState) || null, machineState, systemState, metadata: {} };
}

export const normalizeSourceRow = normalizeGenericRow;

function firstValue(row, names) {
  for (const name of names) if (row[name] !== undefined && row[name] !== null && row[name] !== '') return row[name];
  return null;
}

export function parseDelimitedText(text, sourceName = 'uploaded-log', options = {}) {
  const { onRow = null, onUnsupported = null, onSchema = null, collect = true } = options || {};
  const clean = cleanCsvText(text);
  const lines = clean.split('\n').filter(line => line.trim());
  if (lines.length < 2) return collect === false ? [] : [];
  const delimiter = chooseDelimiter(lines[0]);
  const rawHeaders = splitLine(lines[0], delimiter);
  const schema = detectLogSchema(rawHeaders, sourceName);
  if (onSchema) onSchema({ schema, sourceName, headers: rawHeaders.map(header => normalizeText(header)) });
  const headers = schema === 'generic' ? rawHeaders.map(normalizeHeader) : rawHeaders.map(header => normalizeText(header));
  const rows = collect === false ? null : [];
  const matrixRows = schema === 'machine_states' ? [] : null;
  const emit = item => {
    if (!item) return;
    if (onRow) onRow(item);
    if (rows) rows.push(item);
  };
  for (let i = 1; i < lines.length; i += 1) {
    const cells = splitLine(lines[i], delimiter);
    const row = {};
    for (let c = 0; c < headers.length; c += 1) row[headers[c]] = cells[c] ?? '';
    if (schema === 'machine_states') { matrixRows.push(row); continue; }
    const parsed = schema === 'bss_notification' ? parseBssNotificationRow(row, { sourceName }) : schema === 'fec_notification' ? parseFecNotificationRow(row, { sourceName }) : normalizeGenericRow(row, sourceName);
    if (!parsed && onUnsupported) onUnsupported({ schema, sourceName, lineNumber: i + 1 });
    emit(parsed);
  }
  if (schema === 'machine_states') for (const item of parseMachineStatesRows(matrixRows, { sourceName })) emit(item);
  return rows || [];
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
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { current += '"'; i += 1; } else quoted = !quoted;
      continue;
    }
    if (ch === delimiter && !quoted) { out.push(current.trim()); current = ''; continue; }
    current += ch;
  }
  out.push(current.trim());
  return out;
}

function parseBoolean(value) {
  const token = normalizeText(value).toLowerCase();
  if (token === 'true') return true;
  if (token === 'false') return false;
  return null;
}

export function inferUnit(signalName) {
  const name = normalizeText(signalName);
  if (/temperature|tempc|temp$/i.test(name)) return '°C';
  if (/pressure|vacuum/i.test(name)) return 'pressure';
  if (/flowlpm/i.test(name)) return 'LPM';
  if (/levelmm/i.test(name)) return 'mm';
  if (/tension/i.test(name)) return 'tension';
  if (/speed|frequency/i.test(name)) return 'speed';
  if (/pwm|percent|%/i.test(name)) return '%';
  if (/current/i.test(name)) return 'A';
  return null;
}
