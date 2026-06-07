import JSZip from 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm';
import * as XLSX from 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm';
import Papa from 'https://cdn.jsdelivr.net/npm/papaparse@5.4.1/+esm';
import { ADAPTERS, getAdapter, matchRuleForRow } from './adapters.js';
import { APP_STAGES, MAX_CHART_POINTS_PER_RULE, MAX_DEVIATION_EVENTS_PER_RULE, MAX_EVIDENCE_PREVIEW_PER_RULE, MIN_DEVIATION_GAP_MS, REQUIRED_SOURCE_PATHS, STATUS_PRIORITY, SYSTEMS } from './config.js';
import { createStateIndex } from './machine-states.js';
import { buildAnalysisPlan, parseRulesWorkbook, serializePlan } from './rules.js';
import { computeAllowedRange, evaluateValue, formatRange, normalizeText } from './evaluation.js';

let cancelled = false;
let startedAt = 0;
let analysisAudit = null;
let diagnostics = null;
let progressState = null;

self.onmessage = async event => {
  if (event.data?.type === 'cancel') { cancelled = true; return; }
  if (event.data?.type !== 'start') return;
  cancelled = false;
  startedAt = performance.now();
  analysisAudit = createAudit();
  diagnostics = createDiagnostics();
  progressState = { filesCompleted: 0, filesTotal: 0, currentSource: '', currentFile: '', relevantValuesFound: 0, signalsMatched: new Set() };
  try {
    const analysisResult = await runAnalysis(event.data.autocollectFile, event.data.rulesFile);
    postMessage({ type: 'complete', analysisResult });
  } catch (error) {
    postMessage({ type: 'error', message: error?.message || String(error), diagnosticsSummary: diagnostics, analysisAudit });
  }
};

function createAudit() {
  return {
    rulesFileLoaded: false, rulesSheetFound: false, rulesHeaderRow: null, rulesParsed: 0, validRules: 0, invalidRules: 0,
    opcZipFound: false, requiredSources: [], sourceFilesFound: {}, sourceFilesParsed: {}, rowsScanned: {}, relevantRowsMatched: {}, matchedSignals: {}, missingSignals: {},
    machineStateRows: 0, machineStateTransitions: 0, classifiedPoints: 0, fullyEvaluatedPoints: 0, blockedPoints: 0, evaluatedPoints: 0, deviationEvents: 0, systemsEvaluated: 0, resultCommitted: false, resultSchemaValid: false
  };
}

function createDiagnostics() {
  return { analysisAudit, reasons: [], parserWarnings: [], parserErrors: [], invalidTimestamps: {}, firstInvalidTimestamp: {}, timestampParsing: {}, sourceStats: {}, matchedValues: 0, analysisPlan: {}, archiveIndex: {}, rules: [], ruleCoverage: [], sourceTimeRangeByAdapter: {}, machineStatesTimeRange: { firstTimestampMs: null, lastTimestampMs: null }, dataTimeRanges: {}, overlapByAdapter: {}, evaluationBlockers: { totals: {}, bySystem: {}, byRule: {}, topBlocker: null } };
}

function assertNotCancelled() { if (cancelled) throw new Error('Analysis cancelled'); }
function tick() { return new Promise(resolve => setTimeout(resolve, 0)); }

function setStage(stage, fraction, message, details = {}) {
  const elapsedMs = performance.now() - startedAt;
  let pct = 0;
  for (const [key, , weight] of APP_STAGES) {
    if (key === stage) { pct += weight * Math.max(0, Math.min(1, fraction)); break; }
    pct += weight;
  }
  const percent = Math.min(99, Math.round(pct));
  const remainingMs = percent ? Math.max(0, elapsedMs * (100 - percent) / percent) : null;
  postMessage({ type: 'progress', progress: { stage, percent, message, elapsedMs, remainingMs, ...serializeProgress(), ...details } });
}

function serializeProgress() {
  return { ...progressState, signalsMatched: progressState.signalsMatched.size, warnings: diagnostics.parserWarnings.length, errors: diagnostics.parserErrors.length };
}

