import { MAX_CHART_POINTS_PER_SIGNAL, MAX_DIAGNOSTIC_ENTRIES, MAX_DIAGNOSTIC_MESSAGE_LENGTH } from './config.js';
import { createStateResolver, createStateTimeline } from './machine-states.js';
import { buildRulesIndex, findRuleForStream } from './rules.js';
import { comparePoint, createParameterAccumulator, finalizeParameterAccumulator, updateParameterAccumulator } from './evaluation.js';
import { buildServiceDecision } from './service-decision.js';

export function createDiagnostics() {
  return { counts: {}, recentEntries: [] };
}

export function addDiagnostic(diagnostics, level, message, metadata = {}) {
  diagnostics.counts[level] = (diagnostics.counts[level] || 0) + 1;
  const entry = { level, message: String(message || '').slice(0, MAX_DIAGNOSTIC_MESSAGE_LENGTH), ...scalarOnly(metadata) };
  diagnostics.recentEntries.push(entry);
  if (diagnostics.recentEntries.length > MAX_DIAGNOSTIC_ENTRIES) diagnostics.recentEntries.shift();
}

function scalarOnly(input) {
  const out = {};
  for (const [key, value] of Object.entries(input || {})) {
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) out[key] = value;
  }
  return out;
}

export function createChartSampler(limit = MAX_CHART_POINTS_PER_SIGNAL) {
  const safeLimit = Math.max(10, Math.min(3000, Number(limit) || MAX_CHART_POINTS_PER_SIGNAL));
  const points = [];
  let rawPointCount = 0;
  let bucket = null;
  let previousState = null;
  let previousStatus = null;
  function push(point) {
    if (!point) return;
    const compact = compactPoint(point);
    const last = points[points.length - 1];
    if (last && last.t === compact.t && last.actual === compact.actual && last.status === compact.status) return;
    points.push(compact);
  }
  function flushBucket() {
    if (!bucket) return;
    push(bucket.first);
    if (bucket.min && bucket.min !== bucket.first && bucket.min !== bucket.max) push(bucket.min);
    if (bucket.max && bucket.max !== bucket.first) push(bucket.max);
    if (bucket.last && bucket.last !== bucket.first && bucket.last !== bucket.min && bucket.last !== bucket.max) push(bucket.last);
    bucket = null;
  }
  return {
    add(point) {
      rawPointCount += 1;
      const mustKeep = rawPointCount === 1 || point.keep || ['warning', 'critical'].includes(point.status) || point.machineState !== previousState || point.status !== previousStatus;
      previousState = point.machineState;
      previousStatus = point.status;
      if (mustKeep) { flushBucket(); push(point); trim(points, safeLimit); return; }
      if (!bucket) bucket = { first: point, last: point, min: point, max: point };
      bucket.last = point;
      if (Number.isFinite(point.actual) && point.actual < bucket.min.actual) bucket.min = point;
      if (Number.isFinite(point.actual) && point.actual > bucket.max.actual) bucket.max = point;
      if (rawPointCount % Math.max(1, Math.floor(rawPointCount / safeLimit)) === 0) { flushBucket(); trim(points, safeLimit); }
    },
    finish() {
      flushBucket();
      trim(points, safeLimit);
      return { chartPoints: points.sort((a, b) => a.t - b.t), rawPointCount, renderedPointCount: points.length, downsampled: rawPointCount > points.length };
    }
  };
}

function compactPoint(point) {
  return {
    t: point.timestampMs,
    actual: point.actual ?? point.numericValue,
    expected: point.expected ?? null,
    allowedLow: point.allowedLow ?? null,
    allowedHigh: point.allowedHigh ?? null,
    status: point.status || 'no_rule',
    machineState: point.machineState || null
  };
}

function trim(points, limit) {
  if (points.length <= limit) return;
  points.sort((a, b) => a.t - b.t);
  while (points.length > limit) {
    let removeIndex = 1;
    let bestGap = Infinity;
    for (let i = 1; i < points.length - 1; i += 1) {
      if (['warning', 'critical'].includes(points[i].status)) continue;
      const gap = points[i + 1].t - points[i - 1].t;
      if (gap < bestGap) { bestGap = gap; removeIndex = i; }
    }
    points.splice(removeIndex, 1);
  }
}

