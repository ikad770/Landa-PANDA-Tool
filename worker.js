import JSZip from 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm';
import * as XLSX from 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm';
import Papa from 'https://cdn.jsdelivr.net/npm/papaparse@5.4.1/+esm';
import { ADAPTERS, getAdapter, matchRuleForRow } from './adapters.js';
import { APP_STAGES, MAX_CHART_POINTS_PER_RULE, MAX_CSV_TEXT_MB_WARNING, MAX_DEVIATION_EVENTS_PER_RULE, MAX_EVIDENCE_PREVIEW_PER_RULE, MIN_DEVIATION_GAP_MS, STATUS_PRIORITY } from './config.js';
import { computeAllowedRange, evaluateValue, expectedValuesFromRow, normalizeCheckType, normalizeState, normalizeText, normalizeToken, parseThreshold, parseTolerance, validateRule } from './evaluation.js';

let cancelled = false;
let startedAt = 0;
let diagnostics;
let progressState;

self.onmessage = async event => {
  if (event.data?.type === 'cancel') { cancelled = true; return; }
  if (event.data?.type !== 'start') return;
  cancelled = false;
  startedAt = performance.now();
  diagnostics = createDiagnostics();
  progressState = { relevantValuesFound: 0, signalsMatched: new Set(), filesCompleted: 0, filesTotal: 0, warnings: 0, errors: 0, currentSource: '', currentFile: '' };
  try {
    const result = await runAnalysis(event.data.autocollectFile, event.data.rulesFile);
    postMessage({ type: 'complete', result });
  } catch (error) {
    postMessage({ type: 'error', message: error?.message || String(error), diagnosticsSummary: diagnostics });
  }
};

function assertNotCancelled() { if (cancelled) throw new Error('Analysis cancelled'); }
function yieldToLoop() { return new Promise(resolve => setTimeout(resolve, 0)); }

function createDiagnostics() {
  return {
    ruleParsing: { total: 0, valid: 0, invalid: {}, headerRow: null, invalidRules: [] },
    analysisPlan: {}, archiveIndex: {}, adapterSummary: {}, scannedRows: 0, matchedValues: 0,
    invalidTimestamps: {}, unmatchedRuleSignals: [], parserWarnings: [], parserErrors: [], memoryWarnings: [], timingByStage: {}
  };
}

function setStage(key, fraction, message, details = {}) {
  const elapsedMs = performance.now() - startedAt;
  let complete = 0;
  for (const [stageKey, , weight] of APP_STAGES) {
    if (stageKey === key) { complete += weight * Math.max(0, Math.min(1, fraction)); break; }
    complete += weight;
  }
  const percent = Math.min(99, Math.round(complete));
  const remainingMs = percent > 0 ? Math.max(0, elapsedMs * (100 - percent) / percent) : null;
  postMessage({ type: 'progress', progress: { stage: key, percent, message, elapsedMs, remainingMs, ...serializeProgress(), ...details } });
}

function serializeProgress() {
  return { ...progressState, signalsMatched: progressState.signalsMatched.size, warnings: diagnostics.parserWarnings.length + diagnostics.memoryWarnings.length, errors: diagnostics.parserErrors.length };
}

