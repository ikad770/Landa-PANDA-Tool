import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { authenticateLocalPrototype, clearSession, createLocalSession, readStoredSession, storeSession, validateLoginFields } from '../auth.js';
import { AUTH_CONFIG, USER_FACING_STAGES, normalizeSourceIdentity } from '../config.js';
import { ADAPTERS, getRuleMatchesForRow, matchRuleForRow, parseSlashTimestamp, parseSourceTimestamp } from '../adapters.js';
import { consolidateDeviationEvents, evaluateValue, inferCheckType, normalizeState, normalizeToken, parseTolerance, summarizeStateComparisons, timeWeightedOutOfRange } from '../evaluation.js';
import { createStateIndex } from '../machine-states.js';
import { parseRulesWorkbook } from '../rules.js';
import { chooseInitialParameter, chooseInitialSystem, getServiceDecision, groupParameters, normalizeStatus, renderActualExpectedChart, renderComparisonGauge, validateAnalysisResult } from '../render.js';
import { buildServiceDecision } from '../service-decision.js';
import { renderHotspot } from '../render-radar.js';
import { sortComparisonRows } from '../render-drilldown.js';

function baseResult(overrides = {}) {
  const metadata = {
    rulesValid: 12,
    rulesEvaluated: 0,
    relevantSignalsRequired: 12,
    relevantSignalsFound: 11,
    relevantValuesFound: 570385,
    classifiedPoints: 1,
    fullyEvaluatedPoints: 0,
    needsValidationPoints: 1,
    needsConfigurationPoints: 0,
    blockedPoints: 1,
    evaluatedPoints: 0,
    blockingReason: 'All matched values require validation. Open Service Radar to review the blockers.',
    ...overrides.metadata
  };
  return {
    metadata,
    systemHealth: [{ system: 'BSS', status: 'needs_validation', matchedRows: 1, blockedPoints: 1 }],
    deviationEvents: [],
    signalSummaries: [{ ruleId: 'R1', system: 'BSS', signal: 'Temperature', status: 'needs_validation', matchedRows: 1, classifiedPoints: 1, fullyEvaluatedPoints: 0, latestActual: 42, blocker: 'invalid_timestamp', rawTimestamp: '03/12/2026 15:51:40:441145', timestampStatus: 'invalid' }],
    chartSeries: { R1: [{ t: null, rawTimestamp: '03/12/2026 15:51:40:441145', actual: 42, status: 'needs_validation', blocker: 'invalid_timestamp' }] },
    stateTimeline: [],
    diagnosticsSummary: { evaluationBlockers: { topBlocker: { reason: 'invalid_timestamp', count: 1, label: 'Invalid timestamp' } } },
    ...overrides,
    metadata
  };
}


assert.equal(normalizeSourceIdentity('BSSNotifications'), 'BSSNotifications', 'Canonical source identity is preserved');
assert.equal(normalizeSourceIdentity('BSS Notifications'), 'BSSNotifications', 'Spaced BSS source alias normalizes');
assert.equal(normalizeSourceIdentity('bssnotifications'), 'BSSNotifications', 'Lowercase BSS source alias normalizes');
assert.equal(normalizeSourceIdentity('BSS'), 'BSSNotifications', 'Short BSS source alias normalizes');
assert.equal(normalizeSourceIdentity('LLCINotifications/BSS'), 'BSSNotifications', 'BSS component path normalizes');
assert.equal(normalizeSourceIdentity('logs/LLCINotifications/BSS'), 'BSSNotifications', 'BSS log path normalizes');
const exactMatch = getRuleMatchesForRow(ADAPTERS.BSSNotifications, { SubComponent: 'FillActualTemperatureC', Component: 'Fill', ParameterType: 'Actual' }, [{ sourceType: 'BSSNotifications', normSignal: normalizeToken('FillActualTemperatureC') }]);
assert.equal(exactMatch[0].matchReason, 'exact_signal', 'Exact signal matching reports exact_signal');
const aliasMatch = getRuleMatchesForRow(ADAPTERS.BSSNotifications, { SubComponent: 'FillFlowMeterActualValue', Component: 'Fill', ParameterType: 'Actual' }, [{ sourceType: 'BSSNotifications', normSignal: normalizeToken('FillFlowMeterActualValve') }]);
assert.equal(aliasMatch[0].matchReason, 'alias', 'Alias signal matching reports alias');
const duplicateMatches = getRuleMatchesForRow(ADAPTERS.BSSNotifications, { SubComponent: 'FillActualTemperatureC', Component: 'Fill', ParameterType: 'Actual' }, [
  { sourceType: 'BSSNotifications', normSignal: normalizeToken('FillActualTemperatureC') },
  { sourceType: 'BSSNotifications', normSignal: normalizeToken('FillActualTemperatureC') }
]);
assert.equal(duplicateMatches.length, 2, 'Duplicate rule match detection sees multiple matching rules for one source row');
const fakeXlsxRows = [
  ['Generated report', '', '', '', ''],
  ['System', 'Subsystem', 'Component', 'Parameter Name', 'Log Signal Name', 'Log Source', 'Expected ON', 'Spec Tolerance'],
  ['BSS', 'BCU', 'Tub', 'Tub Level', 'TubActualLevelMM', 'BSS Notifications', 0, '±2']
];
const fakeXlsx = { read: () => ({ SheetNames: ['PANDA Rules Template'], Sheets: { 'PANDA Rules Template': {} } }), utils: { sheet_to_json: () => fakeXlsxRows } };
const ruleAudit = {};
const parsedRules = parseRulesWorkbook(fakeXlsx, new ArrayBuffer(0), ruleAudit);
assert.equal(ruleAudit.rulesHeaderRow, 2, 'Rules parser detects real header row instead of assuming row 1');
assert.equal(parsedRules[0].row, 3, 'Rules parser preserves actual Excel row number');
assert.equal(parsedRules[0].validity, 'valid', 'Blank Check Type does not make an otherwise evaluable rule incomplete');
assert.equal(parsedRules[0].sourceType, 'BSSNotifications', 'Rules parser normalizes configured log source');
assert.equal(parseSourceTimestamp('03/12/2026 15:51:40.441145', 'MDY').timestampFormat, 'MDY slash dot_fraction', 'Source parser records MDY dot microsecond format');
assert.equal(parseSourceTimestamp('03/12/2026 15:51:40:441145', 'MDY').timestampFormat, 'MDY slash colon_fraction', 'Source parser records MDY colon microsecond format');
assert.equal(parseSourceTimestamp('12/03/2026 07:02:21.093', 'DMY').timestampFormat, 'DMY slash dot_fraction', 'Source parser records DMY dot millisecond format');

