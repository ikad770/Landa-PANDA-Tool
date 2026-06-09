import JSZip from 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm';
import * as XLSX from 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm';
import { MAX_CHART_POINTS_PER_SIGNAL, V2_PROGRESS_STAGES, MAX_STACK_FRAMES } from './config.js';
import { parseDelimitedText } from './adapters.js';
import { parseRulesWorkbook } from './rules.js';
import { runV2Pipeline } from './v2-pipeline.js';

let cancelled = false;
let lastOverallPercent = 0;
let activeStage = 'upload';

self.onmessage = async event => {
  if (event.data?.type === 'cancel') { cancelled = true; return; }
  if (event.data?.type !== 'start') return;
  cancelled = false;
  lastOverallPercent = 0;
  activeStage = 'upload';
  const startedMs = Date.now();
  const startedAt = new Date(startedMs).toISOString();
  try {
    const result = await runWorkerV2(event.data, startedAt, startedMs);
    postMessage({ type: 'complete', analysisResult: result });
  } catch (error) {
    postMessage({ type: 'error', error: serializeWorkerError(error), message: error?.message || 'Analysis failed.' });
  }
};

async function runWorkerV2({ autocollectFile, rulesFile }, startedAt, startedMs) {
  if (!autocollectFile || !rulesFile) throw stageError('upload', 'Autocollect ZIP and Rules workbook are required.');
  emitProgress('upload', 0.1, 'Reading selected files.', 0, 2);
  const inputFiles = [fileSummary(autocollectFile), fileSummary(rulesFile)];
  const rulesBuffer = await rulesFile.arrayBuffer();
  emitProgress('upload', 0.7, 'Rules workbook loaded.', 1, 2);
  assertNotCancelled();
  const rules = parseRulesWorkbook(XLSX, rulesBuffer);
  emitProgress('parse', 0.05, `Parsed ${rules.length} configured rules.`, 0, 1);
  const extraction = await extractRowsFromArchive(autocollectFile);
  const rows = extraction.rows;
  emitProgress('parse', 1, `Scanned ${extraction.stats.filesScanned} files; parsed ${extraction.stats.rowsParsed} rows; found ${extraction.stats.numericSamplesFound} numeric samples, ${extraction.stats.stateUpdatesFound} state updates, and ${extraction.stats.unsupportedRows} unsupported rows.`, extraction.stats.rowsParsed, extraction.stats.filesScanned);
  if (!extraction.stats.numericSamplesFound) {
    const error = stageError('parse', 'NO_NUMERIC_SIGNALS_FOUND: No numeric BSS, FEC, or generic signal samples were found in the uploaded logs.');
    error.code = 'NO_NUMERIC_SIGNALS_FOUND';
    error.diagnostics = extraction.stats;
    throw error;
  }
  assertNotCancelled();
  const result = runV2Pipeline({
    rows,
    rules,
    inputFiles,
    startedAt,
    startedMs,
    chartLimit: MAX_CHART_POINTS_PER_SIGNAL,
    progress: (stage, fraction, message, processed, total) => emitProgress(stage, fraction, message, processed, total)
  });
  emitProgress('complete', 1, 'Analysis complete.', 1, 1);
  return result;
}

async function extractRowsFromArchive(file) {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const entries = Object.values(zip.files).filter(entry => !entry.dir);
  const rows = [];
  const stats = { filesScanned: 0, rowsParsed: 0, numericSamplesFound: 0, stateUpdatesFound: 0, unsupportedRows: 0, schemas: {} };
  let processed = 0;
  for (const entry of entries) {
    assertNotCancelled();
    const name = entry.name;
    if (/\.zip$/i.test(name)) {
      const nested = await JSZip.loadAsync(await entry.async('arraybuffer'));
      for (const nestedEntry of Object.values(nested.files)) {
        if (nestedEntry.dir || !isSupportedText(nestedEntry.name)) continue;
        stats.filesScanned += 1;
        parseDelimitedText(await nestedEntry.async('text'), nestedEntry.name, { collect: false, onSchema: schema => recordSchema(stats, schema), onUnsupported: () => { stats.rowsParsed += 1; stats.unsupportedRows += 1; }, onRow: row => handleParsedRow(row, rows, stats) });
      }
    } else if (isSupportedText(name)) {
      stats.filesScanned += 1;
      parseDelimitedText(await entry.async('text'), name, { collect: false, onSchema: schema => recordSchema(stats, schema), onUnsupported: () => { stats.rowsParsed += 1; stats.unsupportedRows += 1; }, onRow: row => handleParsedRow(row, rows, stats) });
    }
    processed += 1;
    emitProgress('parse', entries.length ? processed / entries.length : 1, `Parsed ${name}.`, processed, entries.length);
  }
  return { rows, stats };
}

function recordSchema(stats, info) {
  const key = info?.schema || 'unknown';
  stats.schemas[key] = (stats.schemas[key] || 0) + 1;
}

function handleParsedRow(row, rows, stats) {
  stats.rowsParsed += 1;
  if (row?.kind === 'sample' && Number.isFinite(row.numericValue)) stats.numericSamplesFound += 1;
  else if (row?.kind === 'state_update') stats.stateUpdatesFound += 1;
  else stats.unsupportedRows += 1;
  rows.push(row);
}

function isSupportedText(name) {
  return /\.(csv|txt|log)$/i.test(name || '');
}

function fileSummary(file) {
  return { name: file.name, size: file.size, type: file.type || null, lastModified: file.lastModified || null };
}

function emitProgress(stage, fraction, message, processed = 0, total = 0) {
  activeStage = stage;
  const def = V2_PROGRESS_STAGES.find(item => item.key === stage) || V2_PROGRESS_STAGES[0];
  const boundedFraction = Math.max(0, Math.min(1, Number(fraction) || 0));
  const stagePercent = stage === 'complete' ? 100 : Math.round(boundedFraction * 100);
  let overallPercent = stage === 'complete' ? 100 : Math.round(def.start + (def.end - def.start) * boundedFraction);
  if (stage !== 'complete') overallPercent = Math.min(99, overallPercent);
  overallPercent = Math.max(lastOverallPercent, overallPercent);
  lastOverallPercent = overallPercent;
  postMessage({ type: 'progress', progress: { stage, stageLabel: def.label, stagePercent, overallPercent, percent: overallPercent, message, processed, total } });
}

function assertNotCancelled() {
  if (cancelled) throw stageError(activeStage, 'Analysis cancelled.');
}

function stageError(stage, message) {
  const error = new Error(message);
  error.stage = stage;
  error.code = stage === 'upload' ? 'missing_input' : 'analysis_error';
  return error;
}

function serializeWorkerError(error) {
  return {
    name: error?.name || 'Error',
    code: error?.code || 'analysis_error',
    message: error?.message || String(error),
    stage: error?.stage || activeStage,
    source: error?.source || null,
    signal: error?.signal || null,
    ruleId: error?.ruleId || null,
    ruleRow: error?.ruleRow || null,
    diagnostics: error?.diagnostics || null,
    stackFrames: String(error?.stack || '').split('\n').slice(1, MAX_STACK_FRAMES + 1).map(line => line.trim())
  };
}
