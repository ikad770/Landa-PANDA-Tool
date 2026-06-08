import { MAX_DEVIATION_EVENTS_PER_RULE } from './config.js';

export function normalizeText(value) {
  return String(value ?? '').replace(/\uFEFF/g, '').replace(/\u00A0/g, ' ').trim();
}

export function normalizeToken(value) {
  return normalizeText(value).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

export function parseNumber(value) {
  if (value === 0) return 0;
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  let cleaned = String(value).trim();
  if (/^-?\d+,\d+$/.test(cleaned)) cleaned = cleaned.replace(',', '.');
  else cleaned = cleaned.replace(/,/g, '');
  if (!cleaned) return null;
  const match = cleaned.match(/[-+]?\d*\.?\d+(?:e[-+]?\d+)?/i);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeState(value) {
  const token = normalizeToken(value);
  const table = {
    on: 'ON', standby: 'Standby', ready: 'Ready', prepare2print: 'Prepare2Print', prepare_to_print: 'Prepare2Print', prepare_print: 'Prepare2Print',
    printing: 'Printing', print: 'Printing', printend: 'PrintEnd', print_end: 'PrintEnd', recovery: 'Recovery', error: 'Error', fault: 'Error'
  };
  return table[token] || (normalizeText(value) || null);
}

export function resolveExpected(rule, machineState, systemState) {
  const systemKey = normalizeState(systemState);
  const machineKey = normalizeState(machineState);
  if (systemKey && rule.expectedByState?.has(systemKey)) return { expected: rule.expectedByState.get(systemKey), source: 'system_state', state: systemKey };
  if (machineKey && rule.expectedByState?.has(machineKey)) return { expected: rule.expectedByState.get(machineKey), source: 'machine_state', state: machineKey };
  if (!rule.hasStateSpecificExpected && Number.isFinite(rule.genericExpected)) return { expected: rule.genericExpected, source: 'generic', state: null };
  return { expected: null, source: 'missing', state: systemKey || machineKey || null };
}

export function computeAllowedRange(rule, expected) {
  let low = Number.isFinite(rule.warningLow) ? rule.warningLow : null;
  let high = Number.isFinite(rule.warningHigh) ? rule.warningHigh : null;
  if ((low === null || high === null) && Number.isFinite(rule.specTolerance) && Number.isFinite(expected)) {
    const tolerance = Math.abs(rule.specTolerance);
    if (low === null) low = expected - tolerance;
    if (high === null) high = expected + tolerance;
  }
  if (low === null && high === null && Number.isFinite(expected) && normalizeToken(rule.checkType) === 'exact') {
    low = expected;
    high = expected;
  }
  if (low !== null && high !== null && low > high) return { valid: false, low, high, reasonCode: 'invalid_range_configuration' };
  if (low === null && high === null) return { valid: false, low, high, reasonCode: 'missing_threshold_or_tolerance' };
  return { valid: true, low, high, reasonCode: '' };
}

export function comparePoint(rule, point, stateContext = {}) {
  if (!Number.isFinite(point.numericValue)) return { status: 'needs_validation', reasonCode: 'non_numeric_value', reason: 'Value is not numeric.', expected: null, allowedLow: null, allowedHigh: null, difference: null, deviation: null };
  const machineState = stateContext.machineState ?? point.machineState ?? null;
  const systemState = stateContext.systemState ?? point.systemState ?? null;
  if (stateContext.status && !['matched', 'exact', 'previous_state'].includes(stateContext.status)) {
    return { status: 'needs_validation', reasonCode: 'invalid_state_alignment', reason: 'Machine/System state could not be aligned for this timestamp.', expected: null, allowedLow: null, allowedHigh: null, difference: null, deviation: null, machineState, systemState };
  }
  const expectedInfo = resolveExpected(rule, machineState, systemState);
  if (!Number.isFinite(expectedInfo.expected)) return { status: 'needs_configuration', reasonCode: 'missing_expected', reason: 'No Expected value is configured for the aligned state.', expected: null, allowedLow: null, allowedHigh: null, difference: null, deviation: null, machineState, systemState };
  const range = computeAllowedRange(rule, expectedInfo.expected);
  if (!range.valid) return { status: 'needs_configuration', reasonCode: range.reasonCode, reason: 'Allowed Range cannot be computed from the rule configuration.', expected: expectedInfo.expected, allowedLow: range.low, allowedHigh: range.high, difference: point.numericValue - expectedInfo.expected, deviation: null, machineState, systemState };
  const value = point.numericValue;
  const below = Number.isFinite(range.low) && value < range.low;
  const above = Number.isFinite(range.high) && value > range.high;
  const deviation = below ? range.low - value : above ? value - range.high : 0;
  let status = deviation > 0 ? 'warning' : 'ok';
  if (deviation > 0 && hasExplicitCritical(rule, value)) status = 'critical';
  return {
    status,
    reasonCode: status === 'ok' ? 'within_allowed_range' : status === 'critical' ? 'explicit_critical_threshold_exceeded' : 'outside_allowed_range',
    reason: status === 'ok' ? 'Actual is within Allowed Range.' : status === 'critical' ? 'Actual breached an explicit Critical configuration.' : 'Actual is outside Allowed Range.',
    expected: expectedInfo.expected,
    expectedSource: expectedInfo.source,
    allowedLow: range.low,
    allowedHigh: range.high,
    difference: value - expectedInfo.expected,
    deviation,
    machineState,
    systemState
  };
}

function hasExplicitCritical(rule, value) {
  if (Number.isFinite(rule.criticalLow) && value < rule.criticalLow) return true;
  if (Number.isFinite(rule.criticalHigh) && value > rule.criticalHigh) return true;
  return false;
}

export function createParameterAccumulator(rule, stream = {}) {
  return {
    rule,
    signalId: stream.signalId || null,
    sampleCount: 0,
    evaluatedSampleCount: 0,
    validNumericCount: 0,
    statusCounts: { ok: 0, warning: 0, critical: 0, needs_configuration: 0, needs_validation: 0 },
    firstTimestampMs: null,
    lastTimestampMs: null,
    latestTimestampMs: null,
    latestActual: null,
    sum: 0,
    minimumActual: null,
    maximumActual: null,
    currentMachineState: null,
    currentSystemState: null,
    currentExpected: null,
    currentAllowedLow: null,
    currentAllowedHigh: null,
    currentDifference: null,
    currentDeviation: null,
    reasonCode: '',
    reason: '',
    totalObservedDurationMs: 0,
    totalOutOfRangeDurationMs: 0,
    firstDeviationTimestampMs: null,
    lastDeviationTimestampMs: null,
    longestDeviationDurationMs: 0,
    deviationEventCount: 0,
    deviationEvents: [],
    activeDeviation: null,
    stateTotals: new Map(),
    lastPoint: null,
    finalized: false
  };
}

export function updateParameterAccumulator(acc, point, comparison) {
  const ts = point.timestampMs;
  if (!Number.isFinite(ts)) return;
  if (acc.lastPoint) {
    const delta = Math.max(0, ts - acc.lastPoint.timestampMs);
    acc.totalObservedDurationMs += delta;
    if (['warning', 'critical'].includes(acc.lastPoint.status)) acc.totalOutOfRangeDurationMs += delta;
    if (acc.activeDeviation) acc.activeDeviation.durationMs += delta;
  }
  acc.sampleCount += 1;
  if (Number.isFinite(point.numericValue)) {
    acc.validNumericCount += 1;
    acc.sum += point.numericValue;
    acc.minimumActual = acc.minimumActual === null ? point.numericValue : Math.min(acc.minimumActual, point.numericValue);
    acc.maximumActual = acc.maximumActual === null ? point.numericValue : Math.max(acc.maximumActual, point.numericValue);
    acc.latestActual = point.numericValue;
  }
  acc.evaluatedSampleCount += ['ok', 'warning', 'critical'].includes(comparison.status) ? 1 : 0;
  acc.statusCounts[comparison.status] = (acc.statusCounts[comparison.status] || 0) + 1;
  acc.firstTimestampMs = acc.firstTimestampMs ?? ts;
  acc.lastTimestampMs = ts;
  acc.latestTimestampMs = ts;
  acc.currentMachineState = comparison.machineState ?? point.machineState ?? null;
  acc.currentSystemState = comparison.systemState ?? point.systemState ?? null;
  acc.currentExpected = comparison.expected;
  acc.currentAllowedLow = comparison.allowedLow;
  acc.currentAllowedHigh = comparison.allowedHigh;
  acc.currentDifference = comparison.difference;
  acc.currentDeviation = comparison.deviation;
  acc.reasonCode = comparison.reasonCode;
  acc.reason = comparison.reason;
  const state = acc.currentMachineState || 'Unknown';
  const stateEntry = acc.stateTotals.get(state) || { state, sampleCount: 0, outOfRangeCount: 0 };
  stateEntry.sampleCount += 1;
  if (['warning', 'critical'].includes(comparison.status)) stateEntry.outOfRangeCount += 1;
  acc.stateTotals.set(state, stateEntry);
  updateDeviationEvent(acc, point, comparison);
  acc.lastPoint = { timestampMs: ts, status: comparison.status };
}

function updateDeviationEvent(acc, point, comparison) {
  const deviating = ['warning', 'critical'].includes(comparison.status);
  if (deviating) {
    acc.firstDeviationTimestampMs = acc.firstDeviationTimestampMs ?? point.timestampMs;
    acc.lastDeviationTimestampMs = point.timestampMs;
    if (!acc.activeDeviation) {
      acc.deviationEventCount += 1;
      acc.activeDeviation = { startTimestampMs: point.timestampMs, endTimestampMs: point.timestampMs, durationMs: 0, status: comparison.status, maximumDeviation: comparison.deviation || 0 };
    } else {
      acc.activeDeviation.endTimestampMs = point.timestampMs;
      acc.activeDeviation.status = comparison.status === 'critical' ? 'critical' : acc.activeDeviation.status;
      acc.activeDeviation.maximumDeviation = Math.max(acc.activeDeviation.maximumDeviation || 0, comparison.deviation || 0);
    }
  } else if (acc.activeDeviation) {
    closeDeviationEvent(acc, point.timestampMs);
  }
}

function closeDeviationEvent(acc, endTimestampMs) {
  const event = acc.activeDeviation;
  if (!event) return;
  event.endTimestampMs = endTimestampMs;
  acc.longestDeviationDurationMs = Math.max(acc.longestDeviationDurationMs, event.durationMs || 0);
  if (acc.deviationEvents.length < MAX_DEVIATION_EVENTS_PER_RULE) acc.deviationEvents.push({ ...event });
  acc.activeDeviation = null;
}

export function finalizeParameterAccumulator(acc, options = {}) {
  if (acc.finalized) throw new Error(`Parameter ${acc.rule?.ruleId || ''} finalized more than once.`);
  if (acc.activeDeviation) closeDeviationEvent(acc, acc.lastTimestampMs);
  acc.finalized = true;
  const rule = acc.rule;
  const status = chooseFinalStatus(acc, options.noData);
  const coverage = {
    ruleAvailable: true,
    signalMatched: !!acc.signalId,
    dataAvailable: acc.sampleCount > 0,
    numericDataAvailable: acc.validNumericCount > 0,
    stateDataAvailable: acc.stateTotals.size > 0,
    fullyEvaluated: acc.evaluatedSampleCount > 0
  };
  return {
    parameterId: rule.parameterId,
    ruleId: rule.ruleId,
    ruleRow: rule.ruleRow,
    system: rule.system,
    subsystem: rule.subsystem,
    component: rule.component,
    signalId: acc.signalId,
    signalName: rule.signalName,
    sourceName: rule.sourceName,
    unit: rule.unit || null,
    status,
    reasonCode: status === 'no_data' ? 'configured_rule_without_matching_data' : acc.reasonCode,
    reason: status === 'no_data' ? 'Rule is configured, but no matching signal data was found.' : acc.reason,
    coverage,
    sampleCount: acc.sampleCount,
    evaluatedSampleCount: acc.evaluatedSampleCount,
    firstTimestampMs: acc.firstTimestampMs,
    lastTimestampMs: acc.lastTimestampMs,
    latestTimestampMs: acc.latestTimestampMs,
    latestActual: acc.latestActual,
    averageActual: acc.validNumericCount ? acc.sum / acc.validNumericCount : null,
    minimumActual: acc.minimumActual,
    maximumActual: acc.maximumActual,
    currentMachineState: acc.currentMachineState,
    currentSystemState: acc.currentSystemState,
    currentExpected: acc.currentExpected,
    currentAllowedLow: acc.currentAllowedLow,
    currentAllowedHigh: acc.currentAllowedHigh,
    currentDifference: acc.currentDifference,
    currentDeviation: acc.currentDeviation,
    totalObservedDurationMs: acc.totalObservedDurationMs,
    totalOutOfRangeDurationMs: acc.totalOutOfRangeDurationMs,
    outOfRangePercent: acc.totalObservedDurationMs ? acc.totalOutOfRangeDurationMs / acc.totalObservedDurationMs * 100 : 0,
    deviationEventCount: acc.deviationEventCount,
    firstDeviationTimestampMs: acc.firstDeviationTimestampMs,
    lastDeviationTimestampMs: acc.lastDeviationTimestampMs,
    longestDeviationDurationMs: acc.longestDeviationDurationMs,
    recommendedAction: chooseAction(rule, status),
    stateSummaries: Array.from(acc.stateTotals.values()),
    deviationEvents: acc.deviationEvents,
    rawPointCount: options.rawPointCount || acc.sampleCount,
    renderedPointCount: options.renderedPointCount || 0,
    downsampled: !!options.downsampled,
    returnedDeviationEventCount: acc.deviationEvents.length,
    eventsTruncated: acc.deviationEventCount > acc.deviationEvents.length
  };
}

function chooseFinalStatus(acc, noData) {
  if (noData) return 'no_data';
  if (acc.statusCounts.critical) return 'critical';
  if (acc.statusCounts.warning) return 'warning';
  if (acc.statusCounts.ok) return 'ok';
  if (acc.statusCounts.needs_validation) return 'needs_validation';
  return 'needs_configuration';
}

function chooseAction(rule, status) {
  if (status === 'critical') return rule.criticalAction || rule.outOfSpecAction || null;
  if (status === 'warning') return rule.warningAction || rule.outOfSpecAction || null;
  return null;
}

export function formatRange(low, high) {
  const f = value => Number.isFinite(value) ? Number(value).toFixed(2).replace(/\.00$/, '') : '—';
  return `${f(low)} – ${f(high)}`;
}