async function runAnalysis(autocollectFile, rulesFile) {
  if (!autocollectFile || !rulesFile) throw new Error('Autocollect ZIP and Rules Excel are required.');
  setStage('rules_loading', 0.2, 'Parsing Rules Excel header and rows');
  const rules = parseRulesWorkbook(XLSX, await rulesFile.arrayBuffer(), analysisAudit);
  diagnostics.rules = rules.map(rule => ({ row: rule.row, system: rule.system, signal: rule.signal, source: rule.logSource, validity: rule.validity, invalidReason: rule.invalidReason }));
  const plan = buildAnalysisPlan(rules);
  diagnostics.analysisPlan = serializePlan(plan);
  analysisAudit.requiredSources = [...plan.adaptersRequired];
  setStage('rules_loading', 1, 'Rules parsed', { rulesTotal: rules.length, rulesValid: plan.validRules.length });
  if (!analysisAudit.validRules) throw new Error('Rules were loaded, but no valid rules were found. Open Diagnostics for invalid rule reasons.');
  assertNotCancelled();

  setStage('archive_validation', 0.3, 'Opening root ZIP');
  const rootZip = await JSZip.loadAsync(autocollectFile);
  setStage('archive_validation', 1, 'Root ZIP opened');

  setStage('opc_indexing', 0.2, 'Finding opc.zip and indexing required paths');
  const archiveIndex = await indexRootArchive(rootZip, plan);
  diagnostics.archiveIndex = summarizeArchiveIndex(archiveIndex);
  progressState.filesTotal = archiveIndex.machineStateFiles.length + Object.values(archiveIndex.sourceFilesByAdapter).flat().length;
  setStage('opc_indexing', 1, 'opc.zip indexed');
  setStage('source_discovery', 1, 'Required source files discovered');

  const stateIndex = createStateIndex();
  await parseMachineStates(archiveIndex.machineStateFiles, stateIndex, plan);
  stateIndex.finalize();
  analysisAudit.machineStateTransitions = Object.values(stateIndex.series).reduce((sum, rows) => sum + rows.length, 0);

  const runtimes = new Map(plan.validRules.map(rule => [rule.id, createRuntime(rule)]));
  await parseRequiredSources(archiveIndex.sourceFilesByAdapter, plan, stateIndex, runtimes);

  setStage('evaluation', 0.8, 'Closing consolidated deviation events');
  for (const runtime of runtimes.values()) closeDeviation(runtime);
  analysisAudit.deviationEvents = [...runtimes.values()].reduce((sum, runtime) => sum + runtime.deviationEvents.length, 0);
  setStage('evaluation', 1, 'Evaluation complete');

  setStage('timeline_finalization', 0.5, 'Building compact charts and timelines');
  const result = finalizeResult(rules, plan, stateIndex, runtimes);
  setStage('timeline_finalization', 1, 'Charts and timelines finalized');

  setStage('result_validation', 0.4, 'Validating AnalysisResult schema and data path');
  const validation = validateAnalysisResult(result);
  analysisAudit.resultSchemaValid = validation.valid;
  result.diagnosticsSummary.validation = validation;
  if (!validation.valid) throw new Error(validation.reason);
  analysisAudit.resultCommitted = true;
  setStage('result_validation', 1, 'AnalysisResult valid');
  return result;
}

async function indexRootArchive(rootZip, plan) {
  const opcEntry = Object.values(rootZip.files).find(file => !file.dir && /(^|\/)opc\.zip$/i.test(file.name));
  if (!opcEntry) throw new Error('opc.zip was not found in the root autocollect ZIP.');
  analysisAudit.opcZipFound = true;
  const opcZip = await JSZip.loadAsync(await opcEntry.async('arraybuffer'));
  const index = { machineStateFiles: [], sourceFilesByAdapter: Object.fromEntries([...plan.adaptersRequired].map(source => [source, []])), nestedArchivesOpened: 0, skippedFiles: [] };
  for (const file of Object.values(opcZip.files)) {
    if (file.dir) continue;
    const path = file.name.replace(/\\/g, '/');
    const adapter = [...plan.adaptersRequired].map(getAdapter).find(item => item?.canHandlePath(path));
    if (ADAPTERS.MachineStates.canHandlePath(path)) addIndexed(index.machineStateFiles, file, path, 'MachineStates');
    else if (adapter) addIndexed(index.sourceFilesByAdapter[adapter.sourceType], file, path, adapter.sourceType);
    else {
      const containerAdapter = [...plan.adaptersRequired].map(getAdapter).find(item => item?.canHandleContainerPath(path));
      if (containerAdapter && /\.zip$/i.test(path)) await openNestedSourceZip(index, file, path, containerAdapter);
      else if (isKnownSourcePath(path)) index.skippedFiles.push(path);
    }
  }
  if (plan.stateContextRequired && !index.machineStateFiles.length) diagnostics.reasons.push('State-dependent rules exist, but no MachineStates files were found.');
  for (const source of plan.adaptersRequired) {
    const files = index.sourceFilesByAdapter[source] || [];
    analysisAudit.sourceFilesFound[source] = files.length;
    if (!files.length) diagnostics.reasons.push(`Rules loaded, but no ${source} files were found in required paths.`);
  }
  return index;
}

function addIndexed(list, entry, path, sourceType) {
  list.push({ entry, path, sourceType, size: entry._data?.uncompressedSize || 0 });
}

function isKnownSourcePath(path) {
  return Object.values(REQUIRED_SOURCE_PATHS).flat().some(prefix => path.toLowerCase().includes(prefix.toLowerCase().replace('.txt', '')));
}

async function openNestedSourceZip(index, zipEntry, zipPath, adapter) {
  index.nestedArchivesOpened += 1;
  const nested = await JSZip.loadAsync(await zipEntry.async('arraybuffer'));
  for (const file of Object.values(nested.files)) {
    if (file.dir || !adapter.canHandlePath(`${zipPath}!/${file.name}`)) continue;
    addIndexed(index.sourceFilesByAdapter[adapter.sourceType], file, `${zipPath}!/${file.name}`, adapter.sourceType);
  }
}

function summarizeArchiveIndex(index) {
  return { machineStateFiles: index.machineStateFiles.map(file => file.path), sourceFilesByAdapter: Object.fromEntries(Object.entries(index.sourceFilesByAdapter).map(([key, rows]) => [key, rows.map(row => row.path)])), nestedArchivesOpened: index.nestedArchivesOpened, skippedFiles: index.skippedFiles.slice(0, 100) };
}