async function runAnalysis(autocollectFile, rulesFile) {
  if (!autocollectFile || !rulesFile) throw new Error('Autocollect ZIP and Rules Excel are required.');

  setStage('rules_loading', 0.1, 'Reading rules workbook');
  const rulesBuffer = await rulesFile.arrayBuffer();
  const rules = parseRulesWorkbook(rulesBuffer);
  const analysisPlan = buildAnalysisPlan(rules);
  diagnostics.analysisPlan = serializePlan(analysisPlan);
  setStage('rules_loading', 1, 'Rules loaded', { rulesTotal: rules.length, rulesValid: analysisPlan.validRules.length });
  assertNotCancelled();

  setStage('archive_validation', 0.2, 'Opening root autocollect ZIP');
  const rootZip = await JSZip.loadAsync(autocollectFile);
  setStage('archive_validation', 1, 'Root archive opened');

  setStage('opc_indexing', 0.1, 'Indexing required opc.zip locations');
  const archiveIndex = await indexRootArchive(rootZip, analysisPlan);
  diagnostics.archiveIndex = summarizeArchiveIndex(archiveIndex);
  progressState.filesTotal = archiveIndex.machineStateFiles.length + Object.values(archiveIndex.sourceFilesByAdapter).flat().length;
  setStage('opc_indexing', 1, 'Archive indexing complete');
  setStage('source_discovery', 1, 'Required sources discovered', { filesTotal: progressState.filesTotal });

  const stateIndex = createStateIndex();
  await parseMachineStates(archiveIndex.machineStateFiles, stateIndex);
  stateIndex.finalize();

  const runtimes = new Map(analysisPlan.validRules.map(rule => [rule.ruleId, createRuntime(rule)]));
  await parseRelevantSources(archiveIndex.sourceFilesByAdapter, analysisPlan, stateIndex, runtimes);

  setStage('evaluation', 0.6, 'Closing active deviation events');
  for (const runtime of runtimes.values()) closeDeviation(runtime);
  setStage('evaluation', 1, 'Deviation aggregation complete');

  setStage('timeline_finalization', 0.5, 'Finalizing charts and timelines');
  const result = finalizeResult(rules, analysisPlan, archiveIndex, stateIndex, runtimes);
  setStage('timeline_finalization', 1, 'Timeline finalized');
  setStage('dashboard_finalization', 1, 'Dashboard model finalized');
  return result;
}

function parseRulesWorkbook(buffer) {
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheet = workbook.Sheets['PANDA Rules Template'];
  if (!sheet) throw new Error('Rules workbook must contain sheet "PANDA Rules Template".');
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  const required = ['System', 'Subsystem', 'Component', 'Log Signal Name', 'Log Source'];
  const headerIndex = rows.findIndex(row => required.every(name => row.map(normalizeText).includes(name)));
  if (headerIndex < 0) throw new Error('Could not detect Rules header row with System, Subsystem, Component, Log Signal Name, and Log Source.');
  diagnostics.ruleParsing.headerRow = headerIndex + 1;
  const header = rows[headerIndex].map(normalizeText);
  const rules = [];
  for (let i = headerIndex + 1; i < rows.length; i++) {
    const rowArray = rows[i];
    if (!rowArray.some(cell => normalizeText(cell))) continue;
    const row = Object.fromEntries(header.map((h, idx) => [h, rowArray[idx] ?? '']));
    const { expectedByState, genericExpected } = expectedValuesFromRow(row);
    const rule = {
      ruleId: `R${i + 1}`,
      row: i + 1,
      system: normalizeText(row.System),
      subsystem: normalizeText(row.Subsystem),
      component: normalizeText(row.Component),
      signal: normalizeText(row['Log Signal Name']),
      normSignal: normalizeToken(row['Log Signal Name']),
      sourceType: normalizeText(row['Log Source']),
      sourceNormalized: normalizeToken(row['Log Source']),
      checkType: normalizeText(row['Check Type'] || 'Range'),
      checkTypeNormalized: normalizeCheckType(row['Check Type'] || 'Range'),
      expectedByState,
      genericExpected,
      tolerance: parseTolerance(row.Tolerance || row['Allowed Tolerance'] || row['Limit'] || row['Threshold']),
      warningLow: parseThreshold(row['Warning Low'] || row['Warning Min']),
      warningHigh: parseThreshold(row['Warning High'] || row['Warning Max']),
      criticalLow: parseThreshold(row['Critical Low'] || row['Critical Min']),
      criticalHigh: parseThreshold(row['Critical High'] || row['Critical Max']),
      recommendedAction: normalizeText(row['Recommended Action'] || row.Action || row['Service Action'])
    };
    rule.validity = validateRule(rule);
    rules.push(rule);
  }
  diagnostics.ruleParsing.total = rules.length;
  diagnostics.ruleParsing.valid = rules.filter(r => r.validity === 'valid').length;
  for (const rule of rules.filter(r => r.validity !== 'valid')) {
    diagnostics.ruleParsing.invalid[rule.validity] = (diagnostics.ruleParsing.invalid[rule.validity] || 0) + 1;
    diagnostics.ruleParsing.invalidRules.push({ row: rule.row, signal: rule.signal, source: rule.sourceType, validity: rule.validity });
  }
  return rules;
}

