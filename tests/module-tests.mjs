import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ADAPTERS, matchRuleForRow, parseSlashTimestamp } from '../adapters.js';
import { evaluateValue, normalizeToken } from '../evaluation.js';
import { createStateIndex } from '../machine-states.js';
import { validateAnalysisResult } from '../render.js';

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

assert.equal(new Date(parseSlashTimestamp('03/12/2026 15:51:40:441145', 'MDY')).getMilliseconds(), 441, 'BSS colon microseconds parse');
assert.equal(new Date(parseSlashTimestamp('03/12/2026 15:51:40.441145', 'MDY')).getMilliseconds(), 441, 'BSS dot microseconds parse');
assert.equal(new Date(parseSlashTimestamp('12/03/2026 07:02:21.093', 'DMY')).getMonth(), 2, 'MachineStates DMY timestamp parse');
assert.equal(new Date(parseSlashTimestamp('12/03/2026 07:02:21.093\u00A0', 'DMY')).getMilliseconds(), 93, 'MachineStates NBSP timestamp parse');
assert.equal(new Date(parseSlashTimestamp('31/12/2025 23:59:59.999', 'DMY')).getDate(), 31, 'DMY end-of-year timestamp parse');
assert.equal(new Date(parseSlashTimestamp('12/31/2025 23:59:59:999999', 'MDY')).getMilliseconds(), 999, 'MDY colon microseconds parse');
assert.equal(parseSlashTimestamp('31/12/2025 23:59:59.999', 'MDY'), null, 'Invalid MDY timestamp rejected without Date.parse fallback');

const needsValidation = validateAnalysisResult(baseResult());
assert.equal(needsValidation.valid, true, 'Needs Validation result should validate');
assert.equal(needsValidation.status, 'completed_with_warnings');
assert.equal(baseResult().signalSummaries[0].latestActual, 42, 'Invalid timestamp preserves numeric actual value');
assert.equal(baseResult().chartSeries.R1[0].actual, 42, 'Needs Validation chart samples should preserve actual values');
assert.notEqual(baseResult().metadata.relevantSignalsFound / baseResult().metadata.relevantSignalsRequired, baseResult().metadata.rulesEvaluated / baseResult().metadata.rulesValid, 'Signal Match Coverage differs from Fully Evaluated Coverage');

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

console.log('module tests passed');
