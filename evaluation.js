import { EXPECTED_STATE_COLUMNS, PENDING_CHECK_TYPES, SUPPORTED_CHECK_TYPES } from './config.js';

const STATE_ORDER = ['ON', 'Standby', 'Ready', 'Prepare2Print', 'Printing', 'PrintEnd', 'Recovery', 'Error', 'Other'];
const OPERATIONAL = new Set(['ok', 'warning', 'critical']);
const NON_OPERATIONAL = new Set(['needs_configuration', 'needs_validation', 'no_data', 'no_rule', 'not_analyzed']);
const DEFAULT_GAP_CAP_MS = 30 * 60 * 1000;
const NO_ACTION = 'No service action configured for this rule.';

export function normalizeToken(value) {
  return String(value ?? '').replace(/\uFEFF/g, '').replace(/\u00A0/g, ' ').replace(/\uFFFD/g, '').replace(/[_\s\-./\\:()\[\]]+/g, '').trim().toLowerCase();
}

export function normalizeText(value) {
  return String(value ?? '').replace(/\uFEFF/g, '').replace(/\u00A0/g, ' ').replace(/\uFFFD/g, '').replace(/\s+/g, ' ').trim();
}

function finiteOrNull(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function cleanNumeric(value, precision = 12) {
  const num = finiteOrNull(value);
  return num === null ? null : Number(num.toFixed(precision));
}

function cleanStatus(status, fallback = 'needs_validation') {
  if (OPERATIONAL.has(status) || NON_OPERATIONAL.has(status)) return status;
  return fallback;
}

export function normalizeCheckType(value) {
  const type = normalizeText(value).toLowerCase().replace(/[_-]+/g, ' ');
  if (!type) return '';
  if (['range', 'within range', 'expected range', 'value range', 'absolute range', 'spec tolerance'].includes(type)) return 'range';
  if (['range percent', 'percent range', 'percentage range', 'percent tolerance', 'percentage tolerance'].includes(type)) return 'range_percent';
  if (['threshold', 'thresholds', 'threshold range', 'explicit threshold'].includes(type)) return 'threshold';
  if (['max', 'maximum', 'max threshold', 'below threshold', 'below_threshold'].includes(type)) return 'max';
  if (['min', 'minimum', 'min threshold', 'above threshold', 'above_threshold'].includes(type)) return 'min';
  if (['exact', 'equals', 'equal'].includes(type)) return 'exact';
  if (['above threshold'].includes(type)) return 'above_threshold';
  if (['below threshold'].includes(type)) return 'below_threshold';
  return type.replace(/\s+/g, '_');
}

export function inferCheckType(rule = {}) {
  const explicit = normalizeCheckType(rule.checkType ?? rule.checkTypeNormalized);
  if (explicit) return explicit;
  if ([rule.warningLow, rule.warningHigh, rule.criticalLow, rule.criticalHigh].some(value => value !== null && value !== undefined)) return 'threshold';
  if (rule.expectedRangeByState && Object.keys(rule.expectedRangeByState).length) return 'range';
  if (rule.genericExpectedRange) return 'range';
  if (rule.tolerance?.mode === 'max') return 'max';
  if (rule.tolerance?.mode === 'min') return 'min';
  if (rule.tolerance?.mode === 'percent') return 'range_percent';
  if (rule.tolerance?.mode === 'absolute') return 'range';
  return '';
}

export function normalizeState(value) {
  const key = normalizeToken(value);
  const aliases = {
    on: 'ON', standby: 'Standby', standbystate: 'Standby', ready: 'Ready', prepare2print: 'Prepare2Print',
    preparetoprint: 'Prepare2Print', prepareprint: 'Prepare2Print', prep2print: 'Prepare2Print', printing: 'Printing',
    printend: 'PrintEnd', printended: 'PrintEnd', recovery: 'Recovery', error: 'Error'
  };
  return aliases[key] || normalizeText(value) || '';
}

function matrixState(value) {
  const state = normalizeState(value);
  return STATE_ORDER.includes(state) ? state : (state ? 'Other' : 'Other');
}

export function parseNumber(value) {
  let text = String(value ?? '').trim();
  if (!text || /^---$/.test(text)) return null;
  text = text.replace(/\u00A0/g, ' ');
  const commaDecimal = /^[-+]?\d+,\d+(?:\D|$)/.test(text) && !/^[-+]?\d{1,3}(?:,\d{3})+(?:\D|$)/.test(text);
  text = commaDecimal ? text.replace(',', '.') : text.replace(/,/g, '');
  const match = text.match(/[-+]?\d*\.?\d+(?:e[-+]?\d+)?/i);
  if (!match) return null;
  const num = Number(match[0]);
  return Number.isFinite(num) ? num : null;
}

export function parseTolerance(value) {
  const raw = normalizeText(value);
  if (!raw) return null;
  const lower = raw.toLowerCase().replace('±', '+/-');
  const pair = lower.match(/([-+]?\d*\.?\d+(?:e[-+]?\d+)?)\s*\/\s*[-+]?\d*\.?\d+/i);
  const amount = pair ? Number(pair[1]) : parseNumber(lower);
  if (!Number.isFinite(amount)) return null;
  if (/\bmax(?:imum)?\b/.test(lower)) return { mode: 'max', value: amount };
  if (/\bmin(?:imum)?\b/.test(lower)) return { mode: 'min', value: amount };
  if (/%/.test(lower)) return { mode: 'percent', value: Math.abs(amount) };
  return { mode: 'absolute', value: Math.abs(amount) };
}

export function parseThreshold(value) {
  return parseNumber(value);
}

export function parseRangeSpec(value) {
  const raw = normalizeText(value);
  if (!raw) return null;
  const normalized = raw.replace(/[–—]/g, '-').replace(/\.\./g, ' to ');
  const numbers = normalized.match(/[-+]?\d*[.,]?\d+(?:e[-+]?\d+)?/gi) || [];
  if (numbers.length >= 2 && /\b(to|through|until|between)\b|-/.test(normalized.replace(/^[-+]?\d/, ''))) {
    const a = parseNumber(numbers[0]);
    const b = parseNumber(numbers[1]);
    if (a !== null && b !== null) return { low: Math.min(a, b), high: Math.max(a, b), target: (a + b) / 2 };
  }
  return null;
}

function getRowValue(row, candidates) {
  const normalized = Object.fromEntries(Object.entries(row || {}).map(([key, value]) => [normalizeToken(key), value]));
  for (const name of candidates) {
    const value = row?.[name] ?? normalized[normalizeToken(name)];
    if (normalizeText(value) !== '') return value;
  }
  return '';
}

export function expectedValuesFromRow(row) {
  const expectedByState = {};
  const expectedRangeByState = {};
  for (const [state, column] of Object.entries(EXPECTED_STATE_COLUMNS)) {
    const raw = getRowValue(row, [column, `${state} Expected`, `Expected ${state} Value`, state]);
    const range = parseRangeSpec(raw);
    const expected = parseNumber(raw);
    if (range) {
      expectedByState[state] = range.target;
      expectedRangeByState[state] = { low: range.low, high: range.high };
    } else if (expected !== null) expectedByState[state] = expected;
  }
  const genericRaw = getRowValue(row, ['Expected', 'Expected Value', 'Expected value', 'Target', 'Target Value', 'Allowed Range', 'Spec Range']);
  const genericExpectedRange = parseRangeSpec(genericRaw);
  const genericExpected = genericExpectedRange?.target ?? parseNumber(genericRaw);
  return { expectedByState, expectedRangeByState, genericExpected, genericExpectedRange };
}

export function selectExpected(rule = {}, stateContext = {}) {
  const systemState = normalizeState(stateContext.systemState);
  const machineState = normalizeState(stateContext.machineState);
  const byState = rule.expectedByState || {};
  const rangeByState = rule.expectedRangeByState || {};
  const hasStateExpectations = Object.keys(byState).length > 0 || Object.keys(rangeByState).length > 0;
  for (const state of [systemState, machineState].filter(Boolean)) {
    const exactKey = Object.prototype.hasOwnProperty.call(byState, state) ? state : Object.keys(byState).find(key => normalizeState(key) === state);
    if (exactKey) return { value: byState[exactKey], range: rangeByState[exactKey] || null, state, source: state === systemState ? 'system_state' : 'machine_state' };
    const rangeKey = Object.keys(rangeByState).find(key => normalizeState(key) === state);
    if (rangeKey) return { value: rangeByState[rangeKey].target ?? (rangeByState[rangeKey].low + rangeByState[rangeKey].high) / 2, range: rangeByState[rangeKey], state, source: state === systemState ? 'system_state' : 'machine_state' };
    if (hasStateExpectations) return { value: null, range: null, state, source: 'missing_state_expected', reasonCode: 'missing_expected_for_state' };
  }
  if (!hasStateExpectations && rule.genericExpected !== null && rule.genericExpected !== undefined) return { value: rule.genericExpected, range: rule.genericExpectedRange || null, state: null, source: 'generic' };
  if (!hasStateExpectations && rule.genericExpectedRange) return { value: rule.genericExpectedRange.target, range: rule.genericExpectedRange, state: null, source: 'generic_range' };
  return { value: null, range: null, state: systemState || machineState || null, source: hasStateExpectations ? 'missing_state_expected' : 'missing', reasonCode: hasStateExpectations ? 'missing_expected_for_state' : 'missing_expected_value' };
}

function hasThresholds(rule = {}) {
  return [rule.warningLow, rule.warningHigh, rule.criticalLow, rule.criticalHigh].some(value => value !== null && value !== undefined);
}

function validateDurations(rule = {}) {
  const warning = rule.warningDurationSec ?? null;
  const critical = rule.criticalDurationSec ?? null;
  const grace = rule.transitionGraceSec ?? null;
  for (const value of [warning, critical, grace]) if (value !== null && (!Number.isFinite(Number(value)) || Number(value) < 0)) return false;
  return !(warning !== null && critical !== null && Number(critical) < Number(warning));
}

export function computeAllowedRange(rule = {}, expected = null, expectedSelection = null) {
  const checkType = inferCheckType(rule);
  const tol = rule.tolerance || null;
  const explicitRange = expectedSelection?.range || rule.genericExpectedRange || null;
  let low = explicitRange?.low ?? null;
  let high = explicitRange?.high ?? null;
  let source = explicitRange ? 'explicit_range' : '';
  const expectedValue = expected ?? expectedSelection?.value ?? null;

  if ((checkType === 'range' || checkType === 'range_percent') && !explicitRange && !hasThresholds(rule)) {
    if (!tol || (tol.mode !== 'absolute' && tol.mode !== 'percent')) return { valid: false, reasonCode: 'missing_required_tolerance' };
    if (!Number.isFinite(tol.value) || tol.value < 0) return { valid: false, reasonCode: 'invalid_range_configuration' };
    if (expectedValue === null || expectedValue === undefined || !Number.isFinite(Number(expectedValue))) return { valid: false, reasonCode: 'missing_expected_value' };
    const delta = tol.mode === 'percent' ? Math.abs(Number(expectedValue)) * tol.value / 100 : tol.value;
    low = Number(expectedValue) - delta;
    high = Number(expectedValue) + delta;
    source = tol.mode === 'percent' ? 'percent_tolerance' : 'absolute_tolerance';
  } else if (checkType === 'max' || tol?.mode === 'max') {
    high = tol?.mode === 'max' ? tol.value : (rule.warningHigh ?? rule.criticalHigh ?? rule.genericExpected);
    low = null;
    source = 'max';
  } else if (checkType === 'min' || tol?.mode === 'min') {
    low = tol?.mode === 'min' ? tol.value : (rule.warningLow ?? rule.criticalLow ?? rule.genericExpected);
    high = null;
    source = 'min';
  } else if (checkType === 'threshold' || hasThresholds(rule)) {
    low = low ?? rule.warningLow ?? rule.criticalLow ?? null;
    high = high ?? rule.warningHigh ?? rule.criticalHigh ?? null;
    source = source || 'threshold';
  } else if (checkType === 'exact') {
    if (expectedValue === null || expectedValue === undefined || !Number.isFinite(Number(expectedValue))) return { valid: false, reasonCode: 'missing_expected_value' };
    low = Number(expectedValue);
    high = Number(expectedValue);
    source = 'exact';
  } else if (checkType === 'above_threshold') {
    low = rule.warningLow ?? rule.criticalLow ?? rule.genericExpected ?? null;
    high = null;
    source = 'above_threshold';
  } else if (checkType === 'below_threshold') {
    low = null;
    high = rule.warningHigh ?? rule.criticalHigh ?? rule.genericExpected ?? null;
    source = 'below_threshold';
  }

  if ((low === null || low === undefined) && (high === null || high === undefined)) return { valid: false, reasonCode: 'missing_threshold_or_tolerance' };
  if (low !== null && !Number.isFinite(Number(low))) return { valid: false, reasonCode: 'invalid_range_configuration' };
  if (high !== null && !Number.isFinite(Number(high))) return { valid: false, reasonCode: 'invalid_range_configuration' };
  if (low !== null && high !== null && Number(low) > Number(high)) return { valid: false, reasonCode: 'invalid_range_configuration' };
  return { valid: true, low: low === null ? null : Number(low), high: high === null ? null : Number(high), allowedLow: low === null ? null : Number(low), allowedHigh: high === null ? null : Number(high), source, expectedValue: expectedValue === null ? null : Number(expectedValue), warningLow: rule.warningLow ?? null, warningHigh: rule.warningHigh ?? null, criticalLow: rule.criticalLow ?? null, criticalHigh: rule.criticalHigh ?? null };
}

function outsideLow(actual, low) { return low !== null && Number.isFinite(low) && actual < low; }
function outsideHigh(actual, high) { return high !== null && Number.isFinite(high) && actual > high; }
function outsideRange(actual, low, high) { return outsideLow(actual, low) || outsideHigh(actual, high); }
function boundaryDeviation(actual, low, high) {
  if (outsideHigh(actual, high)) return { deviation: actual - high, direction: 'above' };
  if (outsideLow(actual, low)) return { deviation: actual - low, direction: 'below' };
  return { deviation: 0, direction: 'within' };
}

function explicitThresholdSeverity(rule, actual) {
  if (outsideLow(actual, rule.criticalLow ?? null) || outsideHigh(actual, rule.criticalHigh ?? null)) return 'critical';
  if (outsideLow(actual, rule.warningLow ?? null) || outsideHigh(actual, rule.warningHigh ?? null)) return 'warning';
  return null;
}

export function evaluateValue(rule = {}, actual, stateContext = {}) {
  const numericActual = finiteOrNull(actual);
  if (numericActual === null) return pointBlock('needs_validation', 'no_numeric_value', 'No numeric value in matched source row');
  if (!validateDurations(rule)) return pointBlock('needs_configuration', 'invalid_duration_configuration', 'Duration settings are invalid');
  const stateStatus = stateContext.stateMatchStatus || stateContext.status;
  if (['too_old', 'unsupported', 'ambiguous'].includes(stateStatus)) return pointBlock('needs_validation', stateStatus === 'too_old' ? 'timestamp_alignment_unreliable' : 'unsupported_state', 'State context cannot be trusted');
  const checkType = inferCheckType(rule);
  if ((Object.keys(rule.expectedByState || {}).length || Object.keys(rule.expectedRangeByState || {}).length) && !hasThresholds(rule) && !normalizeState(stateContext.systemState) && !normalizeState(stateContext.machineState)) return pointBlock('needs_validation', 'missing_state', 'State is required but missing');
  if (PENDING_CHECK_TYPES.has(checkType) || (checkType && !SUPPORTED_CHECK_TYPES.has(checkType))) return pointBlock('needs_configuration', 'unsupported_or_missing_check_type', `Unsupported check type: ${rule.checkType || checkType || 'blank'}`);
  if (!checkType) return pointBlock('needs_configuration', 'unsupported_or_missing_check_type', 'Rule has no inferable Check Type');
  const expected = selectExpected(rule, stateContext);
  const typeNeedsExpected = ['range', 'range_percent', 'exact'].includes(checkType) && !hasThresholds(rule);
  if (expected.value === null && typeNeedsExpected) return pointBlock('needs_configuration', expected.reasonCode || 'missing_expected_value', expected.reasonCode === 'missing_expected_for_state' ? `Missing Expected for state ${expected.state || 'unknown'}` : 'Required Expected value is missing', expected);
  const range = computeAllowedRange(rule, expected.value, expected);
  if (!range?.valid) return pointBlock('needs_configuration', range?.reasonCode || 'missing_threshold_or_tolerance', 'Allowed range cannot be computed', expected);
  const thresholdSeverity = explicitThresholdSeverity(rule, numericActual);
  const { deviation, direction } = boundaryDeviation(numericActual, range.low, range.high);
  let status = thresholdSeverity || (deviation !== 0 ? 'warning' : 'ok');
  // Duration gates are applied in analyzeParameter after continuous abnormal durations are known.
  const difference = Number.isFinite(range.expectedValue) ? numericActual - range.expectedValue : null;
  return {
    status, reasonCode: status === 'ok' ? 'within_allowed_range' : (status === 'critical' ? 'explicit_critical_threshold' : (thresholdSeverity ? 'explicit_warning_threshold' : 'outside_allowed_range')),
    reason: status === 'ok' ? 'Within allowed range' : (status === 'critical' ? 'Outside explicit critical threshold' : 'Outside allowed range'),
    checkType, evaluator: rule.checkType ? checkType : `inferred ${checkType}`,
    expectedValue: cleanNumeric(range.expectedValue), expected: cleanNumeric(range.expectedValue), expectedState: expected.state || null, expectedSource: expected.source,
    expectedLow: cleanNumeric(range.low), expectedHigh: cleanNumeric(range.high), allowedLow: cleanNumeric(range.allowedLow), allowedHigh: cleanNumeric(range.allowedHigh),
    warningLow: cleanNumeric(range.warningLow), warningHigh: cleanNumeric(range.warningHigh), criticalLow: cleanNumeric(range.criticalLow), criticalHigh: cleanNumeric(range.criticalHigh),
    difference: cleanNumeric(difference), deviation: cleanNumeric(deviation), deviationDirection: direction,
    distanceFromNearestLimit: cleanNumeric(Math.abs(deviation)), explicitThresholdSeverity: thresholdSeverity
  };
}

function pointBlock(status, reasonCode, reason, expected = {}) {
  return { status, reasonCode, blocker: reasonCode, reason, expectedValue: expected.value ?? null, expected: expected.value ?? null, expectedState: expected.state ?? null, expectedLow: null, expectedHigh: null, allowedLow: null, allowedHigh: null, warningLow: null, warningHigh: null, criticalLow: null, criticalHigh: null, difference: null, deviation: null, deviationDirection: null, distanceFromNearestLimit: null };
}

function median(values) {
  const nums = values.filter(value => Number.isFinite(value) && value > 0).slice().sort((a, b) => a - b);
  return nums.length ? nums[Math.floor(nums.length / 2)] : 0;
}

function durationModel(points = [], gapCapMs = DEFAULT_GAP_CAP_MS) {
  const unique = [];
  const byTs = new Map();
  for (const point of points.filter(point => Number.isFinite(point.timestampMs ?? point.t)).sort((a, b) => (a.timestampMs ?? a.t) - (b.timestampMs ?? b.t))) byTs.set(point.timestampMs ?? point.t, point);
  unique.push(...byTs.values());
  const intervals = unique.slice(0, -1).map((point, index) => (unique[index + 1].timestampMs ?? unique[index + 1].t) - (point.timestampMs ?? point.t)).filter(value => Number.isFinite(value) && value > 0);
  const nominal = median(intervals);
  const cap = nominal ? Math.min(gapCapMs, nominal * 3) : gapCapMs;
  const rows = unique.map((point, index) => {
    const next = unique[index + 1];
    const raw = next ? (next.timestampMs ?? next.t) - (point.timestampMs ?? point.t) : 0;
    const durationMs = raw > 0 ? Math.min(raw, cap) : 0;
    return { point, index, rawIntervalMs: raw > 0 ? raw : 0, durationMs, excessiveGapAfter: raw > cap };
  });
  return { rows, nominalIntervalMs: nominal, maxCreditedIntervalMs: cap };
}

export function timeWeightedOutOfRange(points = [], gapCapMs = DEFAULT_GAP_CAP_MS) {
  const model = durationModel(points.map(point => ({ ...point, timestampMs: point.timestampMs ?? point.t })), gapCapMs);
  const totalObservedDurationMs = model.rows.reduce((sum, row) => sum + row.durationMs, 0);
  const totalOutOfRangeDurationMs = model.rows.reduce((sum, row) => sum + (['warning', 'critical'].includes(row.point.status) && !row.point.inTransitionGrace ? row.durationMs : 0), 0);
  const outOfRangePercent = totalObservedDurationMs ? Math.min(100, Math.max(0, totalOutOfRangeDurationMs / totalObservedDurationMs * 100)) : 0;
  return { totalDurationMs: totalObservedDurationMs, totalObservedDurationMs, outOfRangeDurationMs: totalOutOfRangeDurationMs, totalOutOfRangeDurationMs, outOfRangePercent };
}

function actionForStatus(status, rule = {}) {
  if (status === 'critical') return normalizeText(rule.criticalAction) || normalizeText(rule.outOfSpecAction) || NO_ACTION;
  if (status === 'warning') return normalizeText(rule.warningAction) || normalizeText(rule.outOfSpecAction) || NO_ACTION;
  if (status === 'needs_configuration') return `Complete the missing rule configuration in Excel row ${rule.row ?? rule.ruleRow ?? '—'}.`;
  if (status === 'needs_validation') return `Validate timestamp, state, source, and numeric mapping for Excel row ${rule.row ?? rule.ruleRow ?? '—'}.`;
  if (status === 'no_data') return 'No matching usable records were found in the selected period.';
  if (status === 'no_rule') return 'Add an evaluation rule for this discovered signal.';
  return NO_ACTION;
}

function inTransitionGrace(point, previous, rule) {
  const graceMs = Number(rule.transitionGraceSec || 0) * 1000;
  if (!graceMs || !previous) return false;
  const transitioned = normalizeState(point.machineState) !== normalizeState(previous.machineState) || normalizeState(point.systemState) !== normalizeState(previous.systemState);
  if (transitioned) { point.transitionTimestampMs = point.timestampMs; return true; }
  const transitionTimestamp = previous.transitionTimestampMs;
  if (Number.isFinite(transitionTimestamp) && point.timestampMs - transitionTimestamp <= graceMs && point.timestampMs > transitionTimestamp) { point.transitionTimestampMs = transitionTimestamp; return true; }
  return false;
}

function applyDurationGates(chartPoints, durationRows, rule) {
  const warningMs = rule.warningDurationSec === null || rule.warningDurationSec === undefined ? null : Number(rule.warningDurationSec) * 1000;
  const criticalMs = rule.criticalDurationSec === null || rule.criticalDurationSec === undefined ? null : Number(rule.criticalDurationSec) * 1000;
  let streak = 0;
  for (const row of durationRows) {
    const point = row.point;
    const abnormal = ['warning', 'critical'].includes(point.status) && !point.inTransitionGrace;
    if (!abnormal || row.durationMs <= 0) { streak = 0; continue; }
    streak += row.durationMs;
    if (point.status === 'critical' && point.reasonCode === 'explicit_critical_threshold') continue;
    if (criticalMs !== null && streak >= criticalMs) point.status = 'critical';
    else if (warningMs !== null && streak < warningMs) {
      point.status = 'ok';
      point.reasonCode = 'duration_below_warning_threshold';
      point.reason = 'Abnormal spike is shorter than configured Warning Duration Sec';
    }
  }
  return chartPoints;
}

function evaluatedPointFromInput(rule, input, previous) {
  const timestampMs = finiteOrNull(input.timestampMs ?? input.t);
  const actual = finiteOrNull(input.actual);
  if (timestampMs === null) return { timestampMs: null, actual, status: 'needs_validation', reasonCode: 'invalid_timestamp', reason: 'Invalid timestamp', evaluated: false, inTransitionGrace: false, machineState: null, systemState: null, rawTimestamp: input.rawTimestamp || '', sourceFile: input.sourceFile || input.file || null };
  const stateContext = { status: input.stateContextStatus || input.stateMatchStatus || 'matched', stateMatchStatus: input.stateContextStatus || input.stateMatchStatus || 'matched', machineState: input.machineState, systemState: input.systemState };
  const result = evaluateValue(rule, actual, stateContext);
  const grace = inTransitionGrace({ ...input, timestampMs }, previous, rule);
  const status = grace && OPERATIONAL.has(result.status) ? 'ok' : result.status;
  const reasonCode = grace && OPERATIONAL.has(result.status) ? 'transition_grace' : result.reasonCode;
  return {
    t: timestampMs, timestampMs, actual, expected: result.expectedValue, expectedValue: result.expectedValue, allowedLow: result.allowedLow, allowedHigh: result.allowedHigh,
    expectedLow: result.expectedLow, expectedHigh: result.expectedHigh, warningLow: result.warningLow, warningHigh: result.warningHigh, criticalLow: result.criticalLow, criticalHigh: result.criticalHigh,
    machineState: normalizeState(input.machineState) || null, systemState: normalizeState(input.systemState) || null, status, rawStatus: result.status,
    difference: result.difference, deviation: grace && OPERATIONAL.has(result.status) ? 0 : result.deviation, deviationDirection: grace && OPERATIONAL.has(result.status) ? 'within' : result.deviationDirection,
    inTransitionGrace: grace, evaluated: OPERATIONAL.has(status), reasonCode, reason: grace ? 'Point excluded by Transition Grace Sec' : result.reason,
    blocker: result.blocker || null, sourceFile: input.sourceFile || input.file || null, file: input.file || input.sourceFile || null, rawTimestamp: input.rawTimestamp || '', ruleRow: rule.row, row: input.row ?? null,
    component: input.component || rule.component, subsystem: input.subsystem || rule.subsystem, signal: rule.signal, source: input.source || rule.sourceType, timestampStatus: 'valid'
  };
}

export function analyzeParameter(rule = {}, inputs = [], options = {}) {
  const sourceFiles = new Set(inputs.map(row => row.sourceFile || row.file).filter(Boolean));
  if (!rule) return canonicalNoRule({}, inputs, options);
  const baseCoverage = { ruleAvailable: true, sourceAvailable: options.sourceAvailable ?? sourceFiles.size > 0, signalMatched: inputs.length > 0, dataAvailable: inputs.length > 0, numericDataAvailable: inputs.some(row => finiteOrNull(row.actual) !== null), timestampDataAvailable: inputs.some(row => finiteOrNull(row.timestampMs ?? row.t) !== null), stateDataAvailable: inputs.some(row => normalizeState(row.machineState) || normalizeState(row.systemState)), fullyEvaluated: false, blocker: null, blockerReason: null };
  if (!inputs.length) return canonicalSummary(rule, [], { status: 'no_data', reasonCode: 'no_matching_rows', reason: 'Valid rule exists, but no matching rows were found.', coverage: { ...baseCoverage, blocker: 'no_data', blockerReason: 'No matching rows' }, sourceFiles });
  const sortedInputs = inputs.slice().sort((a, b) => (finiteOrNull(a.timestampMs ?? a.t) ?? Number.MAX_SAFE_INTEGER) - (finiteOrNull(b.timestampMs ?? b.t) ?? Number.MAX_SAFE_INTEGER));
  let previous = null;
  let chartPoints = sortedInputs.map(input => {
    const point = evaluatedPointFromInput(rule, input, previous);
    if (Number.isFinite(point.timestampMs)) previous = point;
    return point;
  });
  const validTimestampPoints = chartPoints.filter(point => Number.isFinite(point.timestampMs));
  const model = durationModel(validTimestampPoints, options.gapCapMs || DEFAULT_GAP_CAP_MS);
  chartPoints = applyDurationGates(chartPoints, model.rows, rule);
  return canonicalSummary(rule, chartPoints, { status: null, coverage: baseCoverage, sourceFiles, durationRows: durationModel(chartPoints.filter(point => Number.isFinite(point.timestampMs)), options.gapCapMs || DEFAULT_GAP_CAP_MS).rows });
}

function canonicalNoRule(discovered = {}, inputs = [], options = {}) {
  return canonicalSummary({ id: discovered.ruleId || `NO_RULE_${normalizeToken(discovered.signal || 'signal')}`, row: null, system: discovered.system || 'Unmapped', signal: discovered.signal || '', parameterName: discovered.signal || '', logSource: discovered.logSource || '', sourceType: discovered.logSource || '' }, inputs, { ...options, status: 'no_rule', reasonCode: 'no_matching_rule', reason: 'Signal has data but no matching rule exists.', coverage: { ruleAvailable: false, sourceAvailable: true, signalMatched: true, dataAvailable: inputs.length > 0, numericDataAvailable: inputs.some(row => finiteOrNull(row.actual) !== null), timestampDataAvailable: inputs.some(row => finiteOrNull(row.timestampMs ?? row.t) !== null), stateDataAvailable: false, fullyEvaluated: false, blocker: 'no_rule', blockerReason: 'No matching rule' } });
}

function chooseParameterStatus(points, forced) {
  if (forced) return forced;
  if (!points.length) return 'no_data';
  if (points.some(point => point.status === 'critical' && point.evaluated)) return 'critical';
  if (points.some(point => point.status === 'warning' && point.evaluated)) return 'warning';
  if (points.some(point => point.status === 'ok' && point.evaluated)) return 'ok';
  if (points.some(point => point.status === 'needs_validation')) return 'needs_validation';
  if (points.some(point => point.status === 'needs_configuration')) return 'needs_configuration';
  return 'no_data';
}

function aggregateActual(points) {
  const nums = points.map(point => point.actual).filter(Number.isFinite);
  const sum = nums.reduce((a, b) => a + b, 0);
  return { sampleCount: points.length, numericCount: nums.length, averageActual: nums.length ? cleanNumeric(sum / nums.length) : null, minimumActual: nums.length ? Math.min(...nums) : null, maximumActual: nums.length ? Math.max(...nums) : null };
}

function canonicalSummary(rule, chartPoints, context = {}) {
  const status = cleanStatus(chooseParameterStatus(chartPoints, context.status));
  const operationalPoints = chartPoints.filter(point => point.evaluated);
  const latest = chartPoints.filter(point => Number.isFinite(point.timestampMs)).at(-1) || chartPoints.at(-1) || null;
  const actuals = aggregateActual(chartPoints);
  const durationRows = context.durationRows || durationModel(chartPoints.filter(point => Number.isFinite(point.timestampMs))).rows;
  const totalObservedDurationMs = durationRows.reduce((sum, row) => sum + row.durationMs, 0);
  const totalOutOfRangeDurationMs = durationRows.reduce((sum, row) => sum + (['warning', 'critical'].includes(row.point.status) && !row.point.inTransitionGrace ? row.durationMs : 0), 0);
  const deviationEvents = ['no_data', 'no_rule'].includes(status) ? [] : consolidateDeviationEventsFromRows(rule, durationRows);
  const outOfRangePercent = totalObservedDurationMs ? Math.min(100, Math.max(0, totalOutOfRangeDurationMs / totalObservedDurationMs * 100)) : 0;
  const stateSummaries = buildStateSummaries(rule, chartPoints, durationRows, totalObservedDurationMs, deviationEvents);
  const maxDev = chartPoints.map(point => point.deviation).filter(Number.isFinite);
  const firstDeviationTimestampMs = deviationEvents[0]?.startTimestampMs ?? null;
  const lastDeviationTimestampMs = deviationEvents.at(-1)?.endTimestampMs ?? null;
  const coverage = { ...(context.coverage || {}), fullyEvaluated: operationalPoints.length > 0, blocker: context.coverage?.blocker || (OPERATIONAL.has(status) ? null : chartPoints.find(point => !point.evaluated)?.reasonCode || status), blockerReason: context.coverage?.blockerReason || (OPERATIONAL.has(status) ? null : chartPoints.find(point => !point.evaluated)?.reason || status) };
  const summary = {
    ruleId: rule.id || rule.ruleId || null, ruleRow: rule.row ?? rule.ruleRow ?? null, system: rule.system || '', subsystem: rule.subsystem || '', component: latest?.component || rule.component || '', signal: rule.signal || '', parameterName: rule.parameterName || rule.signal || '', sourceFile: [...(context.sourceFiles || [])][0] || latest?.sourceFile || null, logSource: rule.logSource || rule.sourceType || '', valueMetric: rule.valueMetric || rule.parameterType || '', unit: rule.unit || '', checkType: inferCheckType(rule),
    configuration: { expectedByState: rule.expectedByState || {}, expectedRangeByState: rule.expectedRangeByState || {}, genericExpected: rule.genericExpected ?? null, genericExpectedRange: rule.genericExpectedRange || null, tolerance: rule.tolerance || null, toleranceType: rule.tolerance?.mode || null, warningLow: rule.warningLow ?? null, warningHigh: rule.warningHigh ?? null, criticalLow: rule.criticalLow ?? null, criticalHigh: rule.criticalHigh ?? null, warningDurationSec: rule.warningDurationSec ?? null, criticalDurationSec: rule.criticalDurationSec ?? null, transitionGraceSec: rule.transitionGraceSec ?? null, warningSeverity: rule.warningSeverity || null, criticalSeverity: rule.criticalSeverity || null, warningAction: rule.warningAction || '', criticalAction: rule.criticalAction || '', outOfSpecAction: rule.outOfSpecAction || '' },
    coverage, status, reasonCode: context.reasonCode || latest?.reasonCode || coverage.blocker || (status === 'ok' ? 'within_allowed_range' : status), reason: context.reason || latest?.reason || coverage.blockerReason || status,
    latestTimestampMs: latest?.timestampMs ?? null, latestActual: latest?.actual ?? null, averageActual: actuals.averageActual, minimumActual: actuals.minimumActual, maximumActual: actuals.maximumActual,
    currentMachineState: latest?.machineState || null, currentSystemState: latest?.systemState || null, currentExpected: latest?.expected ?? null, currentAllowedLow: latest?.allowedLow ?? null, currentAllowedHigh: latest?.allowedHigh ?? null, currentDifference: latest?.difference ?? null, currentDeviation: latest?.deviation ?? null, currentDeviationDirection: latest?.deviationDirection ?? null,
    sampleCount: chartPoints.length, evaluatedSampleCount: operationalPoints.length, fullyEvaluatedPoints: operationalPoints.length, matchedRows: chartPoints.length, numericRows: actuals.numericCount, classifiedPoints: chartPoints.length, blockedPoints: chartPoints.filter(point => !point.evaluated).length,
    totalObservedDurationMs: cleanNumeric(totalObservedDurationMs), totalOutOfRangeDurationMs: cleanNumeric(Math.min(totalOutOfRangeDurationMs, totalObservedDurationMs)), outOfRangePercent: cleanNumeric(outOfRangePercent), longestDeviationDurationMs: cleanNumeric(Math.max(0, ...deviationEvents.map(event => event.durationMs || 0))), deviationEventCount: deviationEvents.length, eventCount: deviationEvents.length, firstDeviationTimestampMs, lastDeviationTimestampMs, maximumDeviation: maxDev.length ? Math.max(...maxDev) : null, minimumDeviation: maxDev.length ? Math.min(...maxDev) : null,
    stateSummaries, deviationEvents, chartPoints: chartPoints.map(cleanPoint), recommendedAction: actionForStatus(status, rule), expected: latest?.expected ?? null, expectedValue: latest?.expected ?? null, allowedLow: latest?.allowedLow ?? null, allowedHigh: latest?.allowedHigh ?? null, expectedLow: latest?.expectedLow ?? null, expectedHigh: latest?.expectedHigh ?? null, minActual: actuals.minimumActual, maxActual: actuals.maximumActual, blocker: coverage.blocker, blockerCounts: countBy(chartPoints.map(point => point.reasonCode).filter(Boolean)), evaluatedCounts: countBy(chartPoints.map(point => point.status))
  };
  return sanitizeSummary(validateCanonicalSummary(summary));
}

function cleanPoint(point) {
  return { timestampMs: point.timestampMs ?? null, t: point.timestampMs ?? null, actual: point.actual ?? null, expected: point.expected ?? null, expectedValue: point.expected ?? null, allowedLow: point.allowedLow ?? null, allowedHigh: point.allowedHigh ?? null, expectedLow: point.expectedLow ?? null, expectedHigh: point.expectedHigh ?? null, warningLow: point.warningLow ?? null, warningHigh: point.warningHigh ?? null, criticalLow: point.criticalLow ?? null, criticalHigh: point.criticalHigh ?? null, machineState: point.machineState || null, systemState: point.systemState || null, status: cleanStatus(point.status), difference: point.difference ?? null, deviation: point.deviation ?? null, deviationDirection: point.deviationDirection || null, inTransitionGrace: Boolean(point.inTransitionGrace), evaluated: Boolean(point.evaluated), reasonCode: point.reasonCode || null, reason: point.reason || '', rawTimestamp: point.rawTimestamp || '', sourceFile: point.sourceFile || null, file: point.file || point.sourceFile || null, ruleRow: point.ruleRow ?? null, row: point.row ?? null, signal: point.signal || null, component: point.component || null, subsystem: point.subsystem || null, source: point.source || null, timestampStatus: point.timestampStatus || (point.timestampMs === null ? 'invalid' : 'valid') };
}

function countBy(values) {
  return values.reduce((acc, value) => ({ ...acc, [value]: (acc[value] || 0) + 1 }), {});
}

function eventKey(point) {
  return [point.status, point.machineState || '', point.systemState || '', point.expected ?? '', point.allowedLow ?? '', point.allowedHigh ?? '', point.evaluated ? 'eval' : 'blocked'].join('|');
}

function consolidateDeviationEventsFromRows(rule, rows) {
  const events = [];
  let active = null;
  for (const row of rows) {
    const point = row.point;
    const abnormal = ['warning', 'critical'].includes(point.status) && !point.inTransitionGrace && point.evaluated !== false && row.durationMs > 0;
    if (!abnormal) {
      if (active) events.push(finalizeActiveEvent(active));
      active = null;
      continue;
    }
    const key = eventKey(point);
    if (!active || active.key !== key) {
      if (active) events.push(finalizeActiveEvent(active));
      active = { key, ruleId: rule.id || rule.ruleId || null, ruleRow: rule.row ?? rule.ruleRow ?? null, system: rule.system || '', subsystem: rule.subsystem || '', component: point.component || rule.component || '', signal: rule.signal || '', parameterName: rule.parameterName || rule.signal || '', startTimestampMs: point.timestampMs, endTimestampMs: point.timestampMs + row.durationMs, durationMs: 0, machineState: point.machineState || null, systemState: point.systemState || null, severity: point.status, pointCount: 0, expected: point.expected ?? null, allowedLow: point.allowedLow ?? null, allowedHigh: point.allowedHigh ?? null, sumActual: 0, minimumActual: null, maximumActual: null, maximumDeviation: null, minimumDeviation: null, deviationDirection: point.deviationDirection || null, recommendedAction: actionForStatus(point.status, rule) };
    }
    active.endTimestampMs = point.timestampMs + row.durationMs;
    active.durationMs += row.durationMs;
    active.pointCount += 1;
    if (Number.isFinite(point.actual)) {
      active.sumActual += point.actual;
      active.minimumActual = active.minimumActual === null ? point.actual : Math.min(active.minimumActual, point.actual);
      active.maximumActual = active.maximumActual === null ? point.actual : Math.max(active.maximumActual, point.actual);
    }
    if (Number.isFinite(point.deviation)) {
      active.maximumDeviation = active.maximumDeviation === null ? point.deviation : Math.max(active.maximumDeviation, point.deviation);
      active.minimumDeviation = active.minimumDeviation === null ? point.deviation : Math.min(active.minimumDeviation, point.deviation);
    }
    if (row.excessiveGapAfter) {
      events.push(finalizeActiveEvent(active));
      active = null;
    }
  }
  if (active) events.push(finalizeActiveEvent(active));
  return events.sort((a, b) => a.startTimestampMs - b.startTimestampMs);
}

function finalizeActiveEvent(active) {
  const event = { ...active, id: `D-${active.ruleId}-${active.startTimestampMs}`, start: active.startTimestampMs, end: active.endTimestampMs, startTime: active.startTimestampMs, endTime: active.endTimestampMs, state: active.systemState || active.machineState, averageActual: active.pointCount ? cleanNumeric(active.sumActual / active.pointCount) : null, durationMs: cleanNumeric(active.durationMs) };
  delete event.key; delete event.sumActual;
  return sanitizeSummary(event);
}

export function consolidateDeviationEvents(points = [], gapToleranceMs = 30000) {
  const events = [];
  let active = null;
  for (const point of points.filter(row => ['warning', 'critical'].includes(row.status) && Number.isFinite(row.timestampMs ?? row.t)).sort((a, b) => (a.timestampMs ?? a.t) - (b.timestampMs ?? b.t))) {
    const timestampMs = point.timestampMs ?? point.t;
    const key = [point.status, point.machineState || '', point.systemState || '', point.expectedValue ?? point.expected ?? '', point.allowedLow ?? point.expectedLow ?? '', point.allowedHigh ?? point.expectedHigh ?? ''].join('|');
    if (!active || active.key !== key || timestampMs - active.lastTimestampMs > gapToleranceMs) {
      if (active) events.push(finalizeActiveEvent(active));
      active = { key, ruleId: point.ruleId || null, ruleRow: point.ruleRow ?? null, system: point.system || '', subsystem: point.subsystem || '', component: point.component || '', signal: point.signal || '', parameterName: point.parameterName || point.signal || '', startTimestampMs: timestampMs, endTimestampMs: timestampMs, lastTimestampMs: timestampMs, durationMs: 0, machineState: point.machineState || null, systemState: point.systemState || null, severity: point.status, pointCount: 0, expected: point.expectedValue ?? point.expected ?? null, allowedLow: point.allowedLow ?? point.expectedLow ?? null, allowedHigh: point.allowedHigh ?? point.expectedHigh ?? null, sumActual: 0, minimumActual: null, maximumActual: null, maximumDeviation: null, minimumDeviation: null, deviationDirection: point.deviationDirection || null, recommendedAction: point.recommendedAction || '' };
    }
    active.endTimestampMs = timestampMs;
    active.durationMs = Math.max(0, active.endTimestampMs - active.startTimestampMs);
    active.lastTimestampMs = timestampMs;
    active.pointCount += 1;
    if (Number.isFinite(point.actual)) { active.sumActual += point.actual; active.minimumActual = active.minimumActual === null ? point.actual : Math.min(active.minimumActual, point.actual); active.maximumActual = active.maximumActual === null ? point.actual : Math.max(active.maximumActual, point.actual); }
    if (Number.isFinite(point.deviation)) { active.maximumDeviation = active.maximumDeviation === null ? Math.abs(point.deviation) : Math.max(active.maximumDeviation, Math.abs(point.deviation)); active.minimumDeviation = active.minimumDeviation === null ? point.deviation : Math.min(active.minimumDeviation, point.deviation); }
  }
  if (active) events.push(finalizeActiveEvent(active));
  return events;
}

function buildStateSummaries(rule, chartPoints, durationRows, totalObservedDurationMs, events) {
  const states = new Map();
  const rowsByPoint = new Map(durationRows.map(row => [row.point, row]));
  for (const point of chartPoints) {
    const state = matrixState(point.systemState || point.machineState);
    const row = states.get(state) || { state, timeInStateMs: 0, sampleCount: 0, evaluatedSampleCount: 0, sumActual: 0, sumDifference: 0, diffCount: 0, averageActual: null, minimumActual: null, maximumActual: null, totalObservedDurationMs: 0, outOfRangeDurationMs: 0, outOfRangePercent: 0, expected: point.expected ?? null, allowedLow: point.allowedLow ?? null, allowedHigh: point.allowedHigh ?? null, firstDeviationTimestampMs: null, lastDeviationTimestampMs: null, maximumPositiveDifference: null, maximumNegativeDifference: null, maximumDeviation: null, statusCounts: {}, reasonCode: null };
    row.sampleCount += 1;
    if (point.evaluated) row.evaluatedSampleCount += 1;
    if (Number.isFinite(point.actual)) {
      row.sumActual += point.actual;
      row.averageActual = cleanNumeric(row.sumActual / row.sampleCount);
      row.minimumActual = row.minimumActual === null ? point.actual : Math.min(row.minimumActual, point.actual);
      row.maximumActual = row.maximumActual === null ? point.actual : Math.max(row.maximumActual, point.actual);
    }
    if (Number.isFinite(point.difference)) {
      row.sumDifference += point.difference; row.diffCount += 1;
      row.maximumPositiveDifference = row.maximumPositiveDifference === null ? point.difference : Math.max(row.maximumPositiveDifference, point.difference);
      row.maximumNegativeDifference = row.maximumNegativeDifference === null ? point.difference : Math.min(row.maximumNegativeDifference, point.difference);
    }
    if (Number.isFinite(point.deviation)) row.maximumDeviation = row.maximumDeviation === null ? point.deviation : Math.max(row.maximumDeviation, point.deviation);
    const durationRow = rowsByPoint.get(point);
    const duration = durationRow?.durationMs || 0;
    row.timeInStateMs += duration;
    row.totalObservedDurationMs += duration;
    if (['warning', 'critical'].includes(point.status) && !point.inTransitionGrace) {
      row.outOfRangeDurationMs += duration;
      row.firstDeviationTimestampMs = row.firstDeviationTimestampMs ?? point.timestampMs;
      row.lastDeviationTimestampMs = point.timestampMs;
    }
    row.statusCounts[point.status] = (row.statusCounts[point.status] || 0) + 1;
    row.reasonCode = row.reasonCode || point.reasonCode;
    states.set(state, row);
  }
  return [...states.values()].map(row => {
    const stateEvents = events.filter(event => matrixState(event.systemState || event.machineState) === row.state);
    const status = row.statusCounts.critical ? 'critical' : row.statusCounts.warning ? 'warning' : row.statusCounts.ok ? 'ok' : row.statusCounts.needs_validation ? 'needs_validation' : row.statusCounts.needs_configuration ? 'needs_configuration' : 'no_data';
    const outOfRangePercent = row.totalObservedDurationMs ? Math.min(100, row.outOfRangeDurationMs / row.totalObservedDurationMs * 100) : 0;
    const clean = { state: row.state, timeInStateMs: cleanNumeric(row.timeInStateMs), timeInStatePercent: totalObservedDurationMs ? cleanNumeric(row.timeInStateMs / totalObservedDurationMs * 100) : 0, expected: row.expected, allowedLow: row.allowedLow, allowedHigh: row.allowedHigh, sampleCount: row.sampleCount, evaluatedSampleCount: row.evaluatedSampleCount, averageActual: row.averageActual, minimumActual: row.minimumActual, maximumActual: row.maximumActual, minActual: row.minimumActual, maxActual: row.maximumActual, totalObservedDurationMs: cleanNumeric(row.totalObservedDurationMs), outOfRangeDurationMs: cleanNumeric(row.outOfRangeDurationMs), outOfRangePercent: cleanNumeric(outOfRangePercent), longestDeviationDurationMs: cleanNumeric(Math.max(0, ...stateEvents.map(event => event.durationMs || 0))), longestDeviationMs: cleanNumeric(Math.max(0, ...stateEvents.map(event => event.durationMs || 0))), deviationEventCount: stateEvents.length, firstDeviationTimestampMs: row.firstDeviationTimestampMs, lastDeviationTimestampMs: row.lastDeviationTimestampMs, averageDifference: row.diffCount ? cleanNumeric(row.sumDifference / row.diffCount) : null, maximumPositiveDifference: row.maximumPositiveDifference, maximumNegativeDifference: row.maximumNegativeDifference, maximumDeviation: row.maximumDeviation, status, reasonCode: row.reasonCode, recommendedAction: actionForStatus(status, rule) };
    return sanitizeSummary(clean);
  }).sort((a, b) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state));
}

