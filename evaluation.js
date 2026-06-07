import { EXPECTED_STATE_COLUMNS, PENDING_CHECK_TYPES, SUPPORTED_CHECK_TYPES } from './config.js';

export function normalizeToken(value) {
  return String(value ?? '').replace(/\uFEFF/g, '').replace(/\u00A0/g, ' ').replace(/\uFFFD/g, '').replace(/[_\s\-./\\:()\[\]]+/g, '').trim().toLowerCase();
}

export function normalizeText(value) {
  return String(value ?? '').replace(/\uFEFF/g, '').replace(/\u00A0/g, ' ').replace(/\uFFFD/g, '').replace(/\s+/g, ' ').trim();
}

export function normalizeCheckType(value) {
  const type = normalizeText(value).toLowerCase();
  if (!type) return '';
  if (['within range', 'expected range', 'value range', 'absolute range'].includes(type)) return 'range';
  if (['percent range', 'percentage range', 'range percent'].includes(type)) return 'range_percent';
  if (['maximum', 'max threshold', 'below threshold'].includes(type)) return 'max';
  if (['minimum', 'min threshold', 'above threshold'].includes(type)) return 'min';
  return type;
}

export function inferCheckType(rule) {
  const explicit = normalizeCheckType(rule?.checkType);
  if (explicit) return explicit;
  if (rule?.criticalLow !== null || rule?.criticalHigh !== null || rule?.warningLow !== null || rule?.warningHigh !== null) return 'range';
  if (rule?.tolerance?.mode === 'max') return 'max';
  if (rule?.tolerance?.mode === 'min') return 'min';
  if (rule?.tolerance?.mode === 'percent') return 'range_percent';
  if (rule?.tolerance?.mode === 'absolute') return 'range';
  return '';
}

export function normalizeState(value) {
  const key = normalizeToken(value);
  const aliases = {
    on: 'ON',
    standby: 'Standby',
    standbystate: 'Standby',
    ready: 'Ready',
    prepare2print: 'Prepare2Print',
    preparetoprint: 'Prepare2Print',
    prep2print: 'Prepare2Print',
    printing: 'Printing',
    printend: 'PrintEnd',
    recovery: 'Recovery',
    error: 'Error'
  };
  return aliases[key] || normalizeText(value) || '';
}

export function parseNumber(value) {
  const text = String(value ?? '').replace(/,/g, '').trim();
  if (!text || /^---$/.test(text)) return null;
  const match = text.match(/[-+]?\d*\.?\d+(?:e[-+]?\d+)?/i);
  if (!match) return null;
  const num = Number(match[0]);
  return Number.isFinite(num) ? num : null;
}

export function parseTolerance(value) {
  const raw = normalizeText(value);
  if (!raw) return null;
  const lower = raw.toLowerCase().replace('±', '+/-');
  const amount = parseNumber(lower);
  if (amount === null) return null;
  if (/\bmax\b/.test(lower)) return { mode: 'max', value: amount };
  if (/\bmin\b/.test(lower)) return { mode: 'min', value: amount };
  if (/%/.test(lower)) return { mode: 'percent', value: Math.abs(amount) };
  return { mode: 'absolute', value: Math.abs(amount) };
}

export function parseThreshold(value) {
  const n = parseNumber(value);
  return n === null ? null : n;
}

export function expectedValuesFromRow(row) {
  const expectedByState = {};
  for (const [state, column] of Object.entries(EXPECTED_STATE_COLUMNS)) {
    const expected = parseNumber(row[column]);
    if (expected !== null) expectedByState[state] = expected;
  }
  const genericExpected = parseNumber(row.Expected ?? row['Expected Value'] ?? row['Expected value'] ?? row['Expected']);
  return { expectedByState, genericExpected };
}

export function selectExpected(rule, stateContext) {
  const candidates = [stateContext?.systemState, stateContext?.machineState].map(normalizeState).filter(Boolean);
  for (const state of candidates) {
    if (Object.prototype.hasOwnProperty.call(rule.expectedByState || {}, state)) return { value: rule.expectedByState[state], state, source: 'state' };
    const matchingKey = Object.keys(rule.expectedByState || {}).find(key => normalizeState(key) === state);
    if (matchingKey) return { value: rule.expectedByState[matchingKey], state, source: 'state' };
  }
  if (rule.genericExpected !== null && rule.genericExpected !== undefined) return { value: rule.genericExpected, state: null, source: 'generic' };
  return { value: null, state: candidates[0] || null, source: 'missing' };
}

