import { APP_STAGES } from './config.js';
import { chooseInitialSystem, renderDiagnostics, renderServiceRadar, validateAnalysisResult } from './render-radar.js';
import { renderDrilldown } from './render-drilldown.js';

const $ = id => document.getElementById(id);
const fmtDuration = ms => !Number.isFinite(ms) ? '—' : ms < 1000 ? '<1s' : ms < 60000 ? `${Math.round(ms / 1000)}s` : `${Math.round(ms / 60000)}m ${Math.round(ms % 60000 / 1000)}s`;

const app = {
  autocollectFile: null,
  rulesFile: null,
  worker: null,
  analysisResult: null,
  progress: null,
  selectedSystem: null,
  selectedEventId: null,
  selectedRuleId: null,
  systemFilter: 'issues',
  lastView: 'analysis',
  workerUrl: null
};

function show(view) {
  ['analysisView', 'radarView', 'drilldownView', 'diagnosticsView'].forEach(id => $(id).classList.toggle('hidden', id !== view));
  app.lastView = view === 'diagnosticsView' ? app.lastView : view.replace('View', '');
}

function renderAnalysisWorkspace() {
  $('startAnalysis').disabled = !(app.autocollectFile && app.rulesFile && !app.worker);
  $('diagnosticsFromAnalysis').classList.toggle('hidden', !app.analysisResult);
}

function setWorkspaceMode(mode) {
  $('uploadWorkspace').classList.toggle('hidden', mode !== 'upload');
  $('processingWorkspace').classList.toggle('hidden', mode !== 'processing');
  $('readyWorkspace').classList.toggle('hidden', mode !== 'ready');
  $('failedWorkspace').classList.toggle('hidden', mode !== 'failed');
}

function startAnalysis() {
  if (!app.autocollectFile || !app.rulesFile) return;
  app.analysisResult = null; app.progress = null; app.selectedSystem = null; app.selectedEventId = null; app.selectedRuleId = null;
  setWorkspaceMode('processing');
  renderSequence('rules_loading');
  const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  app.worker = worker;
  worker.onmessage = event => handleWorkerMessage(event.data);
  worker.onerror = event => failAnalysis(event.message || 'Worker failed');
  worker.postMessage({ type: 'start', autocollectFile: app.autocollectFile, rulesFile: app.rulesFile });
}

function handleWorkerMessage(message) {
  if (message.type === 'progress') {
    app.progress = message.progress;
    renderProgress(message.progress);
  } else if (message.type === 'complete') {
    finishWorker();
    const result = message.analysisResult || message.result;
    const validation = validateAnalysisResult(result);
    if (!validation.valid) {
      failAnalysis(validation.reason);
      return;
    }
    app.analysisResult = result;
    app.analysisResult.validation = validation;
    app.selectedSystem = chooseInitialSystem(app.analysisResult);
    app.selectedEventId = app.analysisResult.deviationEvents[0]?.id || null;
    renderReady();
    setWorkspaceMode('ready');
    renderDiagnostics(app.analysisResult);
    if ($('autoOpenToggle').checked) showServiceRadar();
  } else if (message.type === 'error') {
    finishWorker();
    app.analysisResult = message.diagnosticsSummary ? { diagnosticsSummary: message.diagnosticsSummary } : app.analysisResult;
    failAnalysis(message.message);
  }
}

function finishWorker() {
  if (app.worker) app.worker.terminate();
  app.worker = null;
  renderAnalysisWorkspace();
}

function cancelAnalysis() {
  if (app.worker) app.worker.postMessage({ type: 'cancel' });
  finishWorker();
  setWorkspaceMode('upload');
}

function failAnalysis(message) {
  $('failedReason').textContent = message || 'Analysis could not produce a valid result.';
  setWorkspaceMode('failed');
  renderAnalysisWorkspace();
}

function renderProgress(progress) {
  $('progressRing').style.setProperty('--p', `${progress.percent}%`);
  $('progressPercent').textContent = `${progress.percent}%`;
  $('processingHeadline').textContent = APP_STAGES.find(([key]) => key === progress.stage)?.[1] || 'Processing';
  $('processingSubhead').textContent = progress.message || 'Processing';
  $('currentSource').textContent = progress.currentSource || '—';
  $('currentFile').textContent = progress.currentFile || '—';
  $('filesCount').textContent = `${progress.filesCompleted || 0} / ${progress.filesTotal || 0}`;
  $('relevantValues').textContent = progress.relevantValuesFound || 0;
  $('signalsMatched').textContent = progress.signalsMatched || 0;
  $('elapsedTime').textContent = fmtDuration(progress.elapsedMs || 0);
  $('remainingTime').textContent = progress.remainingMs === null ? '—' : fmtDuration(progress.remainingMs);
  $('warningErrorCount').textContent = `${progress.warnings || 0} / ${progress.errors || 0}`;
  renderSequence(progress.stage);
}