async function parseMachineStates(files, stateIndex, plan) {
  if (!plan.stateContextRequired && !files.length) return;
  setStage('machine_states', 0.05, 'Parsing MachineStates', { filesTotal: progressState.filesTotal });
  for (let i = 0; i < files.length; i += 1) {
    assertNotCancelled();
    const file = files[i];
    progressState.currentSource = 'MachineStates';
    progressState.currentFile = file.path;
    setStage('machine_states', files.length ? i / files.length : 1, `Parsing ${file.path}`);
    await parseCsvFile(file, ADAPTERS.MachineStates, (row, rowNo) => {
      analysisAudit.machineStateRows += 1;
      const timestampMs = ADAPTERS.MachineStates.getTimestampMs(row);
      if (!timestampMs) return recordInvalidTimestamp('MachineStates', file.path, row.Timestamp || row.Time || row.DateTime, rowNo);
      noteMachineStateTimestamp(timestampMs);
      stateIndex.addRow(timestampMs, row);
    });
    progressState.filesCompleted += 1;
    await tick();
  }
  setStage('machine_states', 1, 'MachineStates parsed');
}

async function parseRequiredSources(filesByAdapter, plan, stateIndex, runtimes) {
  const entries = Object.entries(filesByAdapter).flatMap(([sourceType, files]) => files.map(file => ({ ...file, sourceType })));
  let done = 0;
  for (const sourceFile of entries) {
    assertNotCancelled();
    const adapter = getAdapter(sourceFile.sourceType);
    const rules = plan.rulesBySource.get(sourceFile.sourceType) || [];
    progressState.currentSource = sourceFile.sourceType;
    progressState.currentFile = sourceFile.path;
    setStage('source_parsing', entries.length ? done / entries.length : 1, `Parsing required source ${sourceFile.path}`);
    await parseCsvFile(sourceFile, adapter, (row, rowNo) => {
      increment(analysisAudit.rowsScanned, sourceFile.sourceType);
      sourceStats(sourceFile.sourceType).scannedRows += 1;
      const matches = matchRuleForRow(adapter, row, rules);
      if (!matches.length) return;
      increment(analysisAudit.relevantRowsMatched, sourceFile.sourceType);
      diagnostics.matchedValues = (diagnostics.matchedValues || 0) + matches.length;
      progressState.relevantValuesFound += matches.length;
      for (const rule of matches) evaluateMatchedRow(rule, adapter, row, sourceFile, rowNo, stateIndex, runtimes.get(rule.id));
    });
    analysisAudit.sourceFilesParsed[sourceFile.sourceType] = (analysisAudit.sourceFilesParsed[sourceFile.sourceType] || 0) + 1;
    progressState.filesCompleted += 1;
    done += 1;
    await tick();
  }
  for (const [source, sourceRules] of plan.rulesBySource) {
    const matched = new Set([...runtimes.values()].filter(runtime => runtime.rule.sourceType === source && runtime.matchedRows > 0).map(runtime => runtime.rule.normSignal));
    analysisAudit.missingSignals[source] = sourceRules.filter(rule => !matched.has(rule.normSignal)).map(rule => ({ row: rule.row, signal: rule.signal }));
  }
  setStage('source_parsing', 1, 'Required log parsing complete');
}

async function parseCsvFile(file, adapter, onRow) {
  const text = adapter.cleanText(await file.entry.async('text'));
  const parsed = Papa.parse(text, { header: true, skipEmptyLines: true, dynamicTyping: false, transformHeader: adapter.normalizeHeader || (x => x) });
  if (parsed.errors?.length) diagnostics.parserWarnings.push(...parsed.errors.slice(0, 5).map(error => ({ file: file.path, message: error.message, row: error.row })));
  let rowNo = 1;
  for (const rawRow of parsed.data || []) onRow(adapter.normalizeRow ? adapter.normalizeRow(rawRow) : rawRow, rowNo++);
}

function createRuntime(rule) {
  return { rule, ruleId: rule.id, matchedRows: 0, numericRows: 0, invalidTimestampRows: 0, classifiedRows: 0, fullyEvaluatedRows: 0, needsValidationRows: 0, needsConfigurationRows: 0, classifiedPoints: 0, fullyEvaluatedPoints: 0, blockedPoints: 0, evaluatedCounts: {}, blockers: { invalid_timestamp: 0, no_numeric_value: 0, missing_state: 0, missing_expected_value: 0, missing_threshold_or_tolerance: 0, unsupported_evaluator: 0 }, firstRawTimestamp: '', firstTimestampMs: Infinity, lastTimestampMs: -Infinity, latestPoint: null, latestActual: null, minActual: Infinity, maxActual: -Infinity, sumActual: 0, samples: [], chartReservoir: [], evidence: [], evidenceSamples: [], stateCoverage: {}, activeDeviation: null, deviationEvents: [] };
}

