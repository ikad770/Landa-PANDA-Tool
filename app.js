import { AUTH_CONFIG } from './config.js';
import { authenticateLocalPrototype, clearSession, createLocalSession, readStoredSession, storeSession, validateLoginFields } from './auth.js';
import { renderLoginShell, renderLoginValidation, setAccessGranted, setLoginAuthenticating } from './render-login.js';
import { renderAnalysisShell, updateProgressPresentation, updateUploadValidation } from './render-analysis.js';
import { chooseInitialSystem, renderDiagnostics, renderServiceRadar, validateAnalysisResult } from './render-radar.js';

const $ = id => document.getElementById(id);
const fmtDuration = ms => !Number.isFinite(ms) ? '—' : ms < 1000 ? '<1s' : ms < 60000 ? `${Math.round(ms / 1000)}s` : `${Math.round(ms / 60000)}m ${Math.round(ms % 60000 / 1000)}s`;

const app = { autocollectFile: null, rulesFile: null, worker: null, analysisResult: null, progress: null, selectedSystem: null, lastView: 'analysis', session: null, authLoading: false };
const loginState = { username: AUTH_CONFIG.username, password: '', touched: { username: false, password: false }, submitted: false, errors: {}, message: '' };

renderLoginShell($('loginView'));
renderAnalysisShell($('analysisView'));
app.session = readStoredSession();

function show(view) {
  ['loginView', 'analysisView', 'radarView', 'drilldownView', 'diagnosticsView'].forEach(id => $(id)?.classList.toggle('hidden', id !== view));
  if (view !== 'diagnosticsView') app.lastView = view.replace('View', '');
}

function syncLoginValidation(message = '') {
  const validation = validateLoginFields({ username: loginState.username, password: loginState.password });
  loginState.errors = validation.errors;
  renderLoginValidation({ errors: loginState.errors, message, touched: loginState.touched, submitted: loginState.submitted });
}

function submitLogin(event) {
  event.preventDefault();
  if (app.authLoading) return;
  loginState.submitted = true;
  const result = authenticateLocalPrototype({ username: loginState.username, password: loginState.password });
  if (!result.valid) { loginState.errors = result.errors || {}; syncLoginValidation(''); return; }
  if (!result.ok) { renderLoginValidation({ errors: {}, message: 'Invalid username or password.', touched: loginState.touched, submitted: true }); return; }
  app.authLoading = true;
  setLoginAuthenticating(true);
  window.setTimeout(() => {
    app.session = createLocalSession(result.username);
    storeSession(app.session);
    document.querySelectorAll('.user-pill').forEach(pill => { pill.textContent = app.session.username; });
    setAccessGranted(true);
    window.setTimeout(() => { app.authLoading = false; setLoginAuthenticating(false); setAccessGranted(false); showAnalysisWorkspace(); }, 250);
  }, 100);
}

function logout() {
  clearSession();
  app.session = null;
  resetAnalysis();
  show('loginView');
}

function renderAnalysisWorkspace() {
  const ready = !!(app.autocollectFile && app.rulesFile && !app.worker);
  $('startAnalysis').disabled = !ready;
  updateUploadValidation(!!(app.autocollectFile && app.rulesFile));
  $('diagnosticsFromAnalysis').classList.toggle('hidden', !app.analysisResult);
}

function setWorkspaceMode(mode) {
  $('uploadWorkspace').classList.toggle('hidden', mode !== 'upload');
  $('processingWorkspace').classList.toggle('hidden', mode !== 'processing');
  $('readyWorkspace').classList.toggle('hidden', mode !== 'ready');
  $('failedWorkspace').classList.toggle('hidden', mode !== 'failed');
}

function terminateWorker() {
  if (app.worker) app.worker.terminate();
  app.worker = null;
}

function startAnalysis() {
  if (!app.autocollectFile || !app.rulesFile) return;
  terminateWorker();
  app.analysisResult = null;
  app.progress = null;
  app.selectedSystem = null;
  setWorkspaceMode('processing');
  updateProgressPresentation({ stage: 'upload', stageLabel: 'Upload', overallPercent: 0, message: 'Starting V2 analysis.' });
  const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  app.worker = worker;
  worker.onmessage = event => handleWorkerMessage(event.data);
  worker.onerror = event => failAnalysis(event.message || 'Worker failed.');
  worker.postMessage({ type: 'start', autocollectFile: app.autocollectFile, rulesFile: app.rulesFile });
  renderAnalysisWorkspace();
}

function handleWorkerMessage(message) {
  if (message.type === 'progress') {
    app.progress = message.progress;
    renderProgress(message.progress);
    return;
  }
  if (message.type === 'complete') {
    terminateWorker();
    const result = message.analysisResult;
    const validation = validateAnalysisResult(result);
    if (!validation.valid) { failAnalysis(validation.reason); return; }
    app.analysisResult = result;
    app.analysisResult.validation = validation;
    app.selectedSystem = chooseInitialSystem(result);
    renderReady();
    setWorkspaceMode('ready');
    renderDiagnostics(result);
    renderAnalysisWorkspace();
    if ($('autoOpenToggle').checked) showResultsWorkspace();
    return;
  }
  if (message.type === 'error') {
    terminateWorker();
    app.analysisResult = { schemaVersion: '2.0', error: message.error, metadata: {}, summary: {}, diagnostics: { counts: { error: 1 }, recentEntries: [message.error] }, signalCatalog: [], parameterSummaries: [], systems: [], stateTimeline: [] };
    failAnalysis(`${message.error?.stage || 'analysis'}: ${message.message || 'Analysis failed.'}`);
  }
}