export function runV2Pipeline({ rows = [], rules = [], inputFiles = [], progress = () => {}, analysisId = `analysis-${Date.now()}`, startedAt = new Date().toISOString(), startedMs = Date.now(), chartLimit = MAX_CHART_POINTS_PER_SIGNAL } = {}) {
  const diagnostics = createDiagnostics();
  progress('index', 0, 'Creating stream buckets.', 0, rows.length);
  const rulesIndex = buildRulesIndex(rules);
  const streams = new Map();
  let firstTimestampMs = null;
  let lastTimestampMs = null;
  const statePoints = [];
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (!Number.isFinite(row.timestampMs) || !row.normalizedSignal) continue;
    firstTimestampMs = firstTimestampMs === null ? row.timestampMs : Math.min(firstTimestampMs, row.timestampMs);
    lastTimestampMs = lastTimestampMs === null ? row.timestampMs : Math.max(lastTimestampMs, row.timestampMs);
    if (row.machineState) statePoints.push(row);
    const key = `${row.sourceId}::${row.normalizedSignal}`;
    let stream = streams.get(key);
    if (!stream) {
      stream = createStream(row, streams.size + 1, chartLimit);
      streams.set(key, stream);
    }
    stream.points.push(row);
    updateStreamAggregates(stream, row);
    if (i % 5000 === 0) progress('index', i / Math.max(1, rows.length), 'Indexing signal rows.', i, rows.length);
  }
  for (const stream of streams.values()) stream.points.sort((a, b) => a.timestampMs - b.timestampMs);
  const selectedRange = { startTimestampMs: firstTimestampMs, endTimestampMs: lastTimestampMs };
  const stateTimeline = createStateTimeline(statePoints, selectedRange);
  const resolveState = createStateResolver(stateTimeline);
  progress('analyze', 0, 'Matching rules to streams.', 0, streams.size + rules.length);

  const matchedRules = new Set();
  const parameterSummaries = [];
  let processedStreams = 0;
  for (const stream of streams.values()) {
    const rule = findRuleForStream(rulesIndex, stream);
    if (rule) {
      matchedRules.add(rule.ruleId);
      stream.hasRule = true;
      stream.ruleId = rule.ruleId;
      stream.parameterId = rule.parameterId;
      stream.system = rule.system;
      const acc = createParameterAccumulator(rule, stream);
      for (const point of stream.points) {
        const resolved = resolveState(point.timestampMs);
        const state = { ...resolved, machineState: point.machineState || resolved.machineState, systemState: point.systemState || resolved.systemState };
        const comparison = comparePoint(rule, point, state);
        updateParameterAccumulator(acc, point, comparison);
        stream.sampler.add({ timestampMs: point.timestampMs, actual: point.numericValue, expected: comparison.expected, allowedLow: comparison.allowedLow, allowedHigh: comparison.allowedHigh, status: comparison.status, machineState: comparison.machineState });
      }
      const sampled = stream.sampler.finish();
      stream.chartPoints = sampled.chartPoints;
      stream.rawPointCount = sampled.rawPointCount;
      stream.renderedPointCount = sampled.renderedPointCount;
      stream.downsampled = sampled.downsampled;
      parameterSummaries.push(finalizeParameterAccumulator(acc, sampled));
    } else {
      for (const point of stream.points) stream.sampler.add({ timestampMs: point.timestampMs, actual: point.numericValue, status: 'no_rule', machineState: point.machineState });
      const sampled = stream.sampler.finish();
      stream.chartPoints = sampled.chartPoints;
      stream.rawPointCount = sampled.rawPointCount;
      stream.renderedPointCount = sampled.renderedPointCount;
      stream.downsampled = sampled.downsampled;
    }
    stream.points = null;
    processedStreams += 1;
    progress('analyze', processedStreams / Math.max(1, streams.size), 'Evaluating streams.', processedStreams, streams.size);
  }

  for (const rule of rules) {
    if (matchedRules.has(rule.ruleId)) continue;
    const summary = finalizeParameterAccumulator(createParameterAccumulator(rule), { noData: true, rawPointCount: 0, renderedPointCount: 0, downsampled: false });
    parameterSummaries.push(summary);
  }
  progress('finalize', 0.2, 'Building signal catalog.', 1, 5);
  const signalCatalog = Array.from(streams.values()).map(streamToCatalogEntry);
  const systems = buildServiceDecision({ parameterSummaries, signalCatalog });
  progress('finalize', 0.55, 'Summarizing systems.', 3, 5);
  const completedAt = new Date().toISOString();
  const result = {
    schemaVersion: '2.0',
    metadata: {
      analysisId,
      startedAt,
      completedAt,
      durationMs: Date.now() - startedMs,
      selectedRange,
      inputFiles,
      filesProcessed: inputFiles.length,
      rowsProcessed: rows.length
    },
    summary: summarize(signalCatalog, parameterSummaries, rules),
    signalCatalog,
    parameterSummaries,
    systems,
    stateTimeline,
    diagnostics
  };
  progress('finalize', 0.9, 'Checking V2 result invariants.', 4, 5);
  assertV2Invariants(result, chartLimit);
  progress('finalize', 1, 'Final V2 payload is ready.', 5, 5);
  return result;
}