export function computeAllowedRange(rule, expected) {
  const tol = rule.tolerance;
  let allowedLow = null;
  let allowedHigh = null;
  let source = '';
  if (tol?.mode === 'max') { allowedLow = -Infinity; allowedHigh = tol.value; source = 'max'; }
  else if (tol?.mode === 'min') { allowedLow = tol.value; allowedHigh = Infinity; source = 'min'; }
  else if (tol && expected !== null && expected !== undefined) {
    const delta = tol.mode === 'percent' ? Math.abs(expected) * tol.value / 100 : tol.value;
    allowedLow = expected - delta;
    allowedHigh = expected + delta;
    source = tol.mode;
  }
  const warningLow = rule.warningLow ?? null;
  const warningHigh = rule.warningHigh ?? null;
  const criticalLow = rule.criticalLow ?? null;
  const criticalHigh = rule.criticalHigh ?? null;
  if (allowedLow === null && warningLow !== null) allowedLow = warningLow;
  if (allowedHigh === null && warningHigh !== null) allowedHigh = warningHigh;
  if (allowedLow === null && criticalLow !== null) allowedLow = criticalLow;
  if (allowedHigh === null && criticalHigh !== null) allowedHigh = criticalHigh;
  if (allowedLow === null && allowedHigh === null && warningLow === null && warningHigh === null && criticalLow === null && criticalHigh === null) return null;
  return {
    low: allowedLow ?? -Infinity,
    high: allowedHigh ?? Infinity,
    source: source || 'threshold',
    expectedValue: expected ?? null,
    allowedLow: allowedLow ?? null,
    allowedHigh: allowedHigh ?? null,
    warningLow,
    warningHigh,
    criticalLow,
    criticalHigh
  };
}

export function evaluateValue(rule, actual, stateContext) {
  const checkType = inferCheckType(rule);
  if (actual === null || actual === undefined || !Number.isFinite(actual)) return { status: 'needs_validation', blocker: 'no_numeric_value', reason: 'No numeric value' };
  if (PENDING_CHECK_TYPES.has(checkType)) return { status: 'evaluator_pending', blocker: 'unsupported_evaluator', reason: 'Evaluator is pending implementation' };
  if (!checkType) return { status: 'needs_configuration', blocker: 'missing_threshold_or_tolerance', reason: 'Rule has no usable expected/tolerance/threshold configuration' };
  if (!SUPPORTED_CHECK_TYPES.has(checkType)) return { status: 'needs_validation', blocker: 'unsupported_evaluator', reason: `Unsupported check type: ${rule.checkType || 'blank'}` };
  const hasExplicitThresholds = rule.warningLow !== null || rule.warningHigh !== null || rule.criticalLow !== null || rule.criticalHigh !== null;
  const requiresStateExpected = Object.keys(rule.expectedByState || {}).length > 0 && !hasExplicitThresholds;
  if (requiresStateExpected && (!stateContext || stateContext.status === 'missing')) return { status: 'needs_validation', blocker: 'missing_state', reason: 'Missing Machine State' };
  const expected = selectExpected(rule, stateContext);
  const hasAnyThreshold = rule.warningLow !== null || rule.warningHigh !== null || rule.criticalLow !== null || rule.criticalHigh !== null;
  if (expected.source === 'missing' && !hasAnyThreshold && !['above threshold', 'below threshold', 'max', 'min'].includes(checkType)) return { status: 'needs_configuration', blocker: 'missing_expected_value', reason: 'Missing expected value for current state' };
  const range = computeAllowedRange(rule, expected.value);
  if (!range && checkType !== 'exact') return { status: 'needs_configuration', blocker: 'missing_threshold_or_tolerance', reason: 'Rule has no tolerance or thresholds' };
  let low = range?.low ?? expected.value;
  let high = range?.high ?? expected.value;
  if (checkType === 'above threshold' || checkType === 'min') high = Infinity;
  if (checkType === 'below threshold' || checkType === 'max') low = -Infinity;
  if (checkType === 'exact' && expected.value === null) return { status: 'needs_configuration', blocker: 'missing_expected_value', reason: 'Missing exact expected value' };
  const criticalLow = range?.criticalLow;
  const criticalHigh = range?.criticalHigh;
  const warningLow = range?.warningLow;
  const warningHigh = range?.warningHigh;
  const isCritical = (criticalLow !== null && actual < criticalLow) || (criticalHigh !== null && actual > criticalHigh);
  const isWarning = !isCritical && ((warningLow !== null && actual < warningLow) || (warningHigh !== null && actual > warningHigh));
  const outsideAllowed = !isCritical && !isWarning && (actual < low || actual > high);
  const status = isCritical ? 'critical' : isWarning || outsideAllowed ? 'warning' : 'ok';
  const deviation = actual > high ? actual - high : actual < low ? actual - low : 0;
  const deviationDirection = actual > high ? 'above' : actual < low ? 'below' : 'within';
  const distanceFromNearestLimit = actual < low ? low - actual : actual > high ? actual - high : Math.min(Math.abs(actual - low), Math.abs(high - actual));
  return { status, evaluator: rule.checkType ? checkType : `inferred ${checkType}`, expectedValue: expected.value, expectedState: expected.state, expectedLow: low, expectedHigh: high, allowedLow: range?.allowedLow ?? low, allowedHigh: range?.allowedHigh ?? high, warningLow, warningHigh, criticalLow, criticalHigh, deviation, deviationDirection, distanceFromNearestLimit, reason: status === 'ok' ? 'Within allowed range' : isCritical ? 'Outside critical threshold' : 'Outside warning/allowed range' };
}

