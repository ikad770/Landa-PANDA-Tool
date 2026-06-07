import { STATUS_LABEL, STATUS_PRIORITY, STATUS_TAXONOMY } from './config.js';
import { formatRange } from './evaluation.js';
import { buildServiceDecision } from './service-decision.js';

export const STATUS_META = STATUS_TAXONOMY;

const TAXONOMY = new Set(Object.keys(STATUS_META));
export const OPERATIONAL_STATUSES = new Set(['critical', 'warning']);
export const ISSUE_STATUSES = new Set(['critical', 'warning', 'needs_validation', 'needs_configuration']);

export const $ = id => document.getElementById(id);
export const statusClass = status => STATUS_META[normalizeStatus(status)]?.cssClass || normalizeStatus(status).replace(/_/g, '-');
export const fmtNum = value => Number.isFinite(value) ? Number(value).toFixed(Math.abs(value) >= 100 ? 1 : 2).replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1') : '—';
export const fmtTime = ms => Number.isFinite(ms) ? new Date(ms).toLocaleString() : '—';
export const fmtShortTime = ms => Number.isFinite(ms) ? new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
export const fmtDuration = ms => !Number.isFinite(ms) ? '—' : ms < 1000 ? '<1s' : ms < 60000 ? `${Math.round(ms / 1000)}s` : ms < 3600000 ? `${Math.round(ms / 60000)}m` : `${(ms / 3600000).toFixed(1)}h`;
export const compactNumber = value => !Number.isFinite(value) ? '0' : Math.abs(value) >= 1000000 ? `${(value / 1000000).toFixed(1)}M` : Math.abs(value) >= 1000 ? `${(value / 1000).toFixed(1)}K` : String(value);

export function normalizeStatus(status) {
  if (status === 'evaluator_pending') return 'needs_validation';
  return TAXONOMY.has(status) ? status : 'no_data';
}

export function statusLabel(status) {
  const normalized = normalizeStatus(status);
  return STATUS_META[normalized]?.label || STATUS_LABEL[status] || status || 'No data';
}

export function shortStatusLabel(status) {
  return STATUS_META[normalizeStatus(status)]?.shortLabel || statusLabel(status);
}

export function statusIcon(status) {
  return STATUS_META[normalizeStatus(status)]?.icon || '○';
}

export function getServiceDecision(result) {
  if (!result) return buildServiceDecision({});
  return result.serviceDecision || buildServiceDecision(result);
}

export function priority(status) {
  return STATUS_PRIORITY[normalizeStatus(status)] ?? 0;
}

export function chooseInitialSystem(result) {
  const decision = getServiceDecision(result);
  if (decision.primarySystem) return decision.primarySystem;
  const health = result?.systemHealth || [];
  const order = ['critical', 'warning', 'needs_validation', 'needs_configuration', 'ok', 'no_data', 'no_rule'];
  for (const status of order) {
    const found = health.find(item => normalizeStatus(item.status) === status && (status !== 'no_data' || (item.rules || 0) > 0));
    if (found) return found.system;
  }
  return health[0]?.system || null;
}

export function chooseInitialParameter(result, system) {
  const rows = (result?.signalSummaries || []).filter(row => !system || row.system === system);
  return rows.sort((a, b) => priority(b.status) - priority(a.status) || (b.eventCount || 0) - (a.eventCount || 0))[0] || null;
}

