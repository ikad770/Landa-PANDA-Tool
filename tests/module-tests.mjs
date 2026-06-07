import assert from 'node:assert/strict';
import { ADAPTERS } from '../adapters.js';
import { evaluateValue } from '../evaluation.js';
import { validateAnalysisResult } from '../render.js';

function baseResult(overrides = {}) {
  const metadata = {
    rulesValid: 1,
    relevantValuesFound: 1,
    classifiedPoints: 1,
    fullyEvaluatedPoints: 0,
    blockedPoints: 1,
    evaluatedPoints: 0,
    blockingReason: 'All matched values require validation. Open Service Radar to review the blockers.',
    ...overrides.metadata
  };
  return {
    metadata,
    systemHealth: [{ system: 'BSS', status: 'needs_validation', matchedRows: 1, blockedPoints: 1 }],
    deviationEvents: [],
    signalSummaries: [{ ruleId: 'R1', system: 'BSS', signal: 'Temperature', status: 'needs_validation', matchedRows: 1, classifiedPoints: 1, fullyEvaluatedPoints: 0, latestActual: 42, blocker: 'missing_expected_value' }],
    chartSeries: { R1: [{ t: 1700000000000, actual: 42, status: 'needs_validation', blocker: 'missing_expected_value' }] },
    stateTimeline: [],
    diagnosticsSummary: { evaluationBlockers: { topBlocker: { reason: 'missing_expected_value', count: 1, label: 'Missing expected value for current state' } } },
    ...overrides,
    metadata
  };
}

const needsValidation = validateAnalysisResult(baseResult());
assert.equal(needsValidation.valid, true, 'Needs Validation result should validate');
assert.equal(needsValidation.status, 'completed_with_warnings');

const evaluatorPending = validateAnalysisResult(baseResult({
  metadata: { relevantValuesFound: 1, blockedPoints: 1, classifiedPoints: 1 },
  signalSummaries: [{ ruleId: 'R1', system: 'BSS', signal: 'Trend', status: 'evaluator_pending', matchedRows: 1, classifiedPoints: 1, fullyEvaluatedPoints: 0, latestActual: 10, blocker: 'unsupported_evaluator' }],
  chartSeries: { R1: [{ t: 1700000000000, actual: 10, status: 'evaluator_pending', blocker: 'unsupported_evaluator' }] }
}));
assert.equal(evaluatorPending.valid, true, 'Evaluator Pending result should validate');
assert.equal(evaluatorPending.status, 'completed_with_warnings');

const missingMatchedValues = validateAnalysisResult(baseResult({ metadata: { relevantValuesFound: 0, classifiedPoints: 0, blockedPoints: 0, blockingReason: 'Required log files were parsed, but no rule signals matched.' } }));
assert.equal(missingMatchedValues.valid, false, 'Missing matched values should remain fatal');

assert.equal(ADAPTERS.BSSNotifications.getSubsystem({ Subsystem: 'BCU', SubComponent: 'InkPressure' }, { subsystem: 'Fallback' }), 'BCU', 'BSS subsystem should come from Subsystem');
assert.notEqual(ADAPTERS.BSSNotifications.getSubsystem({ Subsystem: 'BCU', SubComponent: 'InkPressure' }, { subsystem: 'Fallback' }), 'InkPressure');

assert.equal(baseResult().chartSeries.R1[0].actual, 42, 'Needs Validation chart samples should preserve actual values');

const thresholdRule = { checkType: 'range', expectedByState: { printing: 10 }, genericExpected: null, tolerance: null, warningLow: 5, warningHigh: 15, criticalLow: 2, criticalHigh: 20 };
const thresholdNoState = evaluateValue(thresholdRule, 12, { status: 'missing', machineState: null, systemState: null });
assert.equal(thresholdNoState.status, 'ok', 'Explicit thresholds can evaluate without MachineState');

const stateDependentRule = { checkType: 'range', expectedByState: { printing: 10 }, genericExpected: null, tolerance: { mode: 'absolute', value: 1 }, warningLow: null, warningHigh: null, criticalLow: null, criticalHigh: null };
const stateDependentNoState = evaluateValue(stateDependentRule, 12, { status: 'missing', machineState: null, systemState: null });
assert.equal(stateDependentNoState.status, 'needs_validation', 'State-dependent tolerance should block when state is missing');
assert.equal(stateDependentNoState.blocker, 'missing_state');

const severityRule = { checkType: 'range', expectedByState: {}, genericExpected: null, tolerance: null, warningLow: 5, warningHigh: 10, criticalLow: 0, criticalHigh: 20 };
assert.equal(evaluateValue(severityRule, 12, { status: 'missing' }).status, 'warning', 'Warning thresholds should produce warning');
assert.equal(evaluateValue(severityRule, 22, { status: 'missing' }).status, 'critical', 'Critical thresholds should produce critical');

console.log('module tests passed');