function buildAnalysisPlan(rules) {
  const systems = new Set(); const sources = new Set(); const adaptersRequired = new Set();
  const rulesBySystem = new Map(); const rulesBySource = new Map(); const exactSignalsBySource = new Map();
  const validRules = rules.filter(rule => rule.validity === 'valid' && ADAPTERS[rule.sourceType]);
  for (const rule of validRules) {
    systems.add(rule.system); sources.add(rule.sourceType); adaptersRequired.add(rule.sourceType);
    if (!rulesBySystem.has(rule.system)) rulesBySystem.set(rule.system, []);
    if (!rulesBySource.has(rule.sourceType)) rulesBySource.set(rule.sourceType, []);
    if (!exactSignalsBySource.has(rule.sourceType)) exactSignalsBySource.set(rule.sourceType, new Set());
    rulesBySystem.get(rule.system).push(rule);
    rulesBySource.get(rule.sourceType).push(rule);
    exactSignalsBySource.get(rule.sourceType).add(rule.normSignal);
  }
  const stateContextRequired = validRules.some(rule => Object.keys(rule.expectedByState).length > 0);
  return { systems, sources, rulesBySystem, rulesBySource, exactSignalsBySource, adaptersRequired, stateContextRequired, validRules };
}

function serializePlan(plan) {
  return {
    systems: [...plan.systems], sources: [...plan.sources], adaptersRequired: [...plan.adaptersRequired], stateContextRequired: plan.stateContextRequired,
    rulesBySystem: Object.fromEntries([...plan.rulesBySystem].map(([k, v]) => [k, v.length])),
    requiredSignals: Object.fromEntries([...plan.exactSignalsBySource].map(([k, v]) => [k, [...v]]))
  };
}

async function indexRootArchive(rootZip, analysisPlan) {
  const opcEntry = Object.values(rootZip.files).find(file => !file.dir && /(^|\/)opc\.zip$/i.test(file.name));
  if (!opcEntry) throw new Error('opc.zip was not found in the root autocollect ZIP.');
  const opcBuffer = await opcEntry.async('arraybuffer');
  const opcZip = await JSZip.loadAsync(opcBuffer);
  const index = { opcFound: true, opcZip, machineStateFiles: [], sourceFilesByAdapter: {}, skippedSources: [], nestedArchivesOpened: 0, estimatedCompressedBytes: 0, estimatedUncompressedBytes: 0 };
  for (const adapterName of analysisPlan.adaptersRequired) index.sourceFilesByAdapter[adapterName] = [];
  const requiredAdapters = [...analysisPlan.adaptersRequired].map(getAdapter).filter(Boolean);

  for (const file of Object.values(opcZip.files)) {
    if (file.dir) continue;
    const path = file.name;
    const uncompressed = file._data?.uncompressedSize || 0;
    const compressed = file._data?.compressedSize || 0;
    if (ADAPTERS.MachineStates.canHandlePath(path)) {
      index.machineStateFiles.push({ path, entry: file, size: uncompressed, compressedSize: compressed, sourceType: 'MachineStates' });
      index.estimatedCompressedBytes += compressed; index.estimatedUncompressedBytes += uncompressed;
      continue;
    }
    const adapter = requiredAdapters.find(a => a.canHandlePath(path));
    const containerAdapter = requiredAdapters.find(a => a.canHandleContainerPath?.(path));
    if (adapter) {
      index.sourceFilesByAdapter[adapter.sourceType].push({ path, entry: file, size: uncompressed, compressedSize: compressed, sourceType: adapter.sourceType });
      index.estimatedCompressedBytes += compressed; index.estimatedUncompressedBytes += uncompressed;
    } else if (containerAdapter && /\.zip$/i.test(path)) {
      const nestedBuffer = await file.async('arraybuffer');
      index.nestedArchivesOpened += 1;
      const nestedZip = await JSZip.loadAsync(nestedBuffer);
      for (const nestedFile of Object.values(nestedZip.files)) {
        if (nestedFile.dir || !/\.csv$/i.test(nestedFile.name)) continue;
        const nestedPath = `${path}!/${nestedFile.name}`;
        index.sourceFilesByAdapter[containerAdapter.sourceType].push({ path: nestedPath, entry: nestedFile, size: nestedFile._data?.uncompressedSize || 0, compressedSize: nestedFile._data?.compressedSize || 0, sourceType: containerAdapter.sourceType });
        index.estimatedCompressedBytes += nestedFile._data?.compressedSize || 0;
        index.estimatedUncompressedBytes += nestedFile._data?.uncompressedSize || 0;
      }
      await yieldToLoop();
    } else if (/logs\/(FECNotifications|LLCINotifications\/IPS|LLCINotifications\/BSS|AlertsMonitoring)\//i.test(path)) {
      index.skippedSources.push(path);
    }
  }
  return index;
}