function evaluateMatchedRow(rule, adapter, row, sourceFile, rowNo, stateIndex, runtime) {
  runtime.matchedRows += 1;
  progressState.signalsMatched.add(`${rule.system}::${rule.signal}`);
  if (!analysisAudit.matchedSignals[rule.sourceType]) analysisAudit.matchedSignals[rule.sourceType] = {};
  analysisAudit.matchedSignals[rule.sourceType][rule.signal] = (analysisAudit.matchedSignals[rule.sourceType][rule.signal] || 0) + 1;
  const stats = sourceStats(rule.sourceType);
  stats.matchedRows += 1;
  const rawTimestamp = row.Timestamp || row.Time || row.DateTime || '';
  if (!runtime.firstRawTimestamp) runtime.firstRawTimestamp = rawTimestamp;
  const actual = adapter.getNumericValue(row);
  if (actual !== null) { runtime.numericRows += 1; stats.numericRows += 1; }
  else stats.invalidValues += 1;
  if (rule.sourceType === 'BSSNotifications') {
    const action = normalizeText(row.Action).toLowerCase();
    if (action === 'get') stats.getRows += 1;
    else if (action === 'set') stats.setRows += 1;
  }
  const timestampMs = adapter.getTimestampMs(row);
  if (!timestampMs) {
    runtime.invalidTimestampRows += 1;
    stats.invalidTimestamps += 1;
    const result = { status: 'needs_validation', blocker: 'invalid_timestamp', reason: 'Invalid timestamp', expectedLow: null, expectedHigh: null };
    recordClassification(runtime, result);
    recordInvalidTimestamp(rule.sourceType, sourceFile.path, rawTimestamp, rowNo);
    const point = { t: null, rawTimestamp, actual, rawValue: row.Value ?? row.Actual ?? row.NumericValue ?? '', expectedLow: null, expectedHigh: null, status: result.status, blocker: result.blocker, reason: result.reason, machineState: null, systemState: null, stateContextStatus: 'missing', component: adapter.getComponent(row) || rule.component, subsystem: adapter.getSubsystem(row, rule), signal: rule.signal, source: sourceFile.sourceType, file: sourceFile.path, ruleRow: rule.row, row: rowNo, timestampStatus: 'invalid' };
    updateActualAggregates(runtime, actual);
    runtime.latestPoint = point;
    addSample(runtime.chartReservoir, point, MAX_CHART_POINTS_PER_RULE);
    addEvidence(runtime, point, rule, sourceFile, result);
    return;
  }
  noteSourceTimestamp(rule.sourceType, timestampMs);
  const stateContext = stateIndex.getStateAt(timestampMs, rule.system);
  const result = evaluateValue(rule, actual, stateContext);
  recordClassification(runtime, result);
  runtime.firstTimestampMs = Math.min(runtime.firstTimestampMs, timestampMs);
  runtime.lastTimestampMs = Math.max(runtime.lastTimestampMs, timestampMs);
  updateActualAggregates(runtime, actual);
  const point = { t: timestampMs, rawTimestamp, actual, rawValue: row.Value ?? row.Actual ?? row.NumericValue ?? '', expectedLow: result.expectedLow, expectedHigh: result.expectedHigh, status: result.status, blocker: result.blocker || null, reason: result.reason || '', machineState: stateContext.machineState, systemState: stateContext.systemState, stateContextStatus: stateContext.status, component: adapter.getComponent(row) || rule.component, subsystem: adapter.getSubsystem(row, rule), signal: rule.signal, source: sourceFile.sourceType, file: sourceFile.path, ruleRow: rule.row, row: rowNo, timestampStatus: 'valid' };
  runtime.latestPoint = point;
  count(runtime.stateCoverage, `${stateContext.machineState || 'unknown'} / ${stateContext.systemState || 'unknown'}`);
  addSample(runtime.chartReservoir, point, MAX_CHART_POINTS_PER_RULE);
  addEvidence(runtime, point, rule, sourceFile, result);
  updateDeviation(runtime, point, rule, result);
}

function updateActualAggregates(runtime, actual) {
  if (!Number.isFinite(actual)) return;
  runtime.latestActual = actual;
  runtime.minActual = Math.min(runtime.minActual, actual);
  runtime.maxActual = Math.max(runtime.maxActual, actual);
  runtime.sumActual += actual;
}

function recordClassification(runtime, result) {
  if (!result?.status) return;
  runtime.classifiedPoints += 1;
  runtime.classifiedRows = runtime.classifiedPoints;
  analysisAudit.classifiedPoints += 1;
  count(runtime.evaluatedCounts, result.status);
  if (['ok', 'warning', 'critical'].includes(result.status)) {
    runtime.fullyEvaluatedPoints += 1;
    runtime.fullyEvaluatedRows = runtime.fullyEvaluatedPoints;
    analysisAudit.fullyEvaluatedPoints += 1;
    analysisAudit.evaluatedPoints = analysisAudit.fullyEvaluatedPoints;
  }
  if (result.status === 'needs_validation') runtime.needsValidationRows += 1;
  if (result.status === 'needs_configuration') runtime.needsConfigurationRows += 1;
  if (['needs_validation', 'needs_configuration', 'evaluator_pending'].includes(result.status)) {
    runtime.blockedPoints += 1;
    analysisAudit.blockedPoints += 1;
  }
  if (result.blocker) count(runtime.blockers, result.blocker);
}