export function validateAnalysisResult(result) {
  const required = ['metadata', 'systemHealth', 'deviationEvents', 'signalSummaries', 'chartSeries', 'stateTimeline', 'diagnosticsSummary'];
  const missing = required.filter(key => !(key in (result || {})));
  if (missing.length) return { valid: false, reason: `Invalid AnalysisResult. Missing: ${missing.join(', ')}` };
  if (!Array.isArray(result.systemHealth) || !Array.isArray(result.deviationEvents) || !Array.isArray(result.signalSummaries)) return { valid: false, reason: 'Invalid AnalysisResult collection schema.' };
  if (!result.metadata.rulesValid) return { valid: false, reason: 'No valid rules are available for evaluation.' };
  if (!result.metadata.relevantValuesFound) return { valid: false, reason: result.metadata.blockingReason || 'No relevant source values were found.' };
  if (!result.metadata.classifiedPoints) return { valid: false, reason: result.metadata.blockingReason || 'Matching source rows were found, but no evaluation classification was produced.' };
  if ((result.metadata.blockedPoints || 0) > 0) return { valid: true, status: 'completed_with_warnings', reason: 'Matching values were found, but some or all evaluations require validation or configuration.' };
  return { valid: true, status: 'completed', reason: '' };
}

export function renderStatusBadge(status, text = statusLabel(status), extraClass = '') {
  const normalized = normalizeStatus(status);
  return `<span class="status-badge ${statusClass(normalized)} ${extraClass}"><span class="status-icon">${statusIcon(normalized)}</span><span>${escapeHtml(text)}</span></span>`;
}

export function renderKpiCard({ label, value, subtitle, status = 'not_analyzed', icon = null } = {}) {
  return `<article class="kpi-card ${statusClass(status)}"><div class="kpi-icon">${escapeHtml(icon || statusIcon(status))}</div><span>${escapeHtml(label || 'Metric')}</span><strong>${escapeHtml(value ?? '—')}</strong><small>${escapeHtml(subtitle || '')}</small></article>`;
}

export function hasExpectedRange(item = {}) {
  return Number.isFinite(item.expectedLow) || Number.isFinite(item.expectedHigh);
}

export function expectedText(item = {}) {
  return hasExpectedRange(item) ? formatRange(item.expectedLow, item.expectedHigh) : 'Expected range not configured';
}

export function deviationText(actual, item = {}) {
  if (!Number.isFinite(actual) || !hasExpectedRange(item)) return '—';
  if (Number.isFinite(item.expectedLow) && actual < item.expectedLow) return `-${fmtNum(item.expectedLow - actual)}`;
  if (Number.isFinite(item.expectedHigh) && actual > item.expectedHigh) return `+${fmtNum(actual - item.expectedHigh)}`;
  return 'Within range';
}

function rangeBounds(opts) {
  const nums = [opts.actual, opts.expectedLow, opts.expectedHigh, opts.warningLow, opts.warningHigh, opts.criticalLow, opts.criticalHigh].filter(Number.isFinite);
  if (!nums.length) return null;
  let min = Math.min(...nums);
  let max = Math.max(...nums);
  const span = max - min || Math.max(1, Math.abs(max) || 1);
  min -= span * 0.16;
  max += span * 0.16;
  return { min, max, span: max - min || 1 };
}

const pct = (value, bounds) => Math.max(0, Math.min(100, ((value - bounds.min) / bounds.span) * 100));