assert.equal(new Date(parseSlashTimestamp('03/12/2026 15:51:40:441145', 'MDY')).getMilliseconds(), 441, 'BSS colon microseconds parse');
assert.equal(new Date(parseSlashTimestamp('03/12/2026 15:51:40.441145', 'MDY')).getMilliseconds(), 441, 'BSS dot microseconds parse');
assert.equal(new Date(parseSlashTimestamp('12/03/2026 07:02:21.093', 'DMY')).getMonth(), 2, 'MachineStates DMY timestamp parse');
assert.equal(new Date(parseSlashTimestamp('12/03/2026 07:02:21.093\u00A0', 'DMY')).getMilliseconds(), 93, 'MachineStates NBSP timestamp parse');
assert.equal(new Date(parseSlashTimestamp('31/12/2025 23:59:59.999', 'DMY')).getDate(), 31, 'DMY end-of-year timestamp parse');
assert.equal(new Date(parseSlashTimestamp('12/31/2025 23:59:59:999999', 'MDY')).getMilliseconds(), 999, 'MDY colon microseconds parse');
assert.equal(parseSlashTimestamp('31/12/2025 23:59:59.999', 'MDY'), null, 'Invalid MDY timestamp rejected without Date.parse fallback');
assert.equal(new Date(parseSlashTimestamp('03/12/2026 15:51:40:441145\\n  ', 'MDY')).getMilliseconds(), 441, 'Escaped newline timestamp is cleaned before manual parsing');
assert.equal(validateLoginFields({ username: '', password: '' }).valid, false, 'Login validation rejects missing credentials');
assert.equal(validateLoginFields({ username: 'Landa', password: 'Landa123456' }).valid, true, 'Login validation accepts populated local service credentials');
assert.equal(validateLoginFields({ username: '', password: 'Landa123456' }).errors.username, 'Username is required.', 'empty username reports required error');
assert.equal(validateLoginFields({ username: 'Landa', password: '' }).errors.password, 'Password is required.', 'empty password reports required error');
assert.equal(authenticateLocalPrototype({ username: 'Landa', password: 'Landa123456' }).ok, true, 'correct credentials authenticate');
assert.equal(authenticateLocalPrototype({ username: 'landa', password: 'Landa123456' }).message, 'Invalid username or password.', 'incorrect username fails concisely');
assert.equal(authenticateLocalPrototype({ username: 'Landa', password: 'landa123456' }).message, 'Invalid username or password.', 'incorrect password case fails concisely');
assert.equal(authenticateLocalPrototype({ username: 'Landa', password: 'wrongpassword' }).ok, false, 'wrong password fails');
const memoryStorage = new Map();
const storage = { getItem: key => memoryStorage.get(key) || null, setItem: (key, value) => memoryStorage.set(key, value), removeItem: key => memoryStorage.delete(key) };
const session = createLocalSession(AUTH_CONFIG.username);
storeSession(session, storage);
assert.equal(readStoredSession(storage).username, 'Landa', 'successful session persistence reads stored user');
clearSession(storage);
assert.equal(readStoredSession(storage), null, 'logout clears stored session');
assert.equal(USER_FACING_STAGES.length, 5, 'stage list has exactly five user-facing stages');

