import { ADAPTERS } from './adapters.js';
import { expectedValuesFromRow, inferCheckType, normalizeCheckType, normalizeText, normalizeToken, parseRangeSpec, parseThreshold, parseTolerance, validateRule } from './evaluation.js';

const HEADER_ALIASES = {
  System: ['System', 'Machine System', 'PANDA System'],
  Subsystem: ['Subsystem', 'Sub System', 'Sub-system'],
  Component: ['Component', 'Machine Component'],
  'Log Signal Name': ['Log Signal Name', 'Signal Name', 'Log Signal', 'Signal', 'Parameter Signal'],
  'Log Source': ['Log Source', 'Source', 'LogSource', 'Log File', 'Data Source']
};
const REQUIRED_HEADER_GROUPS = ['System', 'Log Signal Name', 'Log Source'];

function headerKey(value) {
  return normalizeToken(value);
}

function rowHasHeader(row, canonical) {
  const keys = new Set(row.map(headerKey));
  return (HEADER_ALIASES[canonical] || [canonical]).some(alias => keys.has(headerKey(alias)));
}

function getCell(row, candidates) {
  const normalized = Object.fromEntries(Object.entries(row || {}).map(([key, value]) => [headerKey(key), value]));
  for (const name of candidates) {
    const value = row[name] ?? normalized[headerKey(name)];
    if (value !== undefined && normalizeText(value) !== '') return value;
  }
  return '';
}

function canonicalizeHeader(name, idx) {
  const clean = normalizeText(name) || `Column ${idx + 1}`;
  for (const [canonical, aliases] of Object.entries(HEADER_ALIASES)) {
    if (aliases.some(alias => headerKey(alias) === headerKey(clean))) return canonical;
  }
  return clean;
}

export function parseRulesWorkbook(XLSX, buffer, audit) {
  audit.rulesFileLoaded = true;
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheetName = workbook.SheetNames.find(name => /panda rules template/i.test(name)) || workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error('Rules workbook does not contain a readable sheet.');
  audit.rulesSheetFound = true;
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  const headerIndex = rows.findIndex(row => REQUIRED_HEADER_GROUPS.every(required => rowHasHeader(row, required)));
  if (headerIndex < 0) throw new Error('Could not detect the real Rules header row with System, Log Signal Name, and Log Source.');
  audit.rulesHeaderRow = headerIndex + 1;
  const rawHeader = rows[headerIndex].map(normalizeText);
  const normalizedHeaderByIndex = rawHeader.map(canonicalizeHeader);
  const rules = [];
  for (let i = headerIndex + 1; i < rows.length; i += 1) {
    const values = rows[i];
    if (!values.some(cell => normalizeText(cell))) continue;
    const row = Object.fromEntries(normalizedHeaderByIndex.map((name, idx) => [name, values[idx] ?? '']));
    const { expectedByState, expectedRangeByState, genericExpected, genericExpectedRange } = expectedValuesFromRow(row);
    const explicitRange = parseRangeSpec(getCell(row, ['Allowed Range', 'Spec Range', 'Expected Range']));
    const rawLogSource = normalizeText(getCell(row, ['Log Source', 'Source', 'LogSource']));
    const logSource = canonicalLogSource(rawLogSource);
    const checkType = normalizeText(getCell(row, ['Check Type', 'Check', 'Validation Type']));
    const rule = {
      id: `R${i + 1}`,
      ruleId: `R${i + 1}`,
      row: i + 1,
      system: normalizeText(row.System),
      subsystem: normalizeText(row.Subsystem),
      component: normalizeText(row.Component),
      parameterName: normalizeText(getCell(row, ['Parameter Name', 'Parameter', 'Name']) || row['Log Signal Name']),
      parameterType: normalizeText(getCell(row, ['Parameter Type', 'Type'])),
      unit: normalizeText(getCell(row, ['Unit', 'Units'])),
      signal: normalizeText(row['Log Signal Name']),
      normSignal: normalizeToken(row['Log Signal Name']),
      logSource,
      sourceType: logSource,
      checkType,
      checkTypeNormalized: normalizeCheckType(checkType),
      expectedByState,
      expectedRangeByState,
      genericExpected,
      genericExpectedRange,
      expectedLow: explicitRange?.low ?? genericExpectedRange?.low ?? null,
      expectedHigh: explicitRange?.high ?? genericExpectedRange?.high ?? null,
      tolerance: parseTolerance(getCell(row, ['Spec Tolerance', 'Tolerance', 'Allowed Tolerance', 'Limit', 'Threshold', 'Allowed Range'])),
      warningLow: parseThreshold(getCell(row, ['Warning Low', 'Warning Min', 'WarningLow'])),
      warningHigh: parseThreshold(getCell(row, ['Warning High', 'Warning Max', 'WarningHigh'])),
      criticalLow: parseThreshold(getCell(row, ['Critical Low', 'Critical Min', 'CriticalLow'])),
      criticalHigh: parseThreshold(getCell(row, ['Critical High', 'Critical Max', 'CriticalHigh'])),
      warningAction: normalizeText(getCell(row, ['Warning Action', 'Recommended Action', 'Action'])),
      criticalAction: normalizeText(getCell(row, ['Critical Action', 'Service Action'])),
      recommendedAction: normalizeText(getCell(row, ['Recommended Action', 'Action', 'Service Action']))
    };
    rule.evaluator = inferCheckType(rule);
    rule.evaluatorInferred = !rule.checkType && !!rule.evaluator;
    rule.checkTypeNormalized = rule.evaluator || normalizeCheckType(checkType);
    const invalidReason = ADAPTERS[rule.sourceType] ? validateRule(rule) : 'unsupported_log_source';
    rule.validity = invalidReason === 'valid' ? 'valid' : 'invalid';
    rule.invalidReason = invalidReason === 'valid' ? '' : invalidReason;
    rules.push(rule);
  }
  audit.rulesParsed = rules.length;
  audit.validRules = rules.filter(rule => rule.validity === 'valid').length;
  audit.invalidRules = rules.length - audit.validRules;
  return rules;
}