export function summarizeStateComparisons(points = []) {
  return buildStateSummaries({}, points.map(point => ({ ...point, timestampMs: point.timestampMs ?? point.t ?? 0, expected: point.expected ?? point.expectedValue ?? null, evaluated: OPERATIONAL.has(point.status), reasonCode: point.reasonCode || null })), durationModel(points.map(point => ({ ...point, timestampMs: point.timestampMs ?? point.t ?? 0 }))).rows, 0, []);
}

export function validateCanonicalSummary(summary) {
  const invalid = [];
  if ((summary.totalObservedDurationMs || 0) < 0) invalid.push('negative_observed_duration');
  if ((summary.totalOutOfRangeDurationMs || 0) < 0) invalid.push('negative_out_of_range_duration');
  if ((summary.totalOutOfRangeDurationMs || 0) > (summary.totalObservedDurationMs || 0) + 1) invalid.push('out_of_range_exceeds_observed');
  if ((summary.outOfRangePercent || 0) < 0 || (summary.outOfRangePercent || 0) > 100) invalid.push('invalid_out_of_range_percent');
  if (summary.firstDeviationTimestampMs !== null && summary.lastDeviationTimestampMs !== null && summary.firstDeviationTimestampMs > summary.lastDeviationTimestampMs) invalid.push('invalid_deviation_window');
  if ([summary.minimumActual, summary.averageActual, summary.maximumActual].every(Number.isFinite) && !(summary.minimumActual <= summary.averageActual && summary.averageActual <= summary.maximumActual)) invalid.push('invalid_actual_aggregate');
  if (OPERATIONAL.has(summary.status) && !(summary.evaluatedSampleCount > 0)) invalid.push('operational_without_evaluated_samples');
  if (['no_data', 'no_rule'].includes(summary.status) && (summary.deviationEvents || []).length) invalid.push('non_operational_events');
  if ((summary.deviationEvents || []).some(event => (event.durationMs || 0) < 0)) invalid.push('negative_event_duration');
  if (invalid.length) return { ...summary, status: 'needs_validation', reasonCode: 'canonical_invariant_violation', reason: `Canonical invariant violation: ${invalid.join(', ')}`, coverage: { ...(summary.coverage || {}), fullyEvaluated: false, blocker: 'canonical_invariant_violation', blockerReason: invalid.join(', ') } };
  return summary;
}

function sanitizeSummary(value) {
  if (Array.isArray(value)) return value.map(sanitizeSummary);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, val]) => [key, sanitizeSummary(val === undefined ? null : val)]));
  if (typeof value === 'number') return Number.isFinite(value) ? cleanNumeric(value) : null;
  return value === undefined ? null : value;
}

export function validateRule(rule) {
  if (!rule.logSource) return 'missing_source';
  if (!rule.signal) return 'missing_signal';
  if (!rule.system) return 'missing_system';
  const inferred = inferCheckType(rule);
  if (PENDING_CHECK_TYPES.has(inferred)) return 'valid';
  if (inferred && !SUPPORTED_CHECK_TYPES.has(inferred)) return 'unsupported_check_type';
  return 'valid';
}

export function formatNumber(value) {
  return Number.isFinite(value) ? Number(value).toFixed(2).replace(/\.00$/, '') : '—';
}

export function formatRange(low, high) {
  const lowText = Number.isFinite(low) ? formatNumber(low) : '—';
  const highText = Number.isFinite(high) ? formatNumber(high) : '—';
  return `${lowText}–${highText}`;
}