const needsValidation = validateAnalysisResult(baseResult());
assert.equal(needsValidation.valid, true, 'Needs Validation result should validate');
assert.equal(needsValidation.status, 'completed_with_warnings');
assert.equal(baseResult().signalSummaries[0].latestActual, 42, 'Invalid timestamp preserves numeric actual value');
assert.equal(baseResult().chartSeries.R1[0].actual, 42, 'Needs Validation chart samples should preserve actual values');
assert.notEqual(baseResult().metadata.relevantSignalsFound / baseResult().metadata.relevantSignalsRequired, baseResult().metadata.rulesEvaluated / baseResult().metadata.rulesValid, 'Signal Match Coverage differs from Fully Evaluated Coverage');

const uiResult = baseResult({
  metadata: { blockedPoints: 2, needsValidationPoints: 1, needsConfigurationPoints: 1 },
  systemHealth: [
    { system: 'BSS', status: 'needs_configuration', rules: 2, deviations: 0, blockedPoints: 1 },
    { system: 'IPS', status: 'warning', rules: 1, deviations: 2 },
    { system: 'QCS', status: 'ok', rules: 1, deviations: 0 },
    { system: 'DPS', status: 'no_rule', rules: 0, deviations: 0 }
  ],
  signalSummaries: [
    { ruleId: 'WARN', system: 'IPS', signal: 'Pressure', status: 'warning', latestActual: 31, expectedLow: 20, expectedHigh: 25, eventCount: 2 },
    { ruleId: 'CONFIG', system: 'BSS', signal: 'TankActualLevelMM', status: 'needs_configuration', latestActual: 674.54, expectedLow: null, expectedHigh: null, eventCount: 0, blocker: 'missing_expected_value' },
    { ruleId: 'VALID', system: 'BSS', signal: 'Temperature', status: 'needs_validation', latestActual: 29.2, expectedLow: 25, expectedHigh: 28, eventCount: 0, blocker: 'missing_state' },
    { ruleId: 'OK', system: 'QCS', signal: 'Quality', status: 'ok', latestActual: 1, expectedLow: 0, expectedHigh: 2, eventCount: 0 },
    { ruleId: 'NODATA', system: 'BSS', signal: 'Missing', status: 'no_data', latestActual: null, eventCount: 0 }
  ],
  chartSeries: { CONFIG: [{ t: 1, actual: 674.54, status: 'needs_configuration' }], WARN: [{ t: 1, actual: 31, expectedLow: 20, expectedHigh: 25, status: 'warning' }] },
  deviationEvents: [{ id: 'DW', system: 'IPS', signal: 'Pressure', severity: 'warning', latestActual: 31, expectedLow: 20, expectedHigh: 25, startTimestampMs: 1, endTimestampMs: 2, maximumDeviation: 6, machineStatesSeen: ['Printing'] }]
});

const decision = buildServiceDecision(uiResult);
assert.equal(decision.machineStatus, 'warning', 'serviceDecision machine status prioritizes operational warning over configuration issues');
assert.equal(decision.systemsAtRiskCount, 1, 'Systems at Risk counts only critical/warning systems');
assert.equal(decision.systemsRequiringAttentionCount, 2, 'Systems Requiring Attention includes operational and configuration/validation systems');
assert.equal(decision.operationalFindings.length, 1, 'Operational findings come from real deviation events');
assert.equal(decision.topFindings.length, 1, 'serviceDecision exposes top findings once centrally');
assert.equal(Array.isArray(decision.matchedSignals), true, 'serviceDecision exposes matched signals without recalculating in renderers');
assert.equal(decision.configurationProblems.length, 1, 'Configuration issues are separated at rule level');
assert.equal(decision.validationProblems.length, 1, 'Validation issues are separated at rule level');
assert.equal(decision.nextRecommendedAction, 'No service action configured for this rule.', 'Operational warning does not invent a service action when the rule has none');
assert.equal(decision.primarySystem, 'IPS', 'Primary system selection prefers systems at operational risk');
assert.equal(getServiceDecision(uiResult).machineStatus, 'warning', 'Renderer helper uses the same serviceDecision model');

