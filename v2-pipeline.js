import { MAX_CHART_POINTS_PER_SIGNAL, MAX_DIAGNOSTIC_ENTRIES, MAX_DIAGNOSTIC_MESSAGE_LENGTH } from './config.js';
import { createMachineStateTimelines, createStateResolver, resolveTimeline } from './machine-states.js';
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
  const safeLimit = Math.max(10, Math.min(MAX_CHART_POINTS_PER_SIGNAL, Number(limit) || MAX_CHART_POINTS_PER_SIGNAL));
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
    machineState: point.machineState || null,
    systemState: point.systemState || null,
    stateSource: point.stateSource || null,
    stateStatus: point.stateStatus || null
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
  const machineStateUpdates = [];
  const systemStateUpdates = [];
  let unsupportedRows = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (!Number.isFinite(row.timestampMs)) continue;
    firstTimestampMs = firstTimestampMs === null ? row.timestampMs : Math.min(firstTimestampMs, row.timestampMs);
    lastTimestampMs = lastTimestampMs === null ? row.timestampMs : Math.max(lastTimestampMs, row.timestampMs);
    if (row.kind === 'state_update') {
      if (row.scope === 'machine') machineStateUpdates.push(row);
      if (row.scope === 'system') systemStateUpdates.push(row);
      continue;
    }
    if (row.kind && row.kind !== 'sample') { unsupportedRows += 1; continue; }
    if (!row.normalizedSignal || !Number.isFinite(row.numericValue)) { unsupportedRows += 1; continue; }
    const key = streamKey(row);
    let stream = streams.get(key);
    if (!stream) {
      stream = createStream(row, streams.size + 1, Math.min(chartLimit, 1000));
      const rule = findRuleForStream(rulesIndex, stream);
      if (rule) attachRuleToStream(stream, rule);
      streams.set(key, stream);
    }
    updateStreamAggregates(stream, row);
    if (i % 5000 === 0) progress('index', i / Math.max(1, rows.length), 'Indexing signal rows.', i, rows.length);
  }
  if (!streams.size) {
    const error = new Error('NO_NUMERIC_SIGNALS_FOUND: No numeric BSS, FEC, MachineStates-adjacent, or generic signal samples were found.');
    error.code = 'NO_NUMERIC_SIGNALS_FOUND';
    error.stage = 'parse';
    error.diagnostics = { rowsProcessed: rows.length, stateUpdates: machineStateUpdates.length + systemStateUpdates.length, unsupportedRows: Math.max(0, rows.length - machineStateUpdates.length - systemStateUpdates.length) };
    addDiagnostic(diagnostics, 'error', error.message, error.diagnostics);
    throw error;
  }
  const selectedRange = { startTimestampMs: firstTimestampMs, endTimestampMs: lastTimestampMs };
  const stateTimelines = createMachineStateTimelines([...machineStateUpdates, ...systemStateUpdates], selectedRange);
  const machineStateTimeline = stateTimelines.machineTimeline;
  const stateTimeline = machineStateTimeline.map(item => ({ ...item }));
  const resolveMachineState = createStateResolver(machineStateTimeline);
  const systemStateTimelineBySystem = stateTimelines.systemTimelinesBySystem;
  progress('analyze', 0, 'Matching rules to streams.', 0, streams.size + rules.length);

  const matchedRules = new Set();
  for (const stream of streams.values()) {
    if (stream.rule) matchedRules.add(stream.rule.ruleId);
  }

  let processedRows = 0;
  for (const row of rows) {
    if (!Number.isFinite(row.timestampMs) || (row.kind && row.kind !== 'sample') || !row.normalizedSignal || !Number.isFinite(row.numericValue)) continue;
    const stream = streams.get(streamKey(row));
    if (!stream) continue;
    const aligned = alignSampleState(row, stream, resolveMachineState, systemStateTimelineBySystem);
    if (stream.rule && stream.accumulator) {
      const comparison = comparePoint(stream.rule, { ...row, machineState: aligned.machineState, systemState: aligned.systemState }, aligned);
      updateParameterAccumulator(stream.accumulator, { ...row, machineState: aligned.machineState, systemState: aligned.systemState }, comparison);
      stream.sampler.add({ timestampMs: row.timestampMs, actual: row.numericValue, expected: comparison.expected, allowedLow: comparison.allowedLow, allowedHigh: comparison.allowedHigh, status: comparison.status, machineState: comparison.machineState, systemState: comparison.systemState, stateSource: aligned.stateSource, stateStatus: aligned.stateStatus });
      stream.statusCounts[comparison.status] = (stream.statusCounts[comparison.status] || 0) + 1;
    } else {
      stream.sampler.add({ timestampMs: row.timestampMs, actual: row.numericValue, status: 'no_rule', machineState: aligned.machineState, systemState: aligned.systemState, stateSource: aligned.stateSource, stateStatus: aligned.stateStatus });
    }
    stream.stateSource = aligned.stateSource;
    stream.stateConflict = stream.stateConflict || aligned.stateConflict;
    processedRows += 1;
    if (processedRows % 5000 === 0) progress('analyze', processedRows / Math.max(1, rows.length), 'Evaluating streams.', processedRows, rows.length);
  }

  const parameterSummaries = [];
  let processedStreams = 0;
  for (const stream of streams.values()) {
    const sampled = stream.sampler.finish();
    stream.chartPoints = sampled.chartPoints;
    stream.rawPointCount = sampled.rawPointCount;
    stream.renderedPointCount = sampled.renderedPointCount;
    stream.downsampled = sampled.downsampled;
    if (stream.accumulator) parameterSummaries.push(finalizeParameterAccumulator(stream.accumulator, sampled));
    stream.sampler = null;
    stream.accumulator = null;
    stream.rule = null;
    processedStreams += 1;
    progress('analyze', processedStreams / Math.max(1, streams.size), 'Finalizing streams.', processedStreams, streams.size);
  }

  for (const rule of rules) {
    if (matchedRules.has(rule.ruleId)) continue;
    const summary = finalizeParameterAccumulator(createParameterAccumulator(rule), { noData: true, rawPointCount: 0, renderedPointCount: 0, downsampled: false });
    parameterSummaries.push(summary);
  }
  progress('finalize', 0.2, 'Building signal catalog.', 1, 5);
  const signalCatalog = Array.from(streams.values()).map(streamToCatalogEntry);
  const signalHierarchy = buildSignalHierarchy(signalCatalog);
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
      rowsProcessed: rows.length,
      numericSamplesFound: Array.from(streams.values()).reduce((sum, stream) => sum + stream.sampleCount, 0),
      stateUpdatesFound: machineStateUpdates.length + systemStateUpdates.length,
      unsupportedRows
    },
    summary: summarize(signalCatalog, parameterSummaries, rules),
    signalCatalog,
    signalHierarchy,
    parameterSummaries,
    systems,
    stateTimeline,
    machineStateTimeline,
    systemStateTimelineBySystem,
    diagnostics
  };
  progress('finalize', 0.9, 'Checking V2 result invariants.', 4, 5);
  assertV2Invariants(result, chartLimit);
  progress('finalize', 1, 'Final V2 payload is ready.', 5, 5);
  return result;
}

