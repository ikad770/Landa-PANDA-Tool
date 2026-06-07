import { EXPECTED_STATE_COLUMNS, PENDING_CHECK_TYPES, SUPPORTED_CHECK_TYPES } from './config.js';

export function normalizeToken(value) {
  return String(value ?? '').replace(/\uFEFF/g, '').replace(/[_\s\-./\\:]+/g, '').trim().toLowerCase();
}

export function normalizeText(value) {
  return String(value ?? '').replace(/\uFEFF/g, '').replace(/\s+/g, ' ').trim();
}

export function normalizeCheckType(value) {
  return normalizeText(value).toLowerCase();
}

export function normalizeState(value) {
  const key = normalizeToken(value);
  const aliases = {
    initializing: 'initializing', on: 'on', standby: 'standby', standbystate: 'standby', ready: 'ready',
    prepare2print: 'prepare2print', preparetoprint: 'prepare2print', printing: 'printing',
    printend: 'printend', recovery: 'recovery', error: 'error'
  };
  return aliases[key] || key || '';
}

export function parseNumber(value) {
  const text = String(value ?? '').replace(/,/g, '').trim();
  if (!text) return null;
  const match = text.match(/[-+]?\d*\.?\d+(?:e[-+]?\d+)?/i);
  if (!match) return null;
  const num = Number(match[0]);
  return Number.isFinite(num) ? num : null;
}

export function parseTolerance(value) {
  const raw = normalizeText(value);
  if (!raw) return null;
  const lower = raw.toLowerCase();
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
  const generic = parseNumber(row.Expected ?? row['Expected Value'] ?? row['Expected value']);
  return { expectedByState, genericExpected: generic };
}

export function selectExpected(rule, stateContext) {
  const stateCandidates = [stateContext?.systemState, stateContext?.machineState].map(normalizeState).filter(Boolean);
  for (const state of stateCandidates) {
    if (Object.prototype.hasOwnProperty.call(rule.expectedByState, state)) {
      return { value: rule.expectedByState[state], state, source: 'state' };
    }
  }
  if (rule.genericExpected !== null && rule.genericExpected !== undefined) return { value: rule.genericExpected, state: null, source: 'generic' };
  return { value: null, state: stateCandidates[0] || null, source: 'missing' };
}

export function computeAllowedRange(rule, expected) {
  const criticalLow = rule.criticalLow;
  const criticalHigh = rule.criticalHigh;
  if (criticalLow !== null || criticalHigh !== null) {
    return { low: criticalLow ?? -Infinity, high: criticalHigh ?? Infinity, source: 'critical_threshold' };
  }
  const warningLow = rule.warningLow;
  const warningHigh = rule.warningHigh;
  if (warningLow !== null || warningHigh !== null) {
    return { low: warningLow ?? -Infinity, high: warningHigh ?? Infinity, source: 'warning_threshold' };
  }
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
  if (PENDING_CHECK_TYPES.has(checkType)) return { status: 'evaluator_pending', reason: 'Evaluator recognized but not implemented' };
  if (!SUPPORTED_CHECK_TYPES.has(checkType)) return { status: 'needs_validation', reason: 'Unsupported check type' };
  if (actual === null || actual === undefined || !Number.isFinite(actual)) return { status: 'needs_validation', reason: 'No numeric value' };
  const expected = selectExpected(rule, stateContext);
  const range = computeAllowedRange(rule, expected.value);
  if (expected.source === 'missing' && checkType !== 'above threshold' && checkType !== 'below threshold') return { status: 'needs_validation', reason: 'Missing expected value' };
  if (!range && checkType !== 'exact') return { status: 'needs_validation', reason: 'Missing threshold or tolerance' };

  let low = range?.low ?? expected.value;
  let high = range?.high ?? expected.value;
  if (checkType === 'above threshold') low = range?.low ?? expected.value;
  if (checkType === 'below threshold') high = range?.high ?? expected.value;
  if (checkType === 'exact' && (expected.value === null || expected.value === undefined)) return { status: 'needs_validation', reason: 'Missing exact expected value' };

  const outside = actual < low || actual > high;
  let status = outside ? 'warning' : 'ok';
  if (outside && (rule.criticalLow !== null || rule.criticalHigh !== null)) status = 'critical';
  const deviation = actual > high ? actual - high : actual < low ? actual - low : 0;
  return { status, expectedValue: expected.value, expectedState: expected.state, expectedLow: low, expectedHigh: high, deviation, reason: status === 'ok' ? 'Within allowed range' : 'Outside allowed range' };
}

export function validateRule(rule) {
  if (!rule.sourceType) return 'missing_source';
  if (!rule.signal) return 'missing_signal';
  if (PENDING_CHECK_TYPES.has(rule.checkTypeNormalized)) return 'valid';
  if (!SUPPORTED_CHECK_TYPES.has(rule.checkTypeNormalized)) return 'unsupported_check_type';
  const hasExpected = rule.genericExpected !== null || Object.keys(rule.expectedByState).length > 0;
  if (!hasExpected && !['above threshold', 'below threshold'].includes(rule.checkTypeNormalized)) return 'missing_expected';
  if (!rule.tolerance && rule.warningLow === null && rule.warningHigh === null && rule.criticalLow === null && rule.criticalHigh === null && rule.checkTypeNormalized !== 'exact') return 'incomplete_thresholds';
  return 'valid';
}

export function formatRange(low, high) {
  const fmt = v => v === Infinity ? '∞' : v === -Infinity ? '-∞' : Number.isFinite(v) ? Number(v).toFixed(2).replace(/\.00$/, '') : '—';
  return `${fmt(low)}–${fmt(high)}`;
}