function summarizeArchiveIndex(index) {
  return { opcFound: index.opcFound, machineStateFiles: index.machineStateFiles.map(f => f.path), sourceFilesByAdapter: Object.fromEntries(Object.entries(index.sourceFilesByAdapter).map(([k, v]) => [k, v.map(f => f.path)])), skippedSources: index.skippedSources.slice(0, 200), nestedArchivesOpened: index.nestedArchivesOpened, estimatedCompressedBytes: index.estimatedCompressedBytes, estimatedUncompressedBytes: index.estimatedUncompressedBytes };
}

function createStateIndex() {
  const series = { Machine: [] };
  const last = {};
  return {
    series,
    add(system, timestampMs, value) {
      const clean = normalizeText(value);
      if (!clean || clean === '---') return;
      const key = system || 'Machine';
      if (last[key] === clean) return;
      last[key] = clean;
      if (!series[key]) series[key] = [];
      series[key].push({ timestampMs, value: clean });
    },
    finalize() {
      for (const [system, rows] of Object.entries(series)) {
        rows.sort((a, b) => a.timestampMs - b.timestampMs);
        series[system] = rows.filter((row, idx) => idx === 0 || row.timestampMs !== rows[idx - 1].timestampMs || row.value !== rows[idx - 1].value);
      }
    },
    at(timestampMs, system) {
      const machine = binaryState(series.Machine || [], timestampMs);
      const sys = binaryState(series[system] || [], timestampMs);
      return { machineState: machine?.value || null, systemState: sys?.value || null, machineMatchedTimestampMs: machine?.timestampMs || null, systemMatchedTimestampMs: sys?.timestampMs || null, status: sys ? 'matched' : machine ? 'machine_only' : 'missing' };
    }
  };
}

function binaryState(rows, ts) {
  let lo = 0; let hi = rows.length - 1; let found = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].timestampMs <= ts) { found = rows[mid]; lo = mid + 1; } else hi = mid - 1;
  }
  return found;
}

async function parseMachineStates(files, stateIndex) {
  const adapter = ADAPTERS.MachineStates;
  let done = 0;
  for (const file of files) {
    assertNotCancelled(); progressState.currentSource = 'MachineStates'; progressState.currentFile = file.path;
    setStage('machine_states', files.length ? done / files.length : 1, 'Parsing MachineStates');
    let text = await file.entry.async('text');
    text = adapter.cleanText(text);
    parseCsv(text, adapter, file.path, row => {
      const ts = adapter.getTimestampMs(row);
      if (!validTimestamp(ts, file.path, 'MachineStates', row.Timestamp || row.Time || row.DateTime)) return;
      for (const [key, value] of Object.entries(row)) if (key !== 'Timestamp' && key !== 'Time' && key !== 'DateTime') stateIndex.add(key === 'MachineState' ? 'Machine' : key, ts, value);
    });
    text = null;
    progressState.filesCompleted += 1; done += 1; await yieldToLoop();
  }
  setStage('machine_states', 1, 'MachineStates indexed');
}