function updateDeviation(runtime, point, rule, result) {
  if (!['warning', 'critical'].includes(result.status)) { closeDeviation(runtime); return; }
  const expectedKey = `${result.expectedLow}|${result.expectedHigh}`;
  const active = runtime.activeDeviation;
  const gapOk = active && point.t - active.endTimestampMs <= Math.max(MIN_DEVIATION_GAP_MS, active.sampleGapMs || MIN_DEVIATION_GAP_MS);
  if (!active || active.severity !== result.status || active.expectedKey !== expectedKey || !gapOk) {
    closeDeviation(runtime);
    runtime.activeDeviation = { id: `D-${rule.id}-${runtime.deviationEvents.length + 1}`, system: rule.system, subsystem: rule.subsystem, component: point.component || rule.component, signal: rule.signal, severity: result.status, startTimestampMs: point.t, endTimestampMs: point.t, durationMs: 0, firstActual: point.actual, latestActual: point.actual, minActual: point.actual, maxActual: point.actual, expectedLow: result.expectedLow, expectedHigh: result.expectedHigh, maximumDeviation: Math.abs(result.deviation || 0), machineStatesSeen: new Set([point.machineState].filter(Boolean)), systemStatesSeen: new Set([point.systemState].filter(Boolean)), pointCount: 1, recommendedAction: result.status === 'critical' ? (rule.criticalAction || rule.recommendedAction || '') : (rule.warningAction || rule.recommendedAction || ''), ruleRow: rule.row, expectedKey, sampleGapMs: MIN_DEVIATION_GAP_MS };
    return;
  }
  active.sampleGapMs = Math.max(MIN_DEVIATION_GAP_MS, point.t - active.endTimestampMs);
  active.endTimestampMs = point.t;
  active.durationMs = active.endTimestampMs - active.startTimestampMs;
  active.latestActual = point.actual;
  active.minActual = Math.min(active.minActual, point.actual);
  active.maxActual = Math.max(active.maxActual, point.actual);
  active.maximumDeviation = Math.max(active.maximumDeviation, Math.abs(result.deviation || 0));
  active.pointCount += 1;
  if (point.machineState) active.machineStatesSeen.add(point.machineState);
  if (point.systemState) active.systemStatesSeen.add(point.systemState);
}

function closeDeviation(runtime) {
  if (!runtime.activeDeviation) return;
  if (runtime.deviationEvents.length < MAX_DEVIATION_EVENTS_PER_RULE) {
    const event = { ...runtime.activeDeviation, machineStatesSeen: [...runtime.activeDeviation.machineStatesSeen], systemStatesSeen: [...runtime.activeDeviation.systemStatesSeen] };
    delete event.expectedKey; delete event.sampleGapMs;
    runtime.deviationEvents.push(event);
  }
  runtime.activeDeviation = null;
}

function addSample(points, point, max) {
  if (points.length < max) points.push(point);
  else points[Math.floor(Math.random() * max)] = point;
}

function addEvidence(runtime, point, rule, file, result) {
  if (runtime.evidence.length >= MAX_EVIDENCE_PREVIEW_PER_RULE) return;
  runtime.evidence.push({ timestampMs: point.t, rawTimestamp: point.rawTimestamp || '', timestampStatus: point.timestampStatus || (Number.isFinite(point.t) ? 'valid' : 'invalid'), source: file.sourceType, file: file.path, row: point.row, ruleRow: rule.row, system: rule.system, subsystem: point.subsystem || rule.subsystem, component: point.component || rule.component, signal: rule.signal, actual: point.actual, rawValue: point.rawValue ?? '', expected: Number.isFinite(result.expectedLow) || Number.isFinite(result.expectedHigh) ? formatRange(result.expectedLow, result.expectedHigh) : 'Expected range unavailable', expectedLow: result.expectedLow, expectedHigh: result.expectedHigh, result: result.status, blocker: result.blocker || null, reason: result.reason, machineState: point.machineState, systemState: point.systemState });
}

