import { $, blockerLabel, chooseInitialParameter, chooseInitialSystem, deviationText, escapeAttr, escapeHtml, expectedText, fmtDuration, fmtNum, fmtTime, getServiceDecision, normalizeStatus, priority, renderActualExpectedChart, renderEmptyState, renderStatusBadge, statusClass, statusIcon, statusLabel } from './render.js';

const STATE_ORDER = ['ON', 'Standby', 'Ready', 'Prepare2Print', 'Printing', 'PrintEnd', 'Recovery', 'Error'];
const NAV_GROUPS = [
  ['critical', 'Critical'],
  ['warning', 'Warning'],
  ['ok', 'OK'],
  ['needs_configuration', 'Needs Configuration'],
  ['needs_validation', 'Needs Validation'],
  ['no_data', 'No Data']
];

export function renderDrilldown(app, handlers) {
  const result = app.analysisResult;
  if (!result) {
    $('drilldownRoot').innerHTML = renderEmptyState('No analysis loaded', 'Run an analysis before opening Drill-Down.', 'not_analyzed');
    return;
  }
  const decision = getServiceDecision(result);
  const system = app.selectedSystem || decision.primarySystem || chooseInitialSystem(result);
  app.selectedSystem = system;
  const health = (decision.systemSummaries || result.systemHealth || []).find(item => item.system === system) || { system, status: 'no_rule', label: 'Rules not configured' };
  const summaries = sortComparisonRows((result.signalSummaries || decision.parameterSummaries || []).filter(item => item.system === system));
  const selected = summaries.find(item => item.ruleId === app.selectedRuleId) || chooseInitialParameter({ signalSummaries: summaries }, system);
  if (selected && app.selectedRuleId !== selected.ruleId) app.selectedRuleId = selected.ruleId;
  const chart = selected ? (selected.chartPoints || result.chartSeries?.[selected.ruleId] || []) : [];
  const events = selected ? (decision.deviationEvents || result.deviationEvents || []).filter(event => event.system === selected.system && event.signal === selected.signal).sort((a, b) => (b.endTimestampMs || 0) - (a.endTimestampMs || 0)) : [];
  $('drillSubtitle').textContent = `${system || 'No system selected'} · ${statusLabel(health.status)} · ${result.metadata?.timeRange || 'No evaluated time range'}`;
  $('drilldownRoot').innerHTML = `
    <section class="drill-shell">
      ${renderDrillHeader(result, system)}
      ${renderSystemScorecard(health, summaries)}
      <section class="drill-grid">
        <aside class="parameter-navigator panel">${renderParameterNavigator(summaries, selected?.ruleId)}</aside>
        <main class="parameter-analysis panel">${selected ? `${renderSelectedParameterHeader(selected)}${renderActualExpectedChart(chart, selected, events)}` : renderEmptyState('No parameter selected', 'This system has no parameter summaries in the AnalysisResult.', health.status)}</main>
        <aside class="parameter-summary panel">${selected ? renderParameterSummary(selected, events) : renderEmptyState('No summary available', 'Choose a parameter from the navigator.', health.status)}</aside>
      </section>
      <section class="drill-bottom-grid">
        <div class="panel">${selected ? renderStateComparisonTable(selected) : renderEmptyState('No state comparison', 'Choose a parameter first.', 'not_analyzed')}</div>
        <div class="panel">${selected ? renderRecentDeviations(events) : renderEmptyState('No deviations', 'Choose a parameter first.', 'not_analyzed')}</div>
      </section>
    </section>`;
  $('drilldownRoot').querySelectorAll('[data-rule]').forEach(el => el.addEventListener('click', () => handlers.selectRule(el.dataset.rule)));
}

function renderDrillHeader(result, system) {
  return `<header class="drill-header">
    <div><b class="brand-mark">Landa / PANDA</b><span>Service Radar › System Drill-Down</span><strong>${escapeHtml(system || 'System')}</strong></div>
    <div class="drill-header-actions"><span>${escapeHtml(result.metadata?.timeRange || 'No evaluated time range')}</span><button class="ghost" type="button" id="backToRadar" onclick="document.querySelector('[data-view=radar]')?.click()">Back to Radar</button><button class="ghost" type="button" onclick="document.getElementById('diagnosticsModal')?.showModal?.()">Diagnostics</button></div>
  </header>`;
}

function renderSystemScorecard(health = {}, summaries = []) {
  const counts = countStatuses(summaries);
  const configValidation = counts.needs_configuration + counts.needs_validation;
  return `<section class="system-scorecard drill-scorecard ${statusClass(health.status)}">
    <div class="score-system"><span>System</span><h1>${escapeHtml(health.system || 'System')}</h1>${renderStatusBadge(health.status)}</div>
    ${score('Total parameters', summaries.length)}${score('Evaluated', counts.ok + counts.warning + counts.critical)}${score('Critical', counts.critical, 'critical')}${score('Warning', counts.warning, 'warning')}${score('OK', counts.ok, 'ok')}${score('No Data', counts.no_data, 'no-data')}${score('No Rule', counts.no_rule, 'no-rule')}${score('Config / Validation', configValidation, configValidation ? 'needs-configuration' : 'ok')}
  </section>`;
}