function streamKey(row) {
  return `${row.sourceId || row.sourceName}::${row.subsystem || ''}::${row.deviceGroup || row.component || ''}::${row.normalizedSignal}`;
}

function attachRuleToStream(stream, rule) {
  stream.hasRule = true;
  stream.ruleId = rule.ruleId;
  stream.parameterId = rule.parameterId;
  stream.system = rule.system || stream.subsystem;
  stream.rule = rule;
  stream.accumulator = createParameterAccumulator(rule, stream);
}

function alignSampleState(row, stream, resolveMachineState, systemStateTimelineBySystem) {
  const machine = row.machineState ? { machineState: row.machineState, status: 'exact' } : resolveMachineState(row.timestampMs);
  const candidates = relevantStateSystems(stream);
  let chosen = null;
  let alternate = null;
  for (const system of candidates) {
    const resolved = resolveTimeline(systemStateTimelineBySystem[system] || [], row.timestampMs);
    if (resolved.state && ['matched', 'previous_state'].includes(resolved.status)) {
      if (!chosen) chosen = { system, ...resolved };
      else if (!alternate) alternate = { system, ...resolved };
    }
  }
  const rowSystemState = row.systemState || null;
  const systemState = rowSystemState || chosen?.state || null;
  const conflict = rowSystemState && chosen?.state && rowSystemState !== chosen.state ? { status: 'conflict', primary: rowSystemState, alternate: chosen.state, source: chosen.system } : null;
  return {
    machineState: machine.machineState || machine.state || null,
    systemState,
    status: machine.status || 'missing',
    stateSource: rowSystemState ? 'row' : chosen ? chosen.system : machine.stateSource || null,
    stateStatus: chosen?.status || machine.status || 'missing',
    alternateSystemState: alternate?.state || null,
    stateConflict: conflict
  };
}