function renderProgress(progress) {
  updateProgressPresentation(progress);
  $('currentSource').textContent = progress.stageLabel || progress.stage || '—';
  $('currentFile').textContent = progress.message || '—';
  $('filesCount').textContent = `${progress.processed || 0} / ${progress.total || 0}`;
  $('relevantValues').textContent = progress.processed || 0;
  $('signalsMatched').textContent = progress.total || 0;
  $('elapsedTime').textContent = '—';
  $('remainingTime').textContent = '—';
  $('warningErrorCount').textContent = '0 / 0';
}

function renderReady() {
  const result = app.analysisResult;
  const s = result.summary;
  const meta = result.metadata;
  $('readyEyebrow').textContent = 'Analysis complete';
  $('readyTitle').textContent = 'V2 Results Workspace ready';
  $('readySubtitle').textContent = 'Stable bounded V2 result finalized. Open the Results Workspace to explore real uploaded signals.';
  $('readyRules').textContent = `${s.evaluatedSignals} / ${s.configuredSignals}`;
  $('readySignals').textContent = `${s.discoveredSignals}`;
  $('readyRelevantValues').textContent = `${s.criticalParameters}`;
  $('readyFullyEvaluated').textContent = `${result.systems.length}`;
  $('readyNeedsValidation').textContent = `${s.validationIssues}`;
  $('readySystems').textContent = `${s.configurationIssues}`;
  $('readyDeviations').textContent = `${s.warningParameters + s.criticalParameters}`;
  $('readyTime').textContent = fmtDuration(meta.durationMs);
  $('readyTopBlocker').textContent = s.noDataRules ? `${s.noDataRules} no-data rules` : 'None';
}

function failAnalysis(message) {
  terminateWorker();
  $('failedReason').textContent = message || 'Analysis could not produce a valid V2 result.';
  setWorkspaceMode('failed');
  renderAnalysisWorkspace();
}

function cancelAnalysis() {
  if (app.worker) app.worker.postMessage({ type: 'cancel' });
  terminateWorker();
  setWorkspaceMode('upload');
  renderAnalysisWorkspace();
}

function showAnalysisWorkspace() { show('analysisView'); }
function showResultsWorkspace() { if (app.analysisResult) renderServiceRadar(app); show('radarView'); }
function openDiagnostics() { renderDiagnostics(app.analysisResult); show('diagnosticsView'); }
function resetAnalysis() {
  cancelAnalysis();
  app.autocollectFile = null;
  app.rulesFile = null;
  app.analysisResult = null;
  app.progress = null;
  app.selectedSystem = null;
  $('autocollectInput').value = '';
  $('rulesInput').value = '';
  $('autocollectName').textContent = 'No file selected';
  $('rulesName').textContent = 'No file selected';
  setWorkspaceMode('upload');
  renderAnalysisWorkspace();
  showAnalysisWorkspace();
}

$('loginForm').addEventListener('submit', submitLogin);
$('forgotPassword').onclick = () => document.getElementById('forgotModal')?.classList.remove('hidden');
$('usernameInput').addEventListener('input', e => { loginState.username = e.target.value; loginState.message = ''; syncLoginValidation(''); });
$('passwordInput').addEventListener('input', e => { loginState.password = e.target.value; loginState.message = ''; syncLoginValidation(''); });
$('usernameInput').addEventListener('blur', () => { loginState.touched.username = true; syncLoginValidation(''); });
$('passwordInput').addEventListener('blur', () => { loginState.touched.password = true; syncLoginValidation(''); });
$('togglePassword').onclick = () => { const input = $('passwordInput'); const showing = input.type === 'text'; input.type = showing ? 'password' : 'text'; $('togglePassword').setAttribute('aria-pressed', String(!showing)); $('togglePassword').setAttribute('aria-label', showing ? 'Show password' : 'Hide password'); };
document.querySelectorAll('[data-close-modal]').forEach(button => button.addEventListener('click', () => button.closest('.modal-backdrop')?.classList.add('hidden')));
$('logoutButton').onclick = logout;
$('autocollectInput').addEventListener('change', e => { app.autocollectFile = e.target.files[0] || null; $('autocollectName').textContent = app.autocollectFile?.name || 'No file selected'; renderAnalysisWorkspace(); });
$('rulesInput').addEventListener('change', e => { app.rulesFile = e.target.files[0] || null; $('rulesName').textContent = app.rulesFile?.name || 'No file selected'; renderAnalysisWorkspace(); });
$('startAnalysis').onclick = startAnalysis;
$('cancelAnalysis').onclick = cancelAnalysis;
$('openRadar').onclick = showResultsWorkspace;
$('viewDiagnosticsReady').onclick = openDiagnostics;
$('viewDiagnosticsFailed').onclick = openDiagnostics;
$('diagnosticsFromAnalysis').onclick = openDiagnostics;
$('resetReady').onclick = resetAnalysis;
$('resetFailed').onclick = resetAnalysis;
$('resetUpload').onclick = resetAnalysis;
$('closeDiagnostics').onclick = () => app.lastView === 'radar' ? showResultsWorkspace() : showAnalysisWorkspace();
window.addEventListener('panda:navigate-analysis', showAnalysisWorkspace);
window.addEventListener('panda:diagnostics', openDiagnostics);
window.addEventListener('panda:reset', resetAnalysis);

syncLoginValidation('');
renderAnalysisWorkspace();
if (app.session) { document.querySelectorAll('.user-pill').forEach(pill => { pill.textContent = app.session.username || AUTH_CONFIG.username; }); showAnalysisWorkspace(); } else { show('loginView'); }
