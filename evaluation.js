import { EXPECTED_STATE_COLUMNS, PENDING_CHECK_TYPES, SUPPORTED_CHECK_TYPES } from './config.js';

export function normalizeToken(value) {
  return String(value ?? '').replace(/\uFEFF/g, '').replace(/[_\s\-./\\:()\[\]]+/g, '').trim().toLowerCase();
}

export function normalizeText(value) {
  return String(value ?? '').replace(/\uFEFF/g, '').replace(/\s+/g, ' ').trim();
}

export function normalizeCheckType(value) {
  const type = normalizeText(value || 'range').toLowerCase();
  if (['within range', 'expected range', 'value range'].includes(type)) return 'range';
  if (['maximum', 'max threshold'].includes(type)) return 'max';
  if (['minimum', 'min threshold'].includes(type)) return 'min';
  return type;
}

export function normalizeState(value) {
  const key = normalizeToken(value);
  const aliases = {
    on: 'on', run: 'on', running: 'on', standby: 'standby', standbystate: 'standby', idle: 'standby',
    ready: 'ready', prepare2print: 'prepare2print', preparetoprint: 'prepare2print', prep2print: 'prepare2print',
    printing: 'printing', print: 'printing', printend: 'printend', printended: 'printend', recovery: 'recovery', recovering: 'recovery',
    error: 'error', fault: 'error'
  };
  return aliases[key] || key || '';
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
  }
  if (rule.genericExpected !== null && rule.genericExpected !== undefined) return { value: rule.genericExpected, state: null, source: 'generic' };
  return { value: null, state: candidates[0] || null, source: 'missing' };
}

export function computeAllowedRange(rule, expected) {
  if (rule.criticalLow !== null || rule.criticalHigh !== null) return { low: rule.criticalLow ?? -Infinity, high: rule.criticalHigh ?? Infinity, source: 'critical_threshold' };
  if (rule.warningLow !== null || rule.warningHigh !== null) return { low: rule.warningLow ?? -Infinity, high: rule.warningHigh ?? Infinity, source: 'warning_threshold' };
  const tol = rule.tolerance;
  if (!tol) return null;
  if (tol.mode === 'max') return { low: -Infinity, high: tol.value, source: 'max' };
  if (tol.mode === 'min') return { low: tol.value, high: Infinity, source: 'min' };
  if (expected === null || expected === undefined) return null;
  const delta = tol.mode === 'percent' ? Math.abs(expected) * tol.value / 100 : tol.value;
  return { low: expected - delta, high: expected + delta, source: tol.mode };
}

export function evaluateValue(rule, actual, stateContext) {
  const checkType = normalizeCheckType(rule.checkType);
  if (actual === null || actual === undefined || !Number.isFinite(actual)) return { status: 'needs_validation', blocker: 'no_numeric_value', reason: 'No numeric value' };
  if (PENDING_CHECK_TYPES.has(checkType)) return { status: 'evaluator_pending', blocker: 'unsupported_evaluator', reason: 'Evaluator is pending implementation' };
  if (!SUPPORTED_CHECK_TYPES.has(checkType)) return { status: 'needs_validation', blocker: 'unsupported_evaluator', reason: `Unsupported check type: ${rule.checkType || 'blank'}` };
  const stateDependent = Object.keys(rule.expectedByState || {}).length > 0;
  if (stateDependent && stateContext?.status === 'missing') return { status: 'needs_validation', blocker: 'missing_state', reason: 'State context missing' };
  const expected = selectExpected(rule, stateContext);
  if (expected.source === 'missing' && !['above threshold', 'below threshold', 'max', 'min'].includes(checkType)) return { status: 'needs_validation', blocker: 'missing_expected_value', reason: 'Missing expected value for current state' };
  const range = computeAllowedRange(rule, expected.value);
  if (!range && checkType !== 'exact') return { status: 'needs_validation', blocker: 'missing_threshold_or_tolerance', reason: 'Missing threshold or tolerance' };
  let low = range?.low ?? expected.value;
  let high = range?.high ?? expected.value;
  if (checkType === 'above threshold' || checkType === 'min') high = Infinity;
  if (checkType === 'below threshold' || checkType === 'max') low = -Infinity;
  if (checkType === 'exact' && expected.value === null) return { status: 'needs_validation', blocker: 'missing_expected_value', reason: 'Missing exact expected value' };
  const outside = actual < low || actual > high;
  const critical = outside && (rule.criticalLow !== null || rule.criticalHigh !== null);
  const deviation = actual > high ? actual - high : actual < low ? actual - low : 0;
  return { status: outside ? (critical ? 'critical' : 'warning') : 'ok', expectedValue: expected.value, expectedState: expected.state, expectedLow: low, expectedHigh: high, deviation, reason: outside ? 'Outside allowed range' : 'Within allowed range' };
}

export function validateRule(rule) {
  if (!rule.logSource) return 'missing_source';
  if (!rule.signal) return 'missing_signal';
  if (!rule.system) return 'missing_system';
  if (PENDING_CHECK_TYPES.has(rule.checkTypeNormalized)) return 'valid';
  if (!SUPPORTED_CHECK_TYPES.has(rule.checkTypeNormalized)) return 'unsupported_check_type';
  const hasExpected = Object.keys(rule.expectedByState || {}).length > 0 || rule.genericExpected !== null;
  const hasLimit = rule.tolerance || rule.warningLow !== null || rule.warningHigh !== null || rule.criticalLow !== null || rule.criticalHigh !== null;
  if (!hasExpected && !hasLimit) return 'missing_expected_or_limit';
  return 'valid';
}

export function formatNumber(value) {
  return Number.isFinite(value) ? Number(value).toFixed(2).replace(/\.00$/, '') : '—';
}

export function formatRange(low, high) {
  return `${Number.isFinite(low) ? formatNumber(low) : '−∞'}–${Number.isFinite(high) ? formatNumber(high) : '+∞'}`;
}