async function parseRelevantSources(sourceFilesByAdapter, analysisPlan, stateIndex, runtimes) {
  const all = Object.values(sourceFilesByAdapter).flat();
  const totalBytes = all.reduce((sum, f) => sum + (f.size || 0), 0);
  let processedBytes = 0; let done = 0;
  for (const [sourceType, files] of Object.entries(sourceFilesByAdapter)) {
    const adapter = getAdapter(sourceType);
    const rules = analysisPlan.rulesBySource.get(sourceType) || [];
    diagnostics.adapterSummary[sourceType] = diagnostics.adapterSummary[sourceType] || { files: 0, scannedRows: 0, matchedValues: 0, invalidTimestamps: 0 };
    for (const file of files) {
      assertNotCancelled();
      progressState.currentSource = sourceType; progressState.currentFile = file.path;
      const fraction = totalBytes ? processedBytes / totalBytes : done / Math.max(1, all.length);
      setStage('source_parsing', fraction, 'Parsing relevant source files');
      if ((file.size || 0) / 1024 / 1024 > MAX_CSV_TEXT_MB_WARNING) diagnostics.memoryWarnings.push(`${file.path} exceeds ${MAX_CSV_TEXT_MB_WARNING}MB; processed alone.`);
      let text = await file.entry.async('text');
      text = adapter.cleanText(text);
      parseCsv(text, adapter, file.path, row => {
        diagnostics.scannedRows += 1; diagnostics.adapterSummary[sourceType].scannedRows += 1;
        const matchedRules = matchRuleForRow(adapter, row, rules);
        if (!matchedRules.length) return;
        const ts = adapter.getTimestampMs(row);
        if (!validTimestamp(ts, file.path, sourceType, row.Timestamp || row.Time || row.DateTime)) return;
        const actual = adapter.getNumericValue(row);
        for (const rule of matchedRules) {
          const runtime = runtimes.get(rule.ruleId);
          processMatchedValue(runtime, rule, adapter, row, ts, actual, stateIndex.at(ts, rule.system));
        }
      });
      diagnostics.adapterSummary[sourceType].files += 1;
      text = null;
      processedBytes += file.size || 0; done += 1; progressState.filesCompleted += 1; await yieldToLoop();
    }
  }
  setStage('source_parsing', 1, 'Relevant source parsing complete');
}

function parseCsv(text, adapter, filePath, onRow) {
  const result = Papa.parse(text, {
    header: true,
    skipEmptyLines: true,
    worker: false,
    transformHeader: adapter.normalizeHeader,
    step(results) { onRow(adapter.normalizeRow(results.data)); }
  });
  for (const err of result.errors || []) diagnostics.parserWarnings.push(`${filePath}: ${err.message}`);
}

function validTimestamp(ts, path, sourceType = 'MachineStates', rawValue = '') {
  if (Number.isFinite(ts)) return true;
  if (!diagnostics.invalidTimestamps[path]) diagnostics.invalidTimestamps[path] = { sourceType, count: 0, firstExample: rawValue || 'empty timestamp' };
  diagnostics.invalidTimestamps[path].count += 1;
  const adapterSummary = diagnostics.adapterSummary[sourceType];
  if (adapterSummary) adapterSummary.invalidTimestamps += 1;
  return false;
}

function createRuntime(rule) {
  return { ruleId: rule.ruleId, rule, matchedRows: 0, numericRows: 0, firstTimestampMs: null, lastTimestampMs: null, latestPoint: null, minActual: Infinity, maxActual: -Infinity, sumActual: 0, evaluatedCounts: {}, stateCoverageCount: 0, samples: [], chartReservoir: [], activeDeviation: null, deviationEvents: [], intervals: [], evidence: [] };
}