function createStream(row, index, chartLimit) {
  return {
    signalId: `signal-${index}`,
    signalName: row.signalName,
    normalizedSignal: row.normalizedSignal,
    sourceName: row.sourceName,
    sourceId: row.sourceId,
    system: 'Unassigned',
    unit: row.unit || null,
    sampleCount: 0,
    validNumericCount: 0,
    firstTimestampMs: null,
    lastTimestampMs: null,
    minimum: null,
    maximum: null,
    sum: 0,
    latestValue: null,
    latestTimestampMs: null,
    hasRule: false,
    ruleId: null,
    parameterId: null,
    points: [],
    sampler: createChartSampler(chartLimit),
    chartPoints: []
  };
}

function updateStreamAggregates(stream, row) {
  stream.sampleCount += 1;
  stream.firstTimestampMs = stream.firstTimestampMs === null ? row.timestampMs : Math.min(stream.firstTimestampMs, row.timestampMs);
  stream.lastTimestampMs = stream.lastTimestampMs === null ? row.timestampMs : Math.max(stream.lastTimestampMs, row.timestampMs);
  if (Number.isFinite(row.numericValue)) {
    stream.validNumericCount += 1;
    stream.sum += row.numericValue;
    stream.minimum = stream.minimum === null ? row.numericValue : Math.min(stream.minimum, row.numericValue);
    stream.maximum = stream.maximum === null ? row.numericValue : Math.max(stream.maximum, row.numericValue);
    stream.latestValue = row.numericValue;
    stream.latestTimestampMs = row.timestampMs;
  }
  if (!stream.unit && row.unit) stream.unit = row.unit;
}

function streamToCatalogEntry(stream) {
  return {
    signalId: stream.signalId,
    signalName: stream.signalName,
    normalizedSignal: stream.normalizedSignal,
    sourceName: stream.sourceName,
    system: stream.system,
    unit: stream.unit,
    hasRule: stream.hasRule,
    parameterId: stream.parameterId,
    status: stream.hasRule ? 'configured' : 'no_rule',
    sampleCount: stream.sampleCount,
    firstTimestampMs: stream.firstTimestampMs,
    lastTimestampMs: stream.lastTimestampMs,
    latestValue: stream.latestValue,
    average: stream.validNumericCount ? stream.sum / stream.validNumericCount : null,
    minimum: stream.minimum,
    maximum: stream.maximum,
    chartPoints: stream.chartPoints,
    rawPointCount: stream.rawPointCount,
    renderedPointCount: stream.renderedPointCount,
    downsampled: stream.downsampled
  };
}

function summarize(signalCatalog, parameterSummaries, rules) {
  return {
    discoveredSignals: signalCatalog.length,
    configuredSignals: rules.length,
    evaluatedSignals: parameterSummaries.filter(p => ['ok', 'warning', 'critical'].includes(p.status)).length,
    noRuleSignals: signalCatalog.filter(signal => !signal.hasRule).length,
    noDataRules: parameterSummaries.filter(p => p.status === 'no_data').length,
    configurationIssues: parameterSummaries.filter(p => p.status === 'needs_configuration').length,
    validationIssues: parameterSummaries.filter(p => p.status === 'needs_validation').length,
    warningParameters: parameterSummaries.filter(p => p.status === 'warning').length,
    criticalParameters: parameterSummaries.filter(p => p.status === 'critical').length,
    okParameters: parameterSummaries.filter(p => p.status === 'ok').length
  };
}

export function assertV2Invariants(result, chartLimit = MAX_CHART_POINTS_PER_SIGNAL) {
  if (result.schemaVersion !== '2.0') throw new Error('Invalid V2 schema version.');
  const seenParams = new Set();
  for (const parameter of result.parameterSummaries) {
    if (seenParams.has(parameter.parameterId)) throw new Error(`Duplicate parameter summary ${parameter.parameterId}.`);
    seenParams.add(parameter.parameterId);
    if ('chartPoints' in parameter) throw new Error('Parameter summary must not duplicate chartPoints.');
  }
  for (const signal of result.signalCatalog) {
    if ((signal.chartPoints || []).length > chartLimit) throw new Error(`Chart limit exceeded for ${signal.signalId}.`);
  }
  for (const system of result.systems) {
    if ('parameters' in system || 'chartPoints' in system || 'stateMatrix' in system) throw new Error('System summary is not lightweight.');
  }
  if (result.diagnostics.recentEntries.length > MAX_DIAGNOSTIC_ENTRIES) throw new Error('Diagnostics are not bounded.');
}