function finalizeResult(rules, plan, stateIndex, runtimes) {
  const runtimeList = [...runtimes.values()];
  const deviationEvents = runtimeList.flatMap(runtime => runtime.deviationEvents).sort((a, b) => STATUS_PRIORITY[b.severity] - STATUS_PRIORITY[a.severity] || b.startTimestampMs - a.startTimestampMs);
  const signalSummaries = runtimeList.map(runtimeToSummary).sort((a, b) => STATUS_PRIORITY[b.status] - STATUS_PRIORITY[a.status] || a.system.localeCompare(b.system));
  const systems = [...new Set([...SYSTEMS, ...plan.systems])];
  const systemHealth = systems.map(system => systemHealthFor(system, plan, signalSummaries));
  analysisAudit.systemsEvaluated = systemHealth.filter(system => !['no_rule', 'no_data'].includes(system.status)).length;
  const timestamps = runtimeList.flatMap(runtime => [runtime.firstTimestampMs, runtime.lastTimestampMs]).filter(Number.isFinite);
  const startTimestampMs = timestamps.length ? Math.min(...timestamps) : null;
  const endTimestampMs = timestamps.length ? Math.max(...timestamps) : null;
  const evidence = runtimeList.flatMap(runtime => runtime.evidence).sort((a, b) => b.timestampMs - a.timestampMs).slice(0, 30);
  const chartSeries = Object.fromEntries(runtimeList.map(runtime => [runtime.ruleId, runtime.chartReservoir.sort((a, b) => a.t - b.t)]));
  diagnostics.evaluationBlockers = buildEvaluationBlockers(runtimeList);
  diagnostics.ruleCoverage = buildRuleCoverage(runtimeList);
  diagnostics.overlapByAdapter = buildOverlapDiagnostics();
  diagnostics.dataTimeRanges = buildDataTimeRanges();
  const result = {
    metadata: { createdAt: new Date().toISOString(), startTimestampMs, endTimestampMs, timeRange: startTimestampMs ? `${new Date(startTimestampMs).toLocaleString()} – ${new Date(endTimestampMs).toLocaleString()}` : 'No evaluated time range', rulesTotal: rules.length, rulesValid: plan.validRules.length, rulesEvaluated: runtimeList.filter(runtime => runtime.fullyEvaluatedPoints > 0).length, rulesMatched: runtimeList.filter(runtime => runtime.matchedRows > 0).length, rulesBlocked: runtimeList.filter(runtime => runtime.needsValidationRows > 0).length, rulesIncomplete: runtimeList.filter(runtime => runtime.needsConfigurationRows > 0).length, systemsWithRules: plan.systems.size, systemsEvaluated: analysisAudit.systemsEvaluated, relevantSignalsRequired: [...plan.requiredSignals.values()].reduce((sum, set) => sum + set.size, 0), relevantSignalsFound: new Set(runtimeList.filter(runtime => runtime.matchedRows).map(runtime => `${runtime.rule.system}::${runtime.rule.signal}`)).size, relevantValuesFound: progressState.relevantValuesFound, classifiedPoints: analysisAudit.classifiedPoints, fullyEvaluatedPoints: analysisAudit.fullyEvaluatedPoints, blockedPoints: analysisAudit.blockedPoints, needsValidationPoints: runtimeList.reduce((sum, runtime) => sum + runtime.needsValidationRows, 0), needsConfigurationPoints: runtimeList.reduce((sum, runtime) => sum + runtime.needsConfigurationRows, 0), evaluatedPoints: analysisAudit.fullyEvaluatedPoints, deviationsFound: deviationEvents.length, analysisTimeMs: Math.round(performance.now() - startedAt), blockingReason: blockingReason() },
    systemHealth,
    activeFindings: deviationEvents.slice(0, 10),
    deviationEvents,
    timelineRows: buildTimelineRows(systemHealth, deviationEvents),
    stateTimeline: buildStateTimeline(stateIndex.series.Machine || [], startTimestampMs, endTimestampMs),
    signalSummaries,
    chartSeries,
    evidence,
    diagnosticsSummary: { ...diagnostics, analysisAudit, analysisPlan: serializePlan(plan) }
  };
  return result;
}

function runtimeToSummary(runtime) {
  const status = highest(runtime.evaluatedCounts, runtime.matchedRows ? 'needs_validation' : 'no_data');
  const latest = runtime.latestPoint;
  const fallbackRange = computeAllowedRange(runtime.rule, runtime.rule.genericExpected) || {};
  return { ruleId: runtime.ruleId, ruleRow: runtime.rule.row, system: runtime.rule.system, subsystem: latest?.subsystem || runtime.rule.subsystem, component: latest?.component || runtime.rule.component, signal: runtime.rule.signal, status, blocker: topCount(runtime.blockers)?.key || null, blockerCounts: runtime.blockers, blockers: runtime.blockers, matchedRows: runtime.matchedRows, numericRows: runtime.numericRows, classifiedPoints: runtime.classifiedPoints, fullyEvaluatedPoints: runtime.fullyEvaluatedPoints, needsValidationRows: runtime.needsValidationRows, needsConfigurationRows: runtime.needsConfigurationRows, invalidTimestampRows: runtime.invalidTimestampRows, blockedPoints: runtime.blockedPoints, evaluatedCounts: runtime.evaluatedCounts, latestActual: latest?.actual ?? runtime.latestActual ?? null, firstRawTimestamp: runtime.firstRawTimestamp || '', rawTimestamp: latest?.rawTimestamp || '', timestampStatus: latest?.timestampStatus || null, expectedLow: latest?.expectedLow ?? fallbackRange.low ?? null, expectedHigh: latest?.expectedHigh ?? fallbackRange.high ?? null, currentMachineState: latest?.machineState || null, currentSystemState: latest?.systemState || null, stateContextStatus: latest?.stateContextStatus || null, latestReason: latest?.reason || null, sourceFile: latest?.file || null, eventCount: runtime.deviationEvents.length, totalDeviationDurationMs: runtime.deviationEvents.reduce((sum, event) => sum + event.durationMs, 0), minActual: Number.isFinite(runtime.minActual) ? runtime.minActual : null, maxActual: Number.isFinite(runtime.maxActual) ? runtime.maxActual : null, averageActual: runtime.numericRows ? runtime.sumActual / runtime.numericRows : null, recommendedAction: runtime.rule.recommendedAction || runtime.rule.warningAction || runtime.rule.criticalAction || '' };
}