function processMatchedValue(runtime, rule, adapter, row, timestampMs, actual, stateContext) {
  runtime.matchedRows += 1; diagnostics.matchedValues += 1; progressState.relevantValuesFound += 1; progressState.signalsMatched.add(`${rule.system}::${rule.signal}`);
  if (Number.isFinite(actual)) { runtime.numericRows += 1; runtime.minActual = Math.min(runtime.minActual, actual); runtime.maxActual = Math.max(runtime.maxActual, actual); runtime.sumActual += actual; }
  if (runtime.lastTimestampMs) runtime.intervals.push(timestampMs - runtime.lastTimestampMs);
  runtime.firstTimestampMs ??= timestampMs; runtime.lastTimestampMs = timestampMs;
  if (stateContext.status !== 'missing') runtime.stateCoverageCount += 1;
  const evaluation = evaluateValue(rule, actual, stateContext);
  runtime.evaluatedCounts[evaluation.status] = (runtime.evaluatedCounts[evaluation.status] || 0) + 1;
  const point = { timestampMs, actual, result: evaluation.status, expectedLow: evaluation.expectedLow, expectedHigh: evaluation.expectedHigh, expectedValue: evaluation.expectedValue, machineState: stateContext.machineState, systemState: stateContext.systemState, system: rule.system, subsystem: adapter.getSubsystem(row, rule), component: adapter.getComponent(row) || rule.component, signal: rule.signal, reason: evaluation.reason };
  runtime.latestPoint = point;
  addChartSample(runtime, point);
  addEvidence(runtime, point);
  updateDeviation(runtime, point, rule);
}

function addChartSample(runtime, point) {
  const sample = { t: point.timestampMs, y: point.actual, status: point.result, expectedLow: point.expectedLow, expectedHigh: point.expectedHigh };
  if (runtime.chartReservoir.length < MAX_CHART_POINTS_PER_RULE) runtime.chartReservoir.push(sample);
  else {
    const index = runtime.matchedRows % MAX_CHART_POINTS_PER_RULE;
    runtime.chartReservoir[index] = sample;
  }
}

function addEvidence(runtime, point) {
  runtime.evidence.push(point);
  runtime.evidence.sort((a, b) => (STATUS_PRIORITY[b.result] - STATUS_PRIORITY[a.result]) || b.timestampMs - a.timestampMs);
  runtime.evidence = runtime.evidence.slice(0, MAX_EVIDENCE_PREVIEW_PER_RULE);
}

function median(values) {
  const valid = values.filter(v => Number.isFinite(v) && v >= 0).sort((a, b) => a - b);
  if (!valid.length) return MIN_DEVIATION_GAP_MS;
  return valid[Math.floor(valid.length / 2)];
}

function eventGap(runtime) { return Math.max(2 * median(runtime.intervals), MIN_DEVIATION_GAP_MS); }

function rangeCompatible(active, point) { return active.expectedLow === point.expectedLow && active.expectedHigh === point.expectedHigh; }
function statesCompatible(active, point) { return active.lastMachineState === point.machineState && active.lastSystemState === point.systemState; }

function updateDeviation(runtime, point, rule) {
  if (!['warning', 'critical'].includes(point.result)) { closeDeviation(runtime); return; }
  const active = runtime.activeDeviation;
  const continues = active && active.severity === point.result && point.timestampMs - active.endTimestampMs <= eventGap(runtime) && rangeCompatible(active, point) && statesCompatible(active, point);
  if (!continues) { closeDeviation(runtime); runtime.activeDeviation = createDeviation(runtime, point, rule); }
  else extendDeviation(active, point);
}

function createDeviation(runtime, point, rule) {
  return { id: `DEV-${rule.ruleId}-${runtime.deviationEvents.length + 1}`, system: rule.system, subsystem: point.subsystem, component: point.component, signal: rule.signal, severity: point.result, startTimestampMs: point.timestampMs, endTimestampMs: point.timestampMs, durationMs: 0, firstActual: point.actual, latestActual: point.actual, minActual: point.actual, maxActual: point.actual, expectedLow: point.expectedLow, expectedHigh: point.expectedHigh, maximumDeviation: Math.abs(point.reason === 'No numeric value' ? 0 : point.actual - closestAllowed(point.actual, point.expectedLow, point.expectedHigh)), machineStatesSeen: [...new Set([point.machineState].filter(Boolean))], systemStatesSeen: [...new Set([point.systemState].filter(Boolean))], lastMachineState: point.machineState, lastSystemState: point.systemState, pointCount: 1, recommendedAction: rule.recommendedAction || 'No configured action for this rule', ruleRow: rule.row };
}