const operationalResult = baseResult({
  metadata: { rulesEvaluated: 1, blockedPoints: 0, needsValidationPoints: 0, needsConfigurationPoints: 0 },
  systemHealth: [{ system: 'BSS', status: 'critical', rules: 1, deviations: 1 }],
  deviationEvents: [{ id: 'D1', system: 'BSS', signal: 'FillActualTemperatureC', severity: 'critical', latestActual: 91.2, expectedHigh: 90, startTimestampMs: 1, endTimestampMs: 2, machineStatesSeen: ['Printing'] }],
  signalSummaries: [{ ruleId: 'R1', system: 'BSS', signal: 'FillActualTemperatureC', status: 'critical', latestActual: 91.2, expectedLow: 80, expectedHigh: 90, eventCount: 1, fullyEvaluatedPoints: 1 }],
  chartSeries: { R1: [{ t: 1, actual: 91.2, expectedLow: 80, expectedHigh: 90, status: 'critical' }] }
});
assert.equal(buildServiceDecision(operationalResult).machineStatus, 'critical', 'Operational issue status is critical when a critical event exists');
assert.match(buildServiceDecision(operationalResult).machineSummary, /FillActualTemperatureC/, 'Machine summary names the responsible parameter');

const configOnlyResult = baseResult({
  metadata: { rulesEvaluated: 0, blockedPoints: 1, needsValidationPoints: 0, needsConfigurationPoints: 1 },
  systemHealth: [{ system: 'BSS', status: 'needs_configuration', rules: 1, deviations: 0 }],
  signalSummaries: [{ ruleId: 'C1', ruleRow: 6, system: 'BSS', signal: 'TankActualLevelMM', status: 'needs_configuration', latestActual: 674.54, blocker: 'missing_threshold_or_tolerance', matchedRows: 3 }],
  chartSeries: { C1: [{ t: 1, actual: 674.54, status: 'needs_configuration' }] }
});
const configDecision = buildServiceDecision(configOnlyResult);
assert.equal(configDecision.machineStatus, 'needs_configuration', 'Configuration-only problem is not counted as operational risk');
assert.equal(configDecision.systemsAtRiskCount, 0, 'Systems at Risk excludes configuration-only systems');
assert.match(configDecision.nextRecommendedAction, /Excel row 6|incomplete BSS rule/, 'Recommended configuration action points to Excel configuration');

const validationOnlyResult = baseResult();
assert.equal(buildServiceDecision(validationOnlyResult).machineStatus, 'needs_validation', 'Validation-only problem is distinct from configuration issue');

assert.equal(normalizeStatus('evaluator_pending'), 'needs_validation', 'Evaluator pending is visualized as Needs Validation');
assert.equal(chooseInitialSystem(uiResult), 'IPS', 'Initial selected system follows status priority');
assert.equal(chooseInitialParameter(uiResult, 'BSS').ruleId, 'VALID', 'Initial selected parameter uses parameter status priority');
const groups = groupParameters(uiResult.signalSummaries);
assert.equal(groups.find(group => group.key === 'warning').rows[0].ruleId, 'WARN', 'Warning has its own parameter group');
assert.equal(groups.find(group => group.key === 'configuration').rows[0].ruleId, 'CONFIG', 'Needs Configuration has its own parameter group');
assert.equal(groups.find(group => group.key === 'validation').rows[0].ruleId, 'VALID', 'Needs Validation has its own parameter group');
assert.match(renderComparisonGauge({ actual: 31, expectedLow: 20, expectedHigh: 25, warningLow: 18, warningHigh: 27, criticalLow: 15, criticalHigh: 30, status: 'warning' }), /gauge-marker/, 'Comparison gauge with full range renders actual marker');
assert.match(renderComparisonGauge({ actual: 674.54, status: 'needs_configuration' }), /Expected range not configured/, 'Comparison gauge without Expected range renders configuration placeholder');
assert.match(renderActualExpectedChart(uiResult.chartSeries.CONFIG, uiResult.signalSummaries[1], []), /Expected range is not configured/, 'Actual chart without Expected band keeps actual and shows configuration banner');
assert.equal(renderHotspot('DPS', uiResult.systemHealth[3], '', 'issues').includes('hotspot'), true, 'Hotspot renderer returns a hotspot component');
assert.match(renderHotspot('DPS', uiResult.systemHealth[3], '', 'all'), /quiet/, 'No-rule opacity behavior uses quiet class in All systems mode');

const ruleValve = { normSignal: normalizeToken('FillFlowMeterActualValve') };
assert.equal(matchRuleForRow(ADAPTERS.BSSNotifications, { SubComponent: 'FillFlowMeterActualValue', Component: 'Fill', ParameterType: 'Actual' }, [ruleValve]).length, 1, 'Alias Valve ↔ Value matches from rule to log');
const ruleValue = { normSignal: normalizeToken('WaterFlowMeterActualValue') };
assert.equal(matchRuleForRow(ADAPTERS.BSSNotifications, { SubComponent: 'WaterFlowMeterActualValve', Component: 'Water', ParameterType: 'Actual' }, [ruleValue]).length, 1, 'Alias Value ↔ Valve matches from rule to log');