function highest(counts, fallback) {
  return Object.keys(counts || {}).sort((a, b) => STATUS_PRIORITY[b] - STATUS_PRIORITY[a])[0] || fallback;
}

function systemHealthFor(system, plan, summaries) {
  if (!plan.rulesBySystem.has(system)) return { system, status: 'no_rule', rules: 0, evaluated: 0, deviations: 0, label: 'Rules not configured' };
  const rows = summaries.filter(summary => summary.system === system);
  const status = highest(Object.fromEntries(rows.map(row => [row.status, 1])), 'no_data');
  const blocker = topCount(rows.reduce((acc, row) => mergeCounts(acc, row.blockerCounts || row.blockers || {}), {}));
  return { system, status, rules: plan.rulesBySystem.get(system).length, evaluated: rows.reduce((sum, row) => sum + row.fullyEvaluatedPoints, 0), classifiedPoints: rows.reduce((sum, row) => sum + row.classifiedPoints, 0), blockedPoints: rows.reduce((sum, row) => sum + row.blockedPoints, 0), matchedRows: rows.reduce((sum, row) => sum + row.matchedRows, 0), deviations: rows.reduce((sum, row) => sum + row.eventCount, 0), latestSignal: rows[0]?.signal || null, blocker: blocker?.key || null, label: status === 'no_data' ? 'No matching source values' : STATUS_LABEL_SAFE(status) };
}

function buildStateTimeline(machineRows, start, end) {
  if (!Number.isFinite(start) || !Number.isFinite(end)) return [];
  return machineRows.map((row, idx) => ({ startMs: Math.max(start, row.timestampMs), endMs: idx < machineRows.length - 1 ? machineRows[idx + 1].timestampMs : end, label: row.value })).filter(row => row.endMs >= row.startMs);
}

function buildTimelineRows(systemHealth, events) {
  return systemHealth.map(health => ({ system: health.system, status: health.status, segments: events.filter(event => event.system === health.system).map(event => ({ startMs: event.startTimestampMs, endMs: event.endTimestampMs, status: event.severity, eventId: event.id, label: event.signal })) }));
}

function blockingReason() {
  if (!analysisAudit.rulesParsed) return 'No Rules Excel rows were parsed.';
  if (!analysisAudit.validRules) return 'Rules were parsed, but no valid rules were available.';
  const missingSource = analysisAudit.requiredSources.find(source => !analysisAudit.sourceFilesFound[source]);
  if (missingSource) return `Rules require ${missingSource}, but no matching files were found.`;
  if (!progressState.relevantValuesFound) return 'Required log files were parsed, but no rule signals matched.';
  if (!analysisAudit.classifiedPoints) return 'Matching source rows were found, but no evaluation classification was produced.';
  if (analysisAudit.blockedPoints > 0 && analysisAudit.fullyEvaluatedPoints === 0) return 'All matched values require validation. Open Service Radar to review the blockers.';
  return '';
}

export function validateAnalysisResult(result) {
  for (const key of ['metadata', 'systemHealth', 'signalSummaries', 'chartSeries', 'diagnosticsSummary']) {
    if (!result?.[key]) return { valid: false, reason: `AnalysisResult is missing ${key}.` };
  }
  if (!result.metadata.rulesValid) return { valid: false, reason: 'No valid rules are available for evaluation.' };
  if (!result.metadata.relevantValuesFound) return { valid: false, reason: result.metadata.blockingReason || 'No relevant source values were found.' };
  if (!result.metadata.classifiedPoints) return { valid: false, reason: result.metadata.blockingReason || 'Matching source rows were found, but no evaluation classification was produced.' };
  if (result.metadata.blockedPoints > 0) return { valid: true, status: 'completed_with_warnings', reason: 'Matching values were found, but some or all evaluations require validation.' };
  return { valid: true, status: 'completed', reason: '' };
}

function noteMachineStateTimestamp(timestampMs) {
  const section = diagnostics.timestampParsing.MachineStates || (diagnostics.timestampParsing.MachineStates = timestampParsingDefaults('MachineStates'));
  section.rowsParsed += 1;
  section.firstValidTimestampMs = section.firstValidTimestampMs === null ? timestampMs : Math.min(section.firstValidTimestampMs, timestampMs);
  section.lastValidTimestampMs = section.lastValidTimestampMs === null ? timestampMs : Math.max(section.lastValidTimestampMs, timestampMs);
  const range = diagnostics.machineStatesTimeRange;
  range.firstTimestampMs = range.firstTimestampMs === null ? timestampMs : Math.min(range.firstTimestampMs, timestampMs);
  range.lastTimestampMs = range.lastTimestampMs === null ? timestampMs : Math.max(range.lastTimestampMs, timestampMs);
}

function noteSourceTimestamp(source, timestampMs) {
  const section = diagnostics.timestampParsing[source] || (diagnostics.timestampParsing[source] = timestampParsingDefaults(source));
  section.rowsParsed += 1;
  section.firstValidTimestampMs = section.firstValidTimestampMs === null ? timestampMs : Math.min(section.firstValidTimestampMs, timestampMs);
  section.lastValidTimestampMs = section.lastValidTimestampMs === null ? timestampMs : Math.max(section.lastValidTimestampMs, timestampMs);
  const range = diagnostics.sourceTimeRangeByAdapter[source] || (diagnostics.sourceTimeRangeByAdapter[source] = { firstTimestampMs: null, lastTimestampMs: null });
  range.firstTimestampMs = range.firstTimestampMs === null ? timestampMs : Math.min(range.firstTimestampMs, timestampMs);
  range.lastTimestampMs = range.lastTimestampMs === null ? timestampMs : Math.max(range.lastTimestampMs, timestampMs);
}