function closestAllowed(actual, low, high) { return actual > high ? high : actual < low ? low : actual; }
function extendDeviation(event, point) {
  event.endTimestampMs = point.timestampMs; event.durationMs = Math.max(0, event.endTimestampMs - event.startTimestampMs); event.latestActual = point.actual; event.minActual = Math.min(event.minActual, point.actual); event.maxActual = Math.max(event.maxActual, point.actual); event.maximumDeviation = Math.max(event.maximumDeviation, Math.abs(point.actual - closestAllowed(point.actual, point.expectedLow, point.expectedHigh))); event.pointCount += 1;
  if (point.machineState && !event.machineStatesSeen.includes(point.machineState)) event.machineStatesSeen.push(point.machineState);
  if (point.systemState && !event.systemStatesSeen.includes(point.systemState)) event.systemStatesSeen.push(point.systemState);
}
function closeDeviation(runtime) { if (!runtime.activeDeviation) return; if (runtime.deviationEvents.length < MAX_DEVIATION_EVENTS_PER_RULE) runtime.deviationEvents.push(runtime.activeDeviation); runtime.activeDeviation = null; }

function finalizeResult(rules, plan, archiveIndex, stateIndex, runtimes) {
  const runtimeList = [...runtimes.values()];
  const deviationEvents = runtimeList.flatMap(r => r.deviationEvents).sort((a, b) => STATUS_PRIORITY[b.severity] - STATUS_PRIORITY[a.severity] || b.durationMs - a.durationMs);
  const signalSummaries = runtimeList.map(runtimeToSignalSummary).sort((a, b) => STATUS_PRIORITY[b.status] - STATUS_PRIORITY[a.status] || a.system.localeCompare(b.system));
  const systems = [...new Set([...plan.systems, ...Object.keys(stateIndex.series).filter(s => s !== 'Machine')])];
  const systemHealth = systems.map(system => buildSystemHealth(system, plan, signalSummaries));
  const startTimestampMs = Math.min(...runtimeList.map(r => r.firstTimestampMs).filter(Number.isFinite), ...Object.values(stateIndex.series).flat().map(s => s.timestampMs).filter(Number.isFinite));
  const endTimestampMs = Math.max(...runtimeList.map(r => r.lastTimestampMs).filter(Number.isFinite), ...Object.values(stateIndex.series).flat().map(s => s.timestampMs).filter(Number.isFinite));
  const stateTimeline = buildStateTimeline(stateIndex.series.Machine || [], startTimestampMs, endTimestampMs);
  const chartSeries = Object.fromEntries(runtimeList.map(r => [`${r.rule.system}::${r.rule.signal}`, r.chartReservoir.sort((a, b) => a.t - b.t)]));
  const activeFindings = deviationEvents.slice(0, 10);
  const timelineRows = buildTimelineRows(systemHealth, deviationEvents, startTimestampMs, endTimestampMs);
  const evidence = runtimeList.flatMap(r => r.evidence).sort((a, b) => STATUS_PRIORITY[b.result] - STATUS_PRIORITY[a.result] || b.timestampMs - a.timestampMs).slice(0, 5);
  const rulesEvaluated = runtimeList.filter(r => r.numericRows > 0 && Object.keys(r.evaluatedCounts).some(k => ['ok', 'warning', 'critical'].includes(k))).length;
  const result = {
    metadata: { createdAt: new Date().toISOString(), timeRange: formatTimeRange(startTimestampMs, endTimestampMs), startTimestampMs: finiteOrNull(startTimestampMs), endTimestampMs: finiteOrNull(endTimestampMs), rulesTotal: rules.length, rulesValid: plan.validRules.length, rulesEvaluated, systemsWithRules: plan.systems.size, systemsEvaluated: systemHealth.filter(s => s.status !== 'no_rule' && s.status !== 'no_data').length, relevantSignalsRequired: [...plan.exactSignalsBySource.values()].reduce((sum, set) => sum + set.size, 0), relevantSignalsFound: new Set(runtimeList.filter(r => r.matchedRows).map(r => `${r.rule.system}::${r.rule.signal}`)).size, relevantValuesFound: diagnostics.matchedValues, deviationsFound: deviationEvents.length, analysisTimeMs: Math.round(performance.now() - startedAt) },
    systemHealth, activeFindings, deviationEvents, timelineRows, stateTimeline, signalSummaries, chartSeries, evidence, diagnosticsSummary: { ...diagnostics, analysisPlan: serializePlan(plan), archiveIndex: summarizeArchiveIndex(archiveIndex) }
  };
  return result;
}