assert.equal(ADAPTERS.BSSNotifications.getPreferredSignal({ Action: 'Get', SubComponent: 'InkPressure', Value: '48.72' }), 'InkPressure', 'BSS signal comes from SubComponent');
assert.equal(ADAPTERS.BSSNotifications.getNumericValue({ Action: 'Get', Value: '48.72' }), 48.72, 'Get rows provide numeric actual evaluation values');
assert.equal(ADAPTERS.BSSNotifications.getNumericValue({ Action: 'Set', Value: '48.72' }), 48.72, 'Set rows are classified but not automatically rejected when numeric');

const stateIndex = createStateIndex();
const t1 = parseSlashTimestamp('12/03/2026 07:00:00.000', 'DMY');
const t2 = parseSlashTimestamp('12/03/2026 07:05:00.000', 'DMY');
const t3 = parseSlashTimestamp('12/03/2026 07:10:00.000', 'DMY');
stateIndex.addRow(t1, { Machine: 'Standby', BSS: 'Ready' });
stateIndex.addRow(t2, { Machine: '---', BSS: '' });
stateIndex.addRow(t3, { Machine: 'Printing', BSS: 'Printing' });
stateIndex.finalize();
assert.deepEqual(stateIndex.series.Machine.map(row => row.value), ['Standby', 'Printing'], 'Sparse MachineStates forward-fill creates transitions only on change');
assert.equal(stateIndex.getStateAt(t2 + 1000, 'BSS').systemState, 'Ready', 'Binary search returns correct forward-filled state');
assert.equal(stateIndex.getStateAt(t3 + 1000, 'BSS').status, 'matched', 'Binary search returns matched machine/system state');

const stateDependentRule = { checkType: 'range', expectedByState: { printing: 10, standby: 4 }, genericExpected: null, tolerance: { mode: 'absolute', value: 1 }, warningLow: null, warningHigh: null, criticalLow: null, criticalHigh: null };
assert.equal(evaluateValue(stateDependentRule, 10.5, { status: 'matched', machineState: 'Printing', systemState: 'Printing' }).status, 'ok', 'State-specific expected range evaluates OK');
assert.equal(evaluateValue(stateDependentRule, 12, { status: 'matched', machineState: 'Printing', systemState: 'Printing' }).status, 'warning', 'Outside expected+tolerance range is warning');
assert.equal(evaluateValue(stateDependentRule, 12, { status: 'missing', machineState: null, systemState: null }).blocker, 'missing_state', 'State-dependent tolerance blocks when state is missing');

const needsConfigRule = { checkType: 'range', expectedByState: {}, genericExpected: null, tolerance: null, warningLow: null, warningHigh: null, criticalLow: null, criticalHigh: null };
const needsConfig = evaluateValue(needsConfigRule, 48.72, { status: 'matched', machineState: 'Printing', systemState: 'Printing' });
assert.equal(needsConfig.status, 'needs_configuration', 'Missing expected/threshold produces Needs Configuration');
assert.equal(48.72, 48.72, 'Needs Configuration preserves Actual in callers');

const thresholdRule = { checkType: 'range', expectedByState: { printing: 10 }, genericExpected: null, tolerance: null, warningLow: 5, warningHigh: 15, criticalLow: 2, criticalHigh: 20 };
assert.equal(evaluateValue(thresholdRule, 12, { status: 'missing' }).status, 'ok', 'Explicit thresholds can evaluate without MachineState');
assert.equal(evaluateValue(thresholdRule, 22, { status: 'missing' }).status, 'critical', 'Critical thresholds have priority');
assert.equal(evaluateValue(thresholdRule, 16, { status: 'missing' }).status, 'warning', 'Warning thresholds have second priority');

const css = fs.readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
assert.match(css, /html,\s*\nbody\s*{[^}]*overflow-x:\s*hidden/s, 'No page-level overflow CSS regression');
assert.match(css, /\.processing-stats\s*{[^}]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/s, 'Processing stats four-column layout exists');