export function summarizeStateComparisons(points = []) {
  const byState = new Map();
  for (const point of points) {
    if (!Number.isFinite(point.actual)) continue;
    const state = point.expectedState || normalizeState(point.machineState || point.systemState) || 'Unsupported';
    const row = byState.get(state) || { state, expected: point.expected ?? point.expectedValue ?? null, allowedLow: point.allowedLow ?? point.expectedLow ?? null, allowedHigh: point.allowedHigh ?? point.expectedHigh ?? null, sampleCount: 0, sumActual: 0, averageActual: null, minActual: Infinity, maxActual: -Infinity, okCount: 0, warningCount: 0, criticalCount: 0, outOfRangeDurationMs: 0, outOfRangeCount: 0, status: 'no_data' };
    row.sampleCount += 1;
    row.sumActual += point.actual;
    row.averageActual = row.sumActual / row.sampleCount;
    row.minActual = Math.min(row.minActual, point.actual);
    row.maxActual = Math.max(row.maxActual, point.actual);
    if (point.status === 'ok') row.okCount += 1;
    if (point.status === 'warning') { row.warningCount += 1; row.outOfRangeCount += 1; }
    if (point.status === 'critical') { row.criticalCount += 1; row.outOfRangeCount += 1; }
    row.status = row.criticalCount ? 'critical' : row.warningCount ? 'warning' : row.okCount ? 'ok' : 'no_data';
    byState.set(state, row);
  }
  return [...byState.values()].map(row => ({ ...row, minActual: Number.isFinite(row.minActual) ? row.minActual : null, maxActual: Number.isFinite(row.maxActual) ? row.maxActual : null, outOfRangePercent: row.sampleCount ? (row.outOfRangeCount / row.sampleCount) * 100 : 0 }));
}

export function validateRule(rule) {
  if (!rule.logSource) return 'missing_source';
  if (!rule.signal) return 'missing_signal';
  if (!rule.system) return 'missing_system';
  const inferred = inferCheckType(rule);
  if (PENDING_CHECK_TYPES.has(inferred)) return 'valid';
  if (inferred && !SUPPORTED_CHECK_TYPES.has(inferred)) return 'unsupported_check_type';
  const hasExpected = Object.keys(rule.expectedByState || {}).length > 0 || rule.genericExpected !== null;
  const hasLimit = rule.tolerance || rule.warningLow !== null || rule.warningHigh !== null || rule.criticalLow !== null || rule.criticalHigh !== null;
  return 'valid';
}

export function formatNumber(value) {
  return Number.isFinite(value) ? Number(value).toFixed(2).replace(/\.00$/, '') : '—';
}

export function formatRange(low, high) {
  return `${Number.isFinite(low) ? formatNumber(low) : '−∞'}–${Number.isFinite(high) ? formatNumber(high) : '+∞'}`;
}