export function renderComparisonGauge(options = {}) {
  const opts = { ...options };
  const actual = Number(opts.actual);
  const hasActual = Number.isFinite(actual);
  const configured = Number.isFinite(opts.expectedLow) || Number.isFinite(opts.expectedHigh);
  if (!configured) {
    return `<div class="comparison-gauge gauge-missing ${statusClass(opts.status)}">
      <div class="gauge-config"><strong>${hasActual ? `${fmtNum(actual)} ${opts.unit || ''}`.trim() : 'Actual unavailable'}</strong><span>Expected range not configured</span><small>Configure Expected and Tolerance in the Rules Excel before judging pass/fail.</small></div>
    </div>`;
  }
  const bounds = rangeBounds(opts);
  if (!bounds) return renderEmptyState('No values available', 'No actual value or expected range was provided for this rule.', 'no_data');
  const expectedLow = Number.isFinite(opts.expectedLow) ? opts.expectedLow : bounds.min;
  const expectedHigh = Number.isFinite(opts.expectedHigh) ? opts.expectedHigh : bounds.max;
  const lowLabel = Number.isFinite(opts.criticalLow) ? opts.criticalLow : Number.isFinite(opts.warningLow) ? opts.warningLow : expectedLow;
  const highLabel = Number.isFinite(opts.criticalHigh) ? opts.criticalHigh : Number.isFinite(opts.warningHigh) ? opts.warningHigh : expectedHigh;
  const marker = hasActual ? pct(actual, bounds) : 50;
  const expectedMarker = Number.isFinite(opts.expected ?? opts.expectedValue) ? pct(opts.expected ?? opts.expectedValue, bounds) : pct((expectedLow + expectedHigh) / 2, bounds);
  return `<div class="comparison-gauge ${statusClass(opts.status)} ${Number.isFinite(opts.criticalLow) || Number.isFinite(opts.criticalHigh) ? 'has-critical' : ''}" role="img" aria-label="Actual versus expected comparison">
    <div class="gauge-track">
      <span class="gauge-zone critical-low" style="left:0;width:${pct(Number.isFinite(opts.warningLow) ? opts.warningLow : expectedLow, bounds)}%"></span>
      <span class="gauge-zone expected" style="left:${pct(expectedLow, bounds)}%;width:${Math.max(2, pct(expectedHigh, bounds) - pct(expectedLow, bounds))}%"></span>
      <span class="gauge-zone critical-high" style="left:${pct(Number.isFinite(opts.warningHigh) ? opts.warningHigh : expectedHigh, bounds)}%;right:0"></span>
      <span class="gauge-expected-marker" style="left:${expectedMarker}%"><b>${fmtNum(opts.expected ?? opts.expectedValue)}</b></span>${hasActual ? `<span class="gauge-marker" style="left:${marker}%"><b>${fmtNum(actual)}${opts.unit ? ` ${opts.unit}` : ''}</b></span>` : ''}
    </div>
    <div class="gauge-labels"><span>${fmtNum(lowLabel)}</span><strong>Expected ${formatRange(opts.expectedLow, opts.expectedHigh)}</strong><span>${fmtNum(highLabel)}</span></div>
  </div>`;
}

export function renderSystemHealthDonut(health = {}, summaries = []) {
  const counts = { critical: 0, warning: 0, needs_validation: 0, needs_configuration: 0, ok: 0, no_data: 0 };
  summaries.forEach(row => { counts[normalizeStatus(row.status)] = (counts[normalizeStatus(row.status)] || 0) + 1; });
  const total = Math.max(1, Object.values(counts).reduce((sum, value) => sum + value, 0));
  let offset = 0;
  const segments = Object.entries(counts).map(([status, count]) => {
    const width = (count / total) * 100;
    const html = `<span class="score-segment ${statusClass(status)}" style="left:${offset}%;width:${width}%"></span>`;
    offset += width;
    return html;
  }).join('');
  const matched = summaries.filter(row => (row.matchedRows || 0) > 0).length;
  const missing = Math.max(0, (health.rules || summaries.length || 0) - matched);
  return `<div class="system-scorecard">
    <div class="score-header">${renderStatusBadge(health.status)}<strong>${health.system || 'System'}</strong></div>
    <div class="score-bar">${segments}</div>
    <div class="score-grid"><span>${health.rules || summaries.length || 0} rules</span><span>${matched} signals matched</span><span>${health.evaluated || 0} fully evaluated</span><span>${counts.needs_validation || 0} needs validation</span><span>${counts.needs_configuration || 0} needs configuration</span><span>${missing} missing signal</span></div>
  </div>`;
}