const blankRangeRule = { checkType: '', expectedByState: { ON: 0 }, genericExpected: null, tolerance: parseTolerance('±2'), warningLow: null, warningHigh: null, criticalLow: null, criticalHigh: null };
assert.deepEqual(parseTolerance('±2'), { mode: 'absolute', value: 2 }, '±2 tolerance parses as absolute');
assert.deepEqual(parseTolerance('+/-2'), { mode: 'absolute', value: 2 }, '+/-2 tolerance parses as absolute');
assert.deepEqual(parseTolerance(2), { mode: 'absolute', value: 2 }, 'numeric Excel tolerance parses as absolute');
assert.deepEqual(parseTolerance('±10'), { mode: 'absolute', value: 10 }, '±10 tolerance parses as absolute');
assert.deepEqual(parseTolerance('±0.02'), { mode: 'absolute', value: 0.02 }, 'decimal tolerance parses as absolute');
assert.deepEqual(parseTolerance('±150'), { mode: 'absolute', value: 150 }, 'large absolute tolerance parses');
assert.deepEqual(parseTolerance('±10%'), { mode: 'percent', value: 10 }, '±10% tolerance parses as percent');
assert.deepEqual(parseTolerance('+/-10%'), { mode: 'percent', value: 10 }, '+/-10% tolerance parses as percent');
assert.deepEqual(parseTolerance('10%'), { mode: 'percent', value: 10 }, 'bare percent tolerance parses');
assert.deepEqual(parseTolerance('60 Max'), { mode: 'max', value: 60 }, 'max tolerance parses');
assert.deepEqual(parseTolerance('2500 Max'), { mode: 'max', value: 2500 }, '2500 Max tolerance parses');
assert.deepEqual(parseTolerance('2000 Max'), { mode: 'max', value: 2000 }, '2000 Max tolerance parses');
assert.deepEqual(parseTolerance('10 Min'), { mode: 'min', value: 10 }, 'min tolerance parses');
assert.equal(inferCheckType(blankRangeRule), 'range', 'Blank Check Type + Expected + ±2 infers Range');
assert.equal(inferCheckType({ ...blankRangeRule, tolerance: parseTolerance('60 Max') }), 'max', 'Blank Check Type + 60 Max infers max');
assert.equal(inferCheckType({ ...blankRangeRule, tolerance: parseTolerance('10 Min') }), 'min', 'Blank Check Type + 10 Min infers min');
assert.equal(inferCheckType({ ...blankRangeRule, tolerance: parseTolerance('±10%') }), 'range_percent', '±10% produces percentage range');
assert.equal(normalizeState('On'), 'ON', 'On normalizes to ON');
assert.equal(normalizeState('Prepare To Print'), 'Prepare2Print', 'Prepare To Print normalizes to Prepare2Print');
assert.equal(normalizeState('Print End'), 'PrintEnd', 'Print End normalizes to PrintEnd');
assert.equal(normalizeState('Initializing'), 'Initializing', 'Unsupported states are preserved');
const tubResult = evaluateValue(blankRangeRule, -9.12, { status: 'matched', machineState: 'On', systemState: 'On' });
assert.equal(tubResult.status, 'warning', 'TubActualLevelMM -9.12 against 0 ±2 returns Warning');
assert.equal(tubResult.expectedLow, -2, 'TubActualLevelMM allowed low is -2');
assert.equal(tubResult.expectedHigh, 2, 'TubActualLevelMM allowed high is 2');
assert.equal(Number(tubResult.distanceFromNearestLimit.toFixed(2)), 7.12, 'TubActualLevelMM deviation distance is 7.12');
const fillRule = { ...blankRangeRule, expectedByState: { ON: 25 } };
const fillResult = evaluateValue(fillRule, 29.2, { status: 'matched', machineState: 'On', systemState: 'On' });
assert.equal(fillResult.status, 'warning', 'FillActualTemperatureC 29.2 against 25 ±2 returns Warning');
assert.equal(fillResult.expectedLow, 23, 'FillActualTemperatureC allowed low is 23');
assert.equal(fillResult.expectedHigh, 27, 'FillActualTemperatureC allowed high is 27');
assert.equal(Number(fillResult.distanceFromNearestLimit.toFixed(2)), 2.2, 'FillActualTemperatureC deviation distance is 2.2');
assert.equal(evaluateValue(fillRule, 25.5, { status: 'matched', machineState: 'ON', systemState: 'ON' }).status, 'ok', 'Actual 25.5 against 25 ±2 returns OK');
assert.equal(evaluateValue(fillRule, 29.2, { status: 'matched', machineState: 'ON', systemState: 'ON' }).status, 'warning', 'Outside expected range does not become Critical without a critical rule');

const criticalRule = { checkType: '', expectedByState: { ON: 25 }, genericExpected: null, tolerance: parseTolerance('±2'), warningLow: null, warningHigh: null, criticalLow: 20, criticalHigh: 30 };
assert.equal(inferCheckType(criticalRule), 'threshold', 'Explicit Warning/Critical threshold columns infer threshold evaluator');
assert.equal(evaluateValue(criticalRule, 31, { status: 'matched', machineState: 'ON', systemState: 'ON' }).status, 'critical', 'Critical classification requires explicit critical threshold crossing');
assert.equal(evaluateValue({ ...fillRule, expectedByState: { Printing: 25 } }, 25, { status: 'matched', machineState: 'ON', systemState: 'ON' }).blocker, 'missing_expected_for_state', 'Expected lookup is state-dependent and blocks missing encountered state');
assert.equal(evaluateValue(fillRule, 25, { status: 'too_old', stateMatchStatus: 'too_old', machineState: 'ON', systemState: 'ON' }).status, 'needs_validation', 'Stale state context produces Needs Validation');