function relevantStateSystems(stream) {
  if (stream.subsystem === 'BSS') return ['BSS'];
  if (stream.subsystem === 'IPU') return ['IPU'];
  if (stream.subsystem === 'IRD') return ['IRD', 'Dryer'];
  if (stream.subsystem === 'CWS') return ['CWS'];
  if (stream.subsystem === 'Ventilation') return ['Ventilation'];
  return [stream.subsystem, stream.system].filter(Boolean);
}

function createStream(row, index, chartLimit) {
  return {
    signalId: `signal-${index}`,
    signalName: row.signalName,
    normalizedSignal: row.normalizedSignal,
    sourceName: row.sourceName,
    sourceType: row.sourceType || 'generic',
    sourceId: row.sourceId,
    subsystem: row.subsystem || 'Generic',
    component: row.component || 'Unclassified',
    deviceGroup: row.deviceGroup || row.component || 'Unclassified',
    signalSourceId: row.signalId || null,
    system: row.subsystem || 'Generic',
    unit: row.unit || null,
    dataType: row.metadata?.type || row.metadata?.valueType || 'numeric',
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
    stateSource: null,
    stateConflict: null,
    statusCounts: {},
    sampler: createChartSampler(chartLimit)
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
    sourceType: stream.sourceType,
    system: stream.system,
    subsystem: stream.subsystem,
    component: stream.component,
    deviceGroup: stream.deviceGroup,
    unit: stream.unit,
    hasRule: stream.hasRule,
    parameterId: stream.parameterId,
    status: deriveStreamStatus(stream),
    dataType: stream.dataType,
    statusCounts: stream.statusCounts,
    stateSource: stream.stateSource,
    stateConflict: stream.stateConflict,
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

function deriveStreamStatus(stream) {
  if (!stream.hasRule) return 'no_rule';
  const counts = stream.statusCounts || {};
  if (counts.critical) return 'critical';
  if (counts.warning) return 'warning';
  if (counts.ok) return 'ok';
  if (counts.needs_validation) return 'needs_validation';
  if (counts.needs_configuration) return 'needs_configuration';
  return 'configured';
}

export function buildSignalHierarchy(signalCatalog = []) {
  const systems = new Map();
  for (const signal of signalCatalog) {
    const systemName = signal.subsystem || signal.system || 'Unclassified';
    const componentName = signal.deviceGroup || signal.component || 'Unclassified';
    if (!systems.has(systemName)) systems.set(systemName, createHierarchySystem(systemName));
    const system = systems.get(systemName);
    system.sampleCount += signal.sampleCount || 0;
    system.signalCount += 1;
    if (signal.hasRule) system.configuredCount += 1;
    system.statusCounts[signal.status] = (system.statusCounts[signal.status] || 0) + 1;
    if (!system._components.has(componentName)) system._components.set(componentName, createHierarchyComponent(systemName, componentName, signal.component));
    const component = system._components.get(componentName);
    component.signalCount += 1;
    component.signals.push(stripChartPoints(signal));
  }
  return Array.from(systems.values()).map(system => {
    system.components = Array.from(system._components.values()).map(component => ({ ...component, signals: component.signals.sort((a, b) => a.signalName.localeCompare(b.signalName)) })).sort((a, b) => a.componentName.localeCompare(b.componentName));
    delete system._components;
    return system;
  }).sort((a, b) => a.systemName.localeCompare(b.systemName));
}

function createHierarchySystem(systemName) {
  return { systemId: systemName.toLowerCase().replace(/[^a-z0-9]+/g, '_') || 'unclassified', systemName, sampleCount: 0, signalCount: 0, configuredCount: 0, statusCounts: {}, components: [], _components: new Map() };
}

function createHierarchyComponent(systemName, componentName, sourceComponent) {
  return { componentId: `${systemName}::${componentName}`.toLowerCase().replace(/[^a-z0-9]+/g, '_'), componentName, deviceGroup: componentName, sourceComponent: sourceComponent || componentName, signalCount: 0, signals: [] };
}

function stripChartPoints(signal) {
  const { chartPoints, statusCounts, stateConflict, ...rest } = signal;
  return { ...rest, statusCounts: { ...(statusCounts || {}) }, stateConflict: stateConflict ? { ...stateConflict } : null };
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