export function groupParameters(summaries = []) {
  const groups = [
    { key: 'critical', label: 'Critical', statuses: ['critical'], rows: [] },
    { key: 'warning', label: 'Warning', statuses: ['warning'], rows: [] },
    { key: 'validation', label: 'Needs Validation', statuses: ['needs_validation'], rows: [] },
    { key: 'configuration', label: 'Needs Configuration', statuses: ['needs_configuration'], rows: [] },
    { key: 'healthy', label: 'Healthy', statuses: ['ok'], rows: [] },
    { key: 'no_data', label: 'No Data', statuses: ['no_data', 'no_rule', 'not_analyzed'], rows: [] }
  ];
  summaries.forEach(row => {
    const status = normalizeStatus(row.status);
    const group = groups.find(item => item.statuses.includes(status)) || groups.at(-1);
    group.rows.push(row);
  });
  groups.forEach(group => group.rows.sort((a, b) => priority(b.status) - priority(a.status) || String(a.signal).localeCompare(String(b.signal))));
  return groups;
}

export function renderParameterCard(row, selectedId) {
  return `<button class="param-card ${statusClass(row.status)}" data-rule="${escapeAttr(row.ruleId)}" aria-pressed="${row.ruleId === selectedId}">
    <span class="param-status">${statusIcon(row.status)}</span>
    <span class="param-main"><b>${escapeHtml(row.signal || 'Unnamed signal')}</b><small>${escapeHtml(row.component || row.subsystem || 'No component')}</small></span>
    <span class="param-side"><b>${fmtNum(row.latestActual)}</b><small>${expectedText(row)}</small><small>${row.eventCount || 0} events · ${fmtDuration(row.totalDeviationDurationMs)}</small></span>
  </button>`;
}

export function renderStateTimeline({ stateTimeline = [], events = [], selectedEventId = null, onEvent = false } = {}) {
  const timestamps = [...stateTimeline.flatMap(row => [row.startMs, row.endMs]), ...events.flatMap(row => [row.startTimestampMs, row.endTimestampMs])].filter(Number.isFinite);
  if (!timestamps.length) return renderEmptyState('Machine state unavailable', 'Actual values remain visible, but state context was not present in the current AnalysisResult.', 'needs_validation');
  const start = Math.min(...timestamps);
  const end = Math.max(...timestamps);
  const span = end - start || 1;
  const stateSegments = stateTimeline.map(row => `<span class="state-segment state-${slug(row.label)}" title="${escapeAttr(row.label || 'State')}" style="left:${((row.startMs - start) / span) * 100}%;width:${Math.max(1, ((row.endMs - row.startMs) / span) * 100)}%"></span>`).join('');
  const markers = events.slice(0, 40).map(event => `<button class="timeline-marker ${statusClass(event.severity)}" ${onEvent ? `data-event="${escapeAttr(event.id)}"` : ''} title="${escapeAttr(`${fmtTime(event.startTimestampMs)} · ${event.system} · ${event.signal}`)}" style="left:${((event.startTimestampMs - start) / span) * 100}%" aria-pressed="${event.id === selectedEventId}">${statusIcon(event.severity)}</button>`).join('');
  return `<div class="state-timeline"><div class="state-strip">${stateSegments}</div><div class="timeline-events">${markers}</div><div class="time-axis"><span>${fmtShortTime(start)}</span><span>${fmtShortTime(end)}</span></div></div>`;
}