function buildOverlapDiagnostics() {
  const machine = diagnostics.machineStatesTimeRange;
  const byAdapter = {};
  for (const [source, range] of Object.entries(diagnostics.sourceTimeRangeByAdapter)) {
    const overlaps = machine.firstTimestampMs !== null && range.firstTimestampMs !== null && range.firstTimestampMs <= machine.lastTimestampMs && machine.firstTimestampMs <= range.lastTimestampMs;
    byAdapter[source] = { firstTimestampMs: range.firstTimestampMs, lastTimestampMs: range.lastTimestampMs, machineStatesFirstTimestampMs: machine.firstTimestampMs, machineStatesLastTimestampMs: machine.lastTimestampMs, overlapsMachineStates: overlaps };
    if (['BSSNotifications', 'IPSNotifications', 'FECNotifications'].includes(source) && !overlaps) diagnostics.reasons.push(`${source}: Log values and MachineStates do not overlap in time.`);
  }
  return byAdapter;
}

function buildEvaluationBlockers(runtimes) {
  const totals = {};
  const bySystem = {};
  const byRule = {};
  for (const runtime of runtimes) {
    byRule[runtime.ruleId] = { ruleRow: runtime.rule.row, system: runtime.rule.system, signal: runtime.rule.signal, blockers: runtime.blockers };
    bySystem[runtime.rule.system] = bySystem[runtime.rule.system] || {};
    mergeCounts(bySystem[runtime.rule.system], runtime.blockers);
    mergeCounts(totals, runtime.blockers);
  }
  const top = topCount(totals);
  return { totals, bySystem, byRule, topBlocker: top ? { reason: top.key, count: top.value, label: blockerLabel(top.key) } : null };
}

function mergeCounts(target, source) {
  for (const [key, value] of Object.entries(source || {})) target[key] = (target[key] || 0) + (value || 0);
  return target;
}

function topCount(counts) {
  return Object.entries(counts || {}).filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1]).map(([key, value]) => ({ key, value }))[0] || null;
}

function blockerLabel(key) {
  return ({ invalid_timestamp: 'Invalid timestamp', no_numeric_value: 'No numeric value', missing_state: 'Missing Machine State', missing_expected_value: 'Missing expected value for current state', missing_threshold_or_tolerance: 'Rule has no tolerance or thresholds', invalid_timestamp: 'Invalid timestamp', unsupported_evaluator: 'Unsupported check type' })[key] || key || 'Needs validation';
}

function STATUS_LABEL_SAFE(status) { return status === 'needs_validation' ? 'Needs validation' : status === 'needs_configuration' ? 'Needs configuration' : status === 'evaluator_pending' ? 'Evaluator pending' : status; }

function recordInvalidTimestamp(source, file, raw, row) {
  const key = `${source}:${file}`;
  diagnostics.invalidTimestamps[key] = (diagnostics.invalidTimestamps[key] || 0) + 1;
  if (!diagnostics.firstInvalidTimestamp[key]) diagnostics.firstInvalidTimestamp[key] = { row, raw };
  const section = diagnostics.timestampParsing[source] || (diagnostics.timestampParsing[source] = timestampParsingDefaults(source));
  section.invalidTimestamps += 1;
  if (!section.firstInvalidExample) section.firstInvalidExample = { file, row, raw };
}

function sourceStats(source) {
  return diagnostics.sourceStats[source] || (diagnostics.sourceStats[source] = { scannedRows: 0, matchedRows: 0, numericRows: 0, getRows: 0, setRows: 0, invalidValues: 0, invalidTimestamps: 0 });
}

function timestampParsingDefaults(source) {
  return { source, formatExpected: source === 'MachineStates' ? 'DD/MM/YYYY HH:mm:ss[.:ffffff]' : source === 'BSSNotifications' || source === 'IPSNotifications' ? 'MM/DD/YYYY HH:mm:ss[.:ffffff]' : 'Source-specific adapter format', rowsParsed: 0, invalidTimestamps: 0, firstInvalidExample: null, firstValidTimestampMs: null, lastValidTimestampMs: null };
}

function buildRuleCoverage(runtimes) {
  return runtimes.map(runtime => ({ ruleRow: runtime.rule.row, signal: runtime.rule.signal, matchedCount: runtime.matchedRows, numericCount: runtime.numericRows, fullyEvaluatedCount: runtime.fullyEvaluatedPoints, primaryBlocker: topCount(runtime.blockers)?.key || null }));
}

function buildDataTimeRanges() {
  return { sourceRanges: diagnostics.sourceTimeRangeByAdapter, machineStatesRange: diagnostics.machineStatesTimeRange, overlapByAdapter: diagnostics.overlapByAdapter };
}

function increment(object, key) { object[key] = (object[key] || 0) + 1; }
function count(object, key) { object[key] = (object[key] || 0) + 1; }