export function buildAnalysisPlan(rules) {
  const validRules = rules.filter(rule => rule.validity === 'valid' && ADAPTERS[rule.sourceType]);
  const systems = new Set();
  const adaptersRequired = new Set();
  const rulesBySystem = new Map();
  const rulesBySource = new Map();
  const requiredSignals = new Map();
  for (const rule of validRules) {
    systems.add(rule.system);
    adaptersRequired.add(rule.sourceType);
    if (!rulesBySystem.has(rule.system)) rulesBySystem.set(rule.system, []);
    if (!rulesBySource.has(rule.sourceType)) rulesBySource.set(rule.sourceType, []);
    if (!requiredSignals.has(rule.sourceType)) requiredSignals.set(rule.sourceType, new Set());
    rulesBySystem.get(rule.system).push(rule);
    rulesBySource.get(rule.sourceType).push(rule);
    requiredSignals.get(rule.sourceType).add(rule.normSignal);
  }
  const stateContextRequired = validRules.some(rule => Object.keys(rule.expectedByState || {}).length > 0);
  return { validRules, systems, adaptersRequired, rulesBySystem, rulesBySource, requiredSignals, stateContextRequired };
}

export function serializePlan(plan) {
  return {
    systems: [...plan.systems],
    adaptersRequired: [...plan.adaptersRequired],
    stateContextRequired: plan.stateContextRequired,
    rulesBySystem: Object.fromEntries([...plan.rulesBySystem].map(([system, rows]) => [system, rows.length])),
    requiredSignals: Object.fromEntries([...plan.requiredSignals].map(([source, signals]) => [source, [...signals]]))
  };
}

function canonicalLogSource(value) {
  const token = normalizeToken(value);
  const map = {
    bssnotifications: 'BSSNotifications',
    bssnotification: 'BSSNotifications',
    ipsnotifications: 'IPSNotifications',
    ipsnotification: 'IPSNotifications',
    fecnotifications: 'FECNotifications',
    fecnotification: 'FECNotifications',
    machinestates: 'MachineStates',
    alertsmonitoring: 'AlertsMonitoring',
    aletrsmonitoring: 'AlertsMonitoring'
  };
  return map[token] || normalizeText(value);
}