export function renderActualExpectedChart(chart = [], selected = {}, events = []) {
  const samples = chart.filter(point => Number.isFinite(point.actual)).sort((a, b) => (a.t || 0) - (b.t || 0));
  if (!samples.length) return renderEmptyState('No chart samples available', 'The parameter has no numeric samples in the current AnalysisResult.', 'no_data');
  const expectedValues = samples.flatMap(point => [point.expectedLow, point.expectedHigh, point.expectedValue, point.expected]).filter(Number.isFinite);
  const values = [...samples.map(point => point.actual), ...expectedValues];
  let min = Math.min(...values), max = Math.max(...values);
  const spanY = max - min || Math.max(1, Math.abs(max) || 1);
  min -= spanY * 0.12; max += spanY * 0.12;
  const first = samples[0].t ?? 0;
  const last = samples.at(-1).t ?? first + samples.length - 1;
  const spanX = last - first || 1;
  const x = (point, idx) => Number.isFinite(point.t) ? 56 + ((point.t - first) / spanX) * 704 : 56 + (idx / Math.max(1, samples.length - 1)) * 704;
  const y = value => 310 - ((value - min) / (max - min || 1)) * 250;
  const actualPath = samples.map((point, idx) => `${idx ? 'L' : 'M'} ${x(point, idx).toFixed(1)} ${y(point.actual).toFixed(1)}`).join(' ');
  const expectedSamples = samples.filter(point => Number.isFinite(point.expectedLow) && Number.isFinite(point.expectedHigh));
  const hasRange = expectedSamples.length > 0;
  const band = hasRange ? expectedSamples.slice(0, -1).map((point, idx) => {
    const next = expectedSamples[idx + 1];
    const x1 = x(point, samples.indexOf(point));
    const x2 = x(next, samples.indexOf(next));
    return `<polygon class="expected-band" points="${x1.toFixed(1)},${y(point.expectedHigh).toFixed(1)} ${x2.toFixed(1)},${y(point.expectedHigh).toFixed(1)} ${x2.toFixed(1)},${y(point.expectedLow).toFixed(1)} ${x1.toFixed(1)},${y(point.expectedLow).toFixed(1)}"></polygon>`;
  }).join('') : '';
  const expectedPath = samples.filter(point => Number.isFinite(point.expectedValue ?? point.expected)).map((point, idx) => `${idx ? 'L' : 'M'} ${x(point, samples.indexOf(point)).toFixed(1)} ${y(point.expectedValue ?? point.expected).toFixed(1)}`).join(' ');
  const stateLines = samples.filter((point, idx) => idx > 0 && (point.machineState !== samples[idx - 1].machineState || point.systemState !== samples[idx - 1].systemState)).slice(0, 80).map(point => `<line class="state-divider" x1="${x(point, samples.indexOf(point)).toFixed(1)}" x2="${x(point, samples.indexOf(point)).toFixed(1)}" y1="46" y2="330"><title>${escapeHtml(point.machineState || point.systemState || 'State transition')}</title></line>`).join('');
  const stateStrip = samples.slice(0, -1).filter((point, idx) => idx === 0 || point.machineState !== samples[idx - 1].machineState).slice(0, 80).map((point, idx, rows) => {
    const next = rows[idx + 1] || samples.at(-1);
    const left = x(point, samples.indexOf(point));
    const right = x(next, samples.indexOf(next));
    return `<rect class="state-band state-${slug(point.machineState || point.systemState)}" x="${left.toFixed(1)}" y="334" width="${Math.max(2, right - left).toFixed(1)}" height="12"><title>${escapeHtml(point.machineState || point.systemState || 'State')}</title></rect>`;
  }).join('');
  const eventMarkers = events.slice(0, 24).map(event => `<line class="chart-event ${statusClass(event.severity)}" x1="${56 + ((event.startTimestampMs - first) / spanX) * 704}" x2="${56 + ((event.startTimestampMs - first) / spanX) * 704}" y1="46" y2="330"><title>${escapeHtml(`${fmtTime(event.startTimestampMs)} ${event.severity}`)}</title></line>`).join('');
  const points = samples.filter(point => ['warning', 'critical'].includes(normalizeStatus(point.status))).slice(0, 120).map((point, idx) => `<circle class="chart-point ${statusClass(point.status)}" cx="${x(point, samples.indexOf(point)).toFixed(1)}" cy="${y(point.actual).toFixed(1)}" r="3"><title>${escapeHtml(`${fmtTime(point.t)}\nState: ${point.machineState || '—'}\nSystem State: ${point.systemState || '—'}\nActual: ${fmtNum(point.actual)}${selected.unit || ''}\nExpected: ${fmtNum(point.expectedValue ?? point.expected)}${selected.unit || ''}\nAllowed: ${formatRange(point.expectedLow, point.expectedHigh)}${selected.unit || ''}\nDeviation: ${point.deviationDirection === 'below' ? '-' : point.deviationDirection === 'above' ? '+' : ''}${fmtNum(Math.abs(point.deviation || 0))}${selected.unit || ''}\nStatus: ${statusLabel(point.status)}`)}</title></circle>`).join('');
  return `<div class="chart-shell">
    ${!hasRange ? '<div class="chart-banner needs-configuration">Expected range is not configured for this rule.</div>' : ''}
    ${selected.stateContextStatus === 'missing' || selected.blocker === 'missing_state' ? '<div class="chart-banner needs-validation">Machine State context is unavailable; chart still shows actual values.</div>' : ''}
    <svg class="actual-expected-chart" viewBox="0 0 820 380" role="img" aria-label="Actual versus expected chart">
      <line class="chart-axis" x1="56" x2="760" y1="330" y2="330"></line><line class="chart-axis" x1="56" x2="56" y1="40" y2="330"></line>
      ${band}${expectedPath ? `<path class="expected-value-line" d="${expectedPath}"></path>` : ''}${stateLines}${eventMarkers}<path class="actual-line" d="${actualPath}"></path>${points}${stateStrip}
      <text x="56" y="26">Actual vs state-dependent Expected</text><text x="56" y="356">${fmtShortTime(first)}</text><text x="704" y="356">${fmtShortTime(last)}</text>
    </svg>
  </div>`;
}