function renderSequence(activeStage) {
  let activeSeen = false;
  $('processingSequence').innerHTML = APP_STAGES.map(([key, label, weight]) => {
    const isActive = key === activeStage;
    const done = !activeSeen && !isActive;
    if (isActive) activeSeen = true;
    return `<div class="sequence-step ${isActive ? 'active' : done ? 'done' : ''}"><span class="step-dot">${done ? '✓' : weight}</span><span>${label}</span><small>${weight}%</small></div>`;
  }).join('');
}

function renderReady() {
  const meta = app.analysisResult.metadata;
  const validation = app.analysisResult.validation || { status: 'completed' };
  const topBlocker = app.analysisResult.diagnosticsSummary?.evaluationBlockers?.topBlocker;
  $('readyEyebrow').textContent = validation.status === 'completed_with_warnings' ? 'Ready with warnings' : 'Analysis complete';
  $('readyTitle').textContent = validation.status === 'completed_with_warnings' ? 'Service Radar ready with evaluation blockers' : 'Compact AnalysisResult finalized';
  $('readySubtitle').textContent = validation.status === 'completed_with_warnings' ? `${validation.reason} ${topBlocker ? `Top blocker: ${topBlocker.label}` : ''}` : 'Service Radar is ready. Diagnostics remain separate from operational findings.';
  $('readyRules').textContent = `${meta.rulesEvaluated} / ${meta.rulesValid}`;
  $('readySignals').textContent = `${meta.relevantSignalsFound} / ${meta.relevantSignalsRequired}`;
  $('readyRelevantValues').textContent = meta.relevantValuesFound || 0;
  $('readyFullyEvaluated').textContent = meta.fullyEvaluatedPoints || 0;
  $('readyNeedsValidation').textContent = meta.blockedPoints || 0;
  $('readySystems').textContent = meta.systemsEvaluated;
  $('readyDeviations').textContent = meta.deviationsFound;
  $('readyTime').textContent = fmtDuration(meta.analysisTimeMs);
  $('readyTopBlocker').textContent = topBlocker?.label || 'None';
}

function showServiceRadar() {
  if (!app.analysisResult?.metadata) return;
  renderServiceRadar(app, { selectEvent, openDrilldown });
  show('radarView');
}
function showAnalysisWorkspace() { show('analysisView'); }
function openDiagnostics() { renderDiagnostics(app.analysisResult); show('diagnosticsView'); }
function showDrilldown() { renderDrilldown(app, { selectRule }); show('drilldownView'); }
function openDrilldown(system) { app.selectedSystem = system; showDrilldown(); }
function selectEvent(id) { app.selectedEventId = id; renderServiceRadar(app, { selectEvent, openDrilldown }); }
function selectRule(id) { app.selectedRuleId = id; renderDrilldown(app, { selectRule }); }
function resetAnalysis() { cancelAnalysis(); app.autocollectFile = null; app.rulesFile = null; app.analysisResult = null; app.progress = null; app.selectedSystem = null; app.selectedEventId = null; app.selectedRuleId = null; $('autocollectInput').value = ''; $('rulesInput').value = ''; $('autocollectName').textContent = 'No file selected'; $('rulesName').textContent = 'No file selected'; setWorkspaceMode('upload'); showAnalysisWorkspace(); renderAnalysisWorkspace(); }

$('autocollectInput').addEventListener('change', e => { app.autocollectFile = e.target.files[0] || null; $('autocollectName').textContent = app.autocollectFile?.name || 'No file selected'; renderAnalysisWorkspace(); });
$('rulesInput').addEventListener('change', e => { app.rulesFile = e.target.files[0] || null; $('rulesName').textContent = app.rulesFile?.name || 'No file selected'; renderAnalysisWorkspace(); });
$('startAnalysis').onclick = startAnalysis;
$('cancelAnalysis').onclick = cancelAnalysis;
$('openRadar').onclick = showServiceRadar;
$('viewDiagnosticsReady').onclick = openDiagnostics;
$('viewDiagnosticsFailed').onclick = openDiagnostics;
$('diagnosticsFromAnalysis').onclick = openDiagnostics;
$('diagnosticsFromRadar').onclick = openDiagnostics;
$('diagnosticsFromDrill').onclick = openDiagnostics;
$('backToAnalysis').onclick = showAnalysisWorkspace;
$('backToRadar').onclick = showServiceRadar;
$('resetReady').onclick = resetAnalysis;
$('resetFailed').onclick = resetAnalysis;
$('resetFromRadar').onclick = resetAnalysis;
$('resetFromDiagnostics').onclick = resetAnalysis;
$('showIssues').onclick = () => { app.systemFilter = 'issues'; $('showIssues').setAttribute('aria-pressed', 'true'); $('showAllSystems').setAttribute('aria-pressed', 'false'); renderServiceRadar(app, { selectEvent, openDrilldown }); };
$('showAllSystems').onclick = () => { app.systemFilter = 'all'; $('showIssues').setAttribute('aria-pressed', 'false'); $('showAllSystems').setAttribute('aria-pressed', 'true'); renderServiceRadar(app, { selectEvent, openDrilldown }); };
$('closeDiagnostics').onclick = () => app.lastView === 'radar' ? showServiceRadar() : app.lastView === 'drilldown' ? showDrilldown() : showAnalysisWorkspace();

renderAnalysisWorkspace();