function score(label, value, status = '') {
  return `<div class="score-tile ${status}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function countStatuses(rows) {
  const counts = { critical: 0, warning: 0, ok: 0, needs_configuration: 0, needs_validation: 0, no_data: 0, no_rule: 0, not_analyzed: 0 };
  rows.forEach(row => { counts[normalizeStatus(row.status)] = (counts[normalizeStatus(row.status)] || 0) + 1; });
  return counts;
}

export function renderParameterNavigator(summaries = [], selectedId = '') {
  const groups = NAV_GROUPS.map(([status, label]) => ({ status, label, rows: summaries.filter(row => normalizeStatus(row.status) === status || (status === 'no_data' && ['no_rule', 'not_analyzed'].includes(normalizeStatus(row.status)))) }));
  return `<div class="navigator-head"><div><h2>Parameter Navigator</h2><span>${summaries.length} parameters</span></div><button type="button" class="text-button">Show All Parameters</button></div>
    <div class="navigator-scroll">${groups.map(group => `<section class="nav-group"><h3>${escapeHtml(group.label)} <b>${group.rows.length}</b></h3>${group.rows.map(row => renderNavigatorRow(row, selectedId)).join('') || '<p class="nav-empty">No parameters</p>'}</section>`).join('')}</div>`;
}

function renderNavigatorRow(row, selectedId) {
  return `<button class="nav-row ${statusClass(row.status)}" data-rule="${escapeAttr(row.ruleId)}" aria-pressed="${row.ruleId === selectedId}"><span class="dot">${statusIcon(row.status)}</span><span class="name" title="${escapeAttr(row.parameterName || row.signal)}">${escapeHtml(row.parameterName || row.signal)}</span><span class="actual">${fmtNum(row.latestActual)}</span><span class="unit">${escapeHtml(row.unit || '')}</span></button>`;
}

export function renderSelectedParameterHeader(selected) {
  const activeState = selected.currentSystemState || selected.currentMachineState || '—';
  const diff = deviationText(selected.averageActual ?? selected.latestActual, { expectedLow: selected.allowedLow ?? selected.expectedLow, expectedHigh: selected.allowedHigh ?? selected.expectedHigh });
  return `<section class="selected-parameter-header ${statusClass(selected.status)}"><div class="selected-title"><div><h2>${escapeHtml(selected.parameterName || selected.signal)}</h2><p>${escapeHtml(selected.component || selected.subsystem || 'No component')}</p></div>${renderStatusBadge(selected.status)}</div><div class="comparison-strip">
    ${strip('Actual Avg', unitValue(selected.averageActual ?? selected.latestActual, selected.unit))}
    ${strip(`Expected ${activeState}`, unitValue(selected.expectedValue ?? selected.expected, selected.unit))}
    ${strip('Allowed Range', rangeText(selected.allowedLow ?? selected.expectedLow, selected.allowedHigh ?? selected.expectedHigh, selected.unit))}
    ${strip('Average Difference', diff)}
    ${strip('Out of Range', `${fmtNum(maxOutOfRange(selected))}%`)}
    ${strip('State', activeState)}
    ${strip('Rule', selected.ruleRow ? `Row ${selected.ruleRow}` : '—')}
  </div></section>`;
}

function strip(label, value) { return `<div><label>${escapeHtml(label)}</label><strong>${escapeHtml(value)}</strong></div>`; }
function unitValue(value, unit = '') { return Number.isFinite(value) ? `${fmtNum(value)}${unit ? ` ${unit}` : ''}` : '—'; }
function rangeText(low, high, unit = '') { return Number.isFinite(low) || Number.isFinite(high) ? `${Number.isFinite(low) ? fmtNum(low) : '—'}–${Number.isFinite(high) ? fmtNum(high) : '—'}${unit ? ` ${unit}` : ''}` : 'Not configured'; }
function maxOutOfRange(selected = {}) { return Math.max(0, ...(selected.stateSummaries || []).map(row => row.outOfRangePercent || 0)); }

export function renderParameterSummary(selected, events = []) {
  const first = events.at(-1);
  const last = events[0];
  const maxDeviation = Math.max(0, ...events.map(event => Math.abs(event.maximumDeviation || 0)));
  let minDeviation = null;
  for (const event of events) { const value = Math.abs(event.maximumDeviation || 0); if (Number.isFinite(value)) minDeviation = minDeviation === null ? value : Math.min(minDeviation, value); }
  return `<div class="summary-panel"><h2>Parameter Summary</h2>${fact('Component', selected.component || selected.subsystem)}${fact('Signal Source', selected.sourceFile || selected.signal)}${fact('Current Machine State', selected.currentMachineState)}${fact('Current System State', selected.currentSystemState)}${fact('First Deviation', fmtTime(first?.startTimestampMs ?? selected.stateSummaries?.find(row => row.firstDeviation)?.firstDeviation))}${fact('Last Deviation', fmtTime(last?.endTimestampMs ?? selected.stateSummaries?.find(row => row.lastDeviation)?.lastDeviation))}${fact('Total Duration Out of Range', fmtDuration(selected.totalDeviationDurationMs || events.reduce((sum, event) => sum + (event.durationMs || 0), 0)))}${fact('Maximum Deviation', Number.isFinite(maxDeviation) && maxDeviation ? unitValue(maxDeviation, selected.unit) : '—')}${fact('Minimum Deviation', Number.isFinite(minDeviation) ? unitValue(minDeviation, selected.unit) : '—')}${fact('Impact', statusLabel(selected.status))}<div class="action-box ${statusClass(selected.status)}"><strong>Recommended Action</strong><p>${escapeHtml(recommendedAction(selected))}</p></div></div>`;
}

function fact(label, value) { return `<div class="fact"><label>${escapeHtml(label)}</label><b>${escapeHtml(value ?? '—')}</b></div>`; }

function recommendedAction(selected) {
  if (normalizeStatus(selected.status) === 'needs_configuration') return `Complete Expected / Tolerance configuration in Excel row ${selected.ruleRow || '—'}.`;
  return selected.recommendedAction || 'No service action configured for this rule.';
}

export function renderStateComparisonTable(selected) {
  const rows = sortStateRows(selected.stateSummaries || []);
  if (!rows.length) return renderEmptyState('No state comparison available', 'No valid timestamped samples were summarized for this parameter.', 'no_data');
  return `<div class="table-panel"><div class="panel-title"><h2>State Comparison</h2></div><div class="state-table scroll-table"><table><thead><tr><th>State</th><th>Time in State</th><th>Expected Target</th><th>Allowed Range</th><th>Average Actual</th><th>Min</th><th>Max</th><th>Out-of-Range %</th><th>Out-of-Range Duration</th><th>Status</th></tr></thead><tbody>${rows.map(row => `<tr class="${statusClass(row.status)}"><td>${escapeHtml(displayState(row.state))}</td><td>${fmtDuration(row.timeInStateMs)}</td><td>${fmtNum(row.expected)}</td><td>${escapeHtml(rangeText(row.allowedLow, row.allowedHigh, selected.unit))}</td><td>${unitValue(row.averageActual, selected.unit)}</td><td>${unitValue(row.minimumActual ?? row.minActual, selected.unit)}</td><td>${unitValue(row.maximumActual ?? row.maxActual, selected.unit)}</td><td>${fmtNum(row.outOfRangePercent)}%</td><td>${fmtDuration(row.outOfRangeDurationMs)}</td><td>${renderStatusBadge(row.status)}</td></tr>`).join('')}</tbody></table></div></div>`;
}

export function renderRecentDeviations(events = []) {
  if (!events.length) return `<div class="table-panel"><div class="panel-title"><h2>Recent Deviations</h2></div>${renderEmptyState('No operational deviations', 'No consolidated Warning/Critical events exist for this parameter.', 'ok')}</div>`;
  return `<div class="table-panel"><div class="panel-title"><h2>Recent Deviations</h2><button class="text-button">View All Deviations</button></div><div class="deviation-table scroll-table"><table><thead><tr><th>Start</th><th>End</th><th>State</th><th>Duration</th><th>Maximum Deviation</th><th>Severity</th></tr></thead><tbody>${events.slice(0, 10).map(event => `<tr class="${statusClass(event.severity)}"><td>${fmtTime(event.startTimestampMs)}</td><td>${fmtTime(event.endTimestampMs)}</td><td>${escapeHtml(event.state || event.systemStatesSeen?.[0] || event.machineStatesSeen?.[0] || '—')}</td><td>${fmtDuration(event.durationMs)}</td><td>${fmtNum(event.maximumDeviation)}</td><td>${renderStatusBadge(event.severity)}</td></tr>`).join('')}</tbody></table></div></div>`;
}

function sortStateRows(rows = []) {
  return [...rows].sort((a, b) => stateRank(a.state) - stateRank(b.state) || priority(b.status) - priority(a.status));
}

function stateRank(state) {
  const idx = STATE_ORDER.indexOf(state);
  return idx === -1 ? 999 : idx;
}

function displayState(state) {
  return STATE_ORDER.includes(state) ? state : 'Other / Unsupported';
}

export function sortComparisonRows(rows = []) {
  const order = { critical: 7, warning: 6, ok: 5, needs_configuration: 4, needs_validation: 3, no_data: 2, no_rule: 1, not_analyzed: 0 };
  return [...rows].sort((a, b) => (order[normalizeStatus(b.status)] || 0) - (order[normalizeStatus(a.status)] || 0) || (b.eventCount || 0) - (a.eventCount || 0) || String(a.parameterName || a.signal || '').localeCompare(String(b.parameterName || b.signal || '')));
}