export function renderEmptyState(title, message, status = 'not_analyzed') {
  return `<div class="empty-state ${statusClass(status)}">${renderStatusBadge(status)}<h2>${escapeHtml(title)}</h2><p>${escapeHtml(message)}</p></div>`;
}

export function renderFindingItem(item = {}) {
  const status = normalizeStatus(item.severity || item.status);
  return `<div class="finding-item ${statusClass(status)}"><span>${statusIcon(status)}</span><b>${fmtTime(item.startTimestampMs || item.timestampMs)}</b><strong>${escapeHtml(item.system || 'System')} · ${escapeHtml(item.signal || 'Signal')}</strong><small>Actual ${fmtNum(item.latestActual ?? item.actual)} vs ${escapeHtml(expectedText(item))}</small></div>`;
}

export function renderActionItem(item = {}, index = 0) {
  const status = normalizeStatus(item.status || item.severity);
  return `<div class="action-row-card ${statusClass(status)}"><span class="priority-number">${index + 1}</span><div><strong>${escapeHtml(item.action || item.text || 'Review selected condition.')}</strong><small>${escapeHtml(item.impact || statusLabel(status))} · ${escapeHtml(item.system || 'Machine')}</small></div></div>`;
}

export function renderRuleSummary(item = {}) {
  const missing = hasExpectedRange(item) ? '' : '<small class="missing-field">Missing: Expected value / Spec Tolerance</small>';
  return `<div class="compact-item ${statusClass(item.status)}"><strong>Excel row ${escapeHtml(item.ruleRow || '—')}</strong><small>${escapeHtml(item.system || 'System')} · ${escapeHtml(item.subsystem || 'No subsystem')}</small><small>Source: ${escapeHtml(item.source || item.sourceType || '—')}</small><small>Signal: ${escapeHtml(item.signal || '—')}</small><small>Check: ${escapeHtml(item.checkType || 'Configured rule')}</small><small>Expected: ${escapeHtml(expectedText(item))}</small>${missing}<small>Action: ${escapeHtml(item.recommendedAction || item.latestReason || blockerLabel(item.blocker))}</small></div>`;
}

export function blockerLabel(blocker) {
  return ({ invalid_timestamp: 'Invalid timestamp prevents evaluation.', missing_state: 'Missing Machine State prevents state-dependent evaluation.', missing_expected_value: 'Expected range is not configured.', missing_threshold_or_tolerance: 'Tolerance or thresholds are missing in the Rules Excel.', unsupported_evaluator: 'This check type needs evaluator support.', no_numeric_value: 'No numeric actual value was found.' })[blocker] || 'Evaluation details are not available.';
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

export function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

export function slug(value) {
  return String(value || 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '-');
}