function finiteOrNull(v) { return Number.isFinite(v) ? v : null; }
function formatTimeRange(start, end) { return Number.isFinite(start) && Number.isFinite(end) ? `${new Date(start).toLocaleString()} – ${new Date(end).toLocaleString()}` : 'No evaluated time range'; }

function runtimeToSignalSummary(runtime) {
  const status = highestStatus(runtime.evaluatedCounts, runtime.matchedRows ? 'needs_validation' : 'no_data');
  const latest = runtime.latestPoint;
  const range = latest?.expectedLow !== undefined ? { expectedLow: latest.expectedLow, expectedHigh: latest.expectedHigh } : computeAllowedRange(runtime.rule, runtime.rule.genericExpected) || {};
  return { ruleId: runtime.ruleId, ruleRow: runtime.rule.row, system: runtime.rule.system, subsystem: runtime.rule.subsystem, component: latest?.component || runtime.rule.component, signal: runtime.rule.signal, status, latestActual: latest?.actual ?? null, expectedLow: range.expectedLow ?? range.low ?? null, expectedHigh: range.expectedHigh ?? range.high ?? null, currentMachineState: latest?.machineState || null, currentSystemState: latest?.systemState || null, matchedRows: runtime.matchedRows, numericRows: runtime.numericRows, eventCount: runtime.deviationEvents.length, totalDeviationDurationMs: runtime.deviationEvents.reduce((s, e) => s + e.durationMs, 0), minActual: Number.isFinite(runtime.minActual) ? runtime.minActual : null, maxActual: Number.isFinite(runtime.maxActual) ? runtime.maxActual : null, averageActual: runtime.numericRows ? runtime.sumActual / runtime.numericRows : null, recommendedAction: runtime.rule.recommendedAction || '' };
}

function highestStatus(counts, fallback) {
  return Object.keys(counts).sort((a, b) => STATUS_PRIORITY[b] - STATUS_PRIORITY[a])[0] || fallback;
}

function buildSystemHealth(system, plan, summaries) {
  const hasRules = plan.rulesBySystem.has(system);
  if (!hasRules) return { system, status: 'no_rule', rules: 0, evaluated: 0, deviations: 0, label: 'Rules not configured' };
  const rows = summaries.filter(s => s.system === system);
  const status = rows.length ? rows.map(r => r.status).sort((a, b) => STATUS_PRIORITY[b] - STATUS_PRIORITY[a])[0] : 'no_data';
  return { system, status, rules: plan.rulesBySystem.get(system).length, evaluated: rows.filter(r => r.numericRows > 0).length, deviations: rows.reduce((sum, r) => sum + r.eventCount, 0), latestSignal: rows[0]?.signal || null, label: status === 'no_data' ? 'No matching source values' : status };
}

function buildStateTimeline(machineRows, start, end) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || !machineRows.length) return [];
  return machineRows.map((row, idx) => ({ startMs: Math.max(start, row.timestampMs), endMs: idx < machineRows.length - 1 ? machineRows[idx + 1].timestampMs : end, label: row.value })).filter(seg => seg.endMs >= seg.startMs);
}

function buildTimelineRows(systemHealth, events, start, end) {
  if (!Number.isFinite(start) || !Number.isFinite(end)) return [];
  return systemHealth.map(health => ({ system: health.system, status: health.status, segments: events.filter(e => e.system === health.system).map(e => ({ startMs: e.startTimestampMs, endMs: e.endTimestampMs, status: e.severity, eventId: e.id, label: `${e.signal} ${e.severity}` })) }));
}