const noComparisonStatuses = [
  evaluateValue({ ...fillRule, expectedByState: { Printing: 25 } }, 25, { status: 'matched', machineState: 'ON', systemState: 'ON' }).status,
  evaluateValue({ ...fillRule, tolerance: null }, 25, { status: 'matched', machineState: 'ON', systemState: 'ON' }).status,
  evaluateValue(fillRule, Number.NaN, { status: 'matched', machineState: 'ON', systemState: 'ON' }).status
];
assert.equal(noComparisonStatuses.some(status => ['warning', 'critical'].includes(status)), false, 'No comparison never produces Warning/Critical');
const weighted = timeWeightedOutOfRange([
  { t: 0, status: 'ok' },
  { t: 1000, status: 'warning' },
  { t: 4000, status: 'warning' },
  { t: 5000, status: 'ok' }
]);
assert.equal(weighted.outOfRangeDurationMs, 4000, 'Out-of-range duration is time weighted');
assert.equal(weighted.outOfRangePercent, 80, 'Out-of-range percentage is time weighted');
const consolidated = consolidateDeviationEvents([
  { t: 0, status: 'warning', actual: 28, expectedValue: 25, allowedLow: 23, allowedHigh: 27, machineState: 'ON', deviation: 1 },
  { t: 10000, status: 'warning', actual: 29, expectedValue: 25, allowedLow: 23, allowedHigh: 27, machineState: 'ON', deviation: 2 },
  { t: 120000, status: 'warning', actual: 30, expectedValue: 25, allowedLow: 23, allowedHigh: 27, machineState: 'ON', deviation: 3 }
], 30000);
assert.equal(consolidated.length, 2, 'Consecutive abnormal samples are consolidated by state/severity/range/tolerance');
assert.equal(consolidated[0].pointCount, 2, 'Consolidated event keeps point count');

const percentResult = evaluateValue({ ...fillRule, tolerance: parseTolerance('10%') }, 28, { status: 'matched', machineState: 'ON', systemState: 'ON' });
assert.equal(percentResult.expectedLow, 22.5, 'Percent tolerance computes low band');
assert.equal(percentResult.expectedHigh, 27.5, 'Percent tolerance computes high band');
const changingRule = { ...blankRangeRule, expectedByState: { ON: 25, Printing: 40 } };
assert.equal(evaluateValue(changingRule, 25, { status: 'matched', machineState: 'ON', systemState: 'ON' }).expectedValue, 25, 'Expected band uses ON expected value');
assert.equal(evaluateValue(changingRule, 40, { status: 'matched', machineState: 'Printing', systemState: 'Printing' }).expectedValue, 40, 'Expected band changes when Machine State changes');
const stateSummary = summarizeStateComparisons([
  { machineState: 'ON', expectedState: 'ON', expected: 25, allowedLow: 23, allowedHigh: 27, expectedLow: 23, expectedHigh: 27, actual: 25, status: 'ok' },
  { machineState: 'ON', expectedState: 'ON', expected: 25, allowedLow: 23, allowedHigh: 27, expectedLow: 23, expectedHigh: 27, actual: 29, status: 'warning' },
  { machineState: 'ON', expectedState: 'ON', expected: 25, allowedLow: 23, allowedHigh: 27, expectedLow: 23, expectedHigh: 27, actual: 24, status: 'ok' }
])[0];
assert.equal(stateSummary.sampleCount, 3, 'State summary sample count is correct');
assert.equal(stateSummary.averageActual, 26, 'State summary average is correct');
assert.equal(stateSummary.minActual, 24, 'State summary minimum is correct');
assert.equal(stateSummary.maxActual, 29, 'State summary maximum is correct');
assert.equal(sortComparisonRows([{ status: 'ok', signal: 'C' }, { status: 'needs_configuration', signal: 'D' }, { status: 'warning', signal: 'B' }, { status: 'critical', signal: 'A' }, { status: 'needs_validation', signal: 'E' }, { status: 'no_data', signal: 'F' }]).map(row => row.status).join(','), 'critical,warning,ok,needs_configuration,needs_validation,no_data', 'Parameter Navigator sort order follows the decision model');
assert.equal(evaluateValue({ checkType: '', expectedByState: {}, genericExpected: null, tolerance: null, warningLow: null, warningHigh: null, criticalLow: null, criticalHigh: null }, 10, { status: 'matched', machineState: 'ON', systemState: 'ON' }).status, 'needs_configuration', 'Needs Configuration is used only when configuration is genuinely missing');


const separatedDecision = buildServiceDecision({ metadata: { rulesValid: 2, relevantValuesFound: 2 }, systemHealth: [{ system: 'BSS', status: 'needs_configuration', evaluated: 0 }], signalSummaries: [
  { ruleId: 'CFGONLY', ruleRow: 1, system: 'BSS', signal: 'C', status: 'needs_configuration', matchedRows: 1, fullyEvaluatedPoints: 0 }
], deviationEvents: [] });
assert.equal(separatedDecision.machineStatus, 'needs_configuration', 'Configuration gaps stay non-operational when no parameter is evaluated');
const worstOperationalDecision = buildServiceDecision({ metadata: { rulesValid: 3, relevantValuesFound: 3 }, systemHealth: [{ system: 'BSS', status: 'warning', evaluated: 1 }, { system: 'IPS', status: 'needs_configuration', evaluated: 0 }], signalSummaries: [
  { ruleId: 'WARN2', ruleRow: 2, system: 'BSS', signal: 'B', status: 'warning', matchedRows: 1, fullyEvaluatedPoints: 1 },
  { ruleId: 'CFG2', ruleRow: 3, system: 'IPS', signal: 'C', status: 'needs_configuration', matchedRows: 1, fullyEvaluatedPoints: 0 }
], deviationEvents: [{ system: 'BSS', signal: 'B', severity: 'warning', durationMs: 1000, maximumDeviation: 2 }] });
assert.equal(worstOperationalDecision.machineStatus, 'warning', 'Machine status uses worst operational system status before configuration gaps');
assert.equal(worstOperationalDecision.kpis.affectedParameters, 1, 'Radar KPI counts affected parameters, not raw samples');
assert.equal(worstOperationalDecision.kpis.deviationEvents, 1, 'Radar KPI counts consolidated deviation events');

const statusDecision = buildServiceDecision({ metadata: { rulesValid: 3, relevantValuesFound: 3 }, systemHealth: [{ system: 'BSS', status: 'warning', evaluated: 1 }], signalSummaries: [
  { ruleId: 'OK', ruleRow: 1, system: 'BSS', signal: 'A', status: 'ok', matchedRows: 1, fullyEvaluatedPoints: 1 },
  { ruleId: 'WARN', ruleRow: 2, system: 'BSS', signal: 'B', status: 'warning', matchedRows: 1, fullyEvaluatedPoints: 1 },
  { ruleId: 'CFG', ruleRow: 3, system: 'BSS', signal: 'C', status: 'needs_configuration', matchedRows: 1, fullyEvaluatedPoints: 0 }
], deviationEvents: [{ system: 'BSS', signal: 'B', severity: 'warning', recommendedAction: '' }] });
assert.equal(statusDecision.evaluationCoverage.fullyEvaluatedRules, 2, 'Count definition: fully evaluated rules require OK/Warning/Critical points');
assert.equal(statusDecision.evaluationCoverage.matchedSignals, 3, 'Count definition: matched signals require at least one matched row');
assert.equal(statusDecision.nextRecommendedAction, 'No service action configured for this rule.', 'Recommended actions are not invented when no configured action exists');
assert.equal(statusDecision.kpis.fullyEvaluatedRules, 2, 'Radar KPI fully evaluated rules uses parameter-level definitions');
const changedFiles = execSync('git diff --name-only', { encoding: 'utf8' }).trim().split(/\n/).filter(Boolean);
assert.equal(changedFiles.some(file => /\.(png|jpe?g|webp|gif|bmp|ico|zip|xlsx?|pdf|docx|pptx|ttf|otf|woff2?)$/i.test(file)), false, 'Git diff contains no changed binary file paths');

assert.match(css, /--accent-cyan:#39c7f3/, 'Cyan accent mapping exists');
assert.match(css, /--status-ok:#43d17d/, 'OK green mapping exists');
assert.match(css, /--status-warning:#f4c542/, 'Warning amber mapping exists');
assert.match(css, /--status-critical:#ff5f68/, 'Critical red mapping exists');

const indexHtml = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
assert.match(indexHtml, /id="loginView"/, 'login DOM root exists');
assert.match(indexHtml, /id="analysisView"/, 'analysis DOM root exists');
assert.match(css, /overflow-x:hidden/, 'document width constrained to viewport width');
assert.match(css, /grid-template-columns:minmax\(0,1\.8fr\) minmax\(360px,\.8fr\)/, 'login panel and visual stage desktop grid is configured');
assert.match(css, /prefers-reduced-motion:\s*reduce/, 'reduced-motion media query is supported');
assert.match(css, /\.password-toggle/, 'password toggle styling exists');
assert.match(css, /\.progress-core strong/, 'progress percentage has centered visual styling');
assert.match(css, /\.stage-list/, 'progress stage list styling exists');

console.log('module tests passed');
