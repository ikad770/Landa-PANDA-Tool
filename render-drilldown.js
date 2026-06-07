import { SYSTEM_HOTSPOTS } from './config.js';
import { $, blockerLabel, chooseInitialParameter, chooseInitialSystem, deviationText, escapeAttr, escapeHtml, expectedText, fmtDuration, fmtNum, fmtTime, getServiceDecision, groupParameters, hasExpectedRange, normalizeStatus, priority, renderActualExpectedChart, renderComparisonGauge, renderEmptyState, renderParameterCard, renderStateTimeline, renderStatusBadge, renderSystemHealthDonut, statusClass, statusLabel } from './render.js';

export function renderDrilldown(app, handlers) {
  const result = app.analysisResult;
  if (!result) {
    $('drilldownRoot').innerHTML = renderEmptyState('No analysis loaded', 'Run an analysis before opening Drill-Down.', 'not_analyzed');
    return;
  }
  const decision = getServiceDecision(result);
  const system = app.selectedSystem || decision.primarySystem || chooseInitialSystem(result);
  app.selectedSystem = system;
  const health = (result.systemHealth || []).find(item => item.system === system) || { system, status: 'no_rule', label: 'Rules not configured' };
  const summaries = (result.signalSummaries || []).filter(item => item.system === system).sort((a, b) => priority(b.status) - priority(a.status) || String(a.signal).localeCompare(String(b.signal)));
  const selected = summaries.find(item => item.ruleId === app.selectedRuleId) || chooseInitialParameter({ signalSummaries: summaries }, system);
  if (selected && app.selectedRuleId !== selected.ruleId) app.selectedRuleId = selected.ruleId;
  const chart = selected ? result.chartSeries?.[selected.ruleId] || [] : [];
  const events = selected ? (result.deviationEvents || []).filter(event => event.system === selected.system && event.signal === selected.signal) : [];
  $('drillSubtitle').textContent = `${system || 'No system selected'} · ${statusLabel(health.status)} · ${summaries.length} parameters · ${result.metadata?.timeRange || 'No evaluated time range'}`;
  $('drilldownRoot').innerHTML = `
    <section class="drill-summary panel pad"><div class="breadcrumbs">Analysis Workspace → Analysis Summary → Service Radar → ${escapeHtml(system || 'System')}</div>${renderSummaryBar(health, summaries, selected)}</section>
    <section class="drilldown-main">
      <aside class="parameter-nav panel pad"><div class="panel-title"><h2>Parameter Comparison Matrix</h2></div>${renderParameterNavigator(summaries, selected?.ruleId)}</aside>
      <section class="chart-panel panel pad"><div class="chart-heading"><div>${renderStatusBadge(selected?.status || health.status)}<h2>${escapeHtml(selected?.signal || 'No parameter selected')}</h2><p>${escapeHtml(selected?.component || selected?.subsystem || 'Select a parameter to investigate.')}</p></div><div class="legend"><button class="expand-chart" type="button" onclick="this.closest('.chart-panel').classList.toggle('expanded')">Expand</button><span class="actual-key"></span>Actual <span class="expected-key"></span>Expected range</div></div>${renderSystemVisual(system, summaries, selected?.ruleId)}${selected ? renderActualExpectedChart(chart, selected, events) : renderEmptyState('No parameter selected', 'This system has no parameter summaries in the AnalysisResult.', health.status)}${renderStateComparison(selected)}${renderStateTimeline({ stateTimeline: result.stateTimeline || [], events })}</section>
      <aside class="selected-param panel pad">${selected ? renderSelectedParameter(result, selected, events) : renderEmptyState('No parameter selected', 'No rules or matching values exist for this system.', health.status)}</aside>
    </section>
    <section class="drill-bottom panel pad">${renderBottomInvestigation(result, selected, events)}</section>`;
  $('drilldownRoot').querySelectorAll('[data-rule]').forEach(el => el.addEventListener('click', () => handlers.selectRule(el.dataset.rule)));
  $('drilldownRoot').querySelectorAll('[data-filter]').forEach(el => el.addEventListener('click', () => applyMatrixFilter(el.dataset.filter)));
}


function renderSystemVisual(system, summaries, selectedId) {
  const rows = sortComparisonRows(summaries).filter(row => ['critical', 'warning', 'needs_validation', 'needs_configuration', 'ok', 'no_data'].includes(normalizeStatus(row.status))).slice(0, 8);
  const map = SYSTEM_HOTSPOTS[system] || { region: 'central_print_engine' };
  return `<div class="drill-visual" ondblclick="this.classList.toggle('show-all')"><button class="show-all-toggle" type="button" onclick="this.parentElement.classList.toggle('show-all')">Show All</button>${systemPlaceholderSvg(system, map.region)}${rows.map((row, idx) => renderParamPin(row, selectedId, idx)).join('')}</div>`;
}

function systemPlaceholderSvg(system, region) {
  const accent = region === 'front_cockpit' ? '#f7fbff' : region === 'right_imaging_delivery' ? '#263747' : '#162331';
  return `<svg class="system-svg" viewBox="0 0 520 240" role="img" aria-label="${escapeAttr(system)} system visual"><defs><linearGradient id="sysBody" x1="0" x2="1"><stop offset="0" stop-color="${accent}"/><stop offset="1" stop-color="#0e1722"/></linearGradient></defs><ellipse cx="260" cy="206" rx="210" ry="24" fill="rgba(0,0,0,.38)"/><path d="M52 150 L106 76 L394 76 L468 132 L438 178 L84 180 Z" fill="url(#sysBody)" stroke="#60758a" stroke-width="3"/><rect x="134" y="104" width="248" height="28" rx="9" fill="#0b131d"/><rect x="154" y="114" width="206" height="7" rx="4" fill="#39c7f3"/><circle cx="148" cy="184" r="16" fill="#111923"/><circle cx="374" cy="184" r="16" fill="#111923"/><text x="260" y="58" text-anchor="middle" fill="#d9e8f6" font-size="28" font-weight="800">${escapeHtml(system)}</text></svg>`;
}

function renderParamPin(row, selectedId, idx = 0) {
  const status = normalizeStatus(row.status);
  const positions = [['4%', '12%', 'auto', 'auto'], ['auto', '14%', '4%', 'auto'], ['6%', 'auto', 'auto', '14%'], ['auto', 'auto', '5%', '16%'], ['25%', '6%', 'auto', 'auto'], ['auto', '7%', '26%', 'auto'], ['25%', 'auto', 'auto', '6%'], ['auto', 'auto', '28%', '7%']];
  const [left, top, right, bottom] = positions[idx % positions.length];
  const style = `left:${left};top:${top};right:${right};bottom:${bottom}`;
  return `<button class="param-pin ${statusClass(status)}" style="${style}" data-rule="${escapeAttr(row.ruleId)}" aria-pressed="${row.ruleId === selectedId}">${renderStatusBadge(status, row.signal || row.parameterName || 'Parameter')}<span>Actual ${fmtNum(row.latestActual)} · Expected ${escapeHtml(expectedText(row))}</span></button>`;
}

function applyMatrixFilter(filter) {
  const root = $('drilldownRoot');
  root.querySelectorAll('.matrix-filter').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.filter === filter)));
  root.querySelectorAll('.matrix-row[data-status]').forEach(row => {
    const status = row.dataset.status;
    const visible = filter === 'all' || status === filter || (filter === 'no_data' && ['no_data', 'no_rule', 'not_analyzed'].includes(status));
    row.hidden = !visible;
  });
}

function renderSummaryBar(health, summaries, selected) {
  return `<div class="drill-summary-grid"><div><p class="brand-eyebrow">System scorecard</p>${renderSystemHealthDonut(health, summaries)}</div><div class="summary-metric"><label>Selected actual</label><strong>${fmtNum(selected?.latestActual)}</strong><small>${selected ? expectedText(selected) : 'No selected rule'}</small></div><div class="summary-metric"><label>Deviation</label><strong>${selected ? escapeHtml(deviationText(selected.latestActual, selected)) : '—'}</strong><small>${selected?.eventCount || 0} events</small></div><div class="summary-metric">${renderStatusBadge(selected?.status || health.status)}<small>${selected?.latestReason || blockerLabel(selected?.blocker)}</small></div></div>`;
}

function renderParameterNavigator(summaries, selectedId) {
  if (!summaries.length) return renderEmptyState('No parameters', 'No evaluation rule is configured for this system.', 'no_rule');
  const rows = sortComparisonRows(summaries);
  const filters = [
    ['all', 'All'], ['critical', 'Critical'], ['warning', 'Warning'], ['ok', 'OK'], ['needs_validation', 'Validation'], ['needs_configuration', 'Configuration'], ['no_data', 'No Data']
  ];
  return `<div class="matrix-shell"><div class="matrix-filters">${filters.map(([key, label]) => `<button class="matrix-filter" data-filter="${key}">${escapeHtml(label)}</button>`).join('')}</div>
    <div class="comparison-matrix" role="table" aria-label="Parameter comparison matrix">
      <div class="matrix-row matrix-head" role="row"><span>Status</span><span>Parameter</span><span>Component</span><span>State</span><span>Actual</span><span>Expected</span><span>Allowed Range</span><span>Deviation</span><span>Duration</span></div>
      ${rows.map(row => renderComparisonRow(row, selectedId)).join('')}
    </div></div>`;
}

export function sortComparisonRows(rows = []) {
  const order = { critical: 0, warning: 1, ok: 2, needs_validation: 3, needs_configuration: 4, no_data: 5, no_rule: 6, not_analyzed: 7 };
  return [...rows].sort((a, b) => (order[normalizeStatus(a.status)] ?? 99) - (order[normalizeStatus(b.status)] ?? 99) || String(a.parameterName || a.signal).localeCompare(String(b.parameterName || b.signal)));
}

function renderComparisonRow(row, selectedId) {
  const state = row.currentSystemState || row.currentMachineState || '—';
  const expected = Number.isFinite(row.expectedValue ?? row.expected) ? `${fmtNum(row.expectedValue ?? row.expected)}${row.unit || ''}` : '—';
  return `<button class="matrix-row ${statusClass(row.status)}" data-rule="${escapeAttr(row.ruleId)}" data-status="${normalizeStatus(row.status)}" aria-pressed="${row.ruleId === selectedId}" role="row">
    <span>${renderStatusBadge(row.status)}</span><span title="${escapeAttr(row.signal)}">${escapeHtml(row.parameterName || row.signal || 'Unnamed parameter')}</span><span>${escapeHtml(row.component || row.subsystem || '—')}</span><span>${escapeHtml(state)}</span><span>${fmtNum(row.latestActual)}${escapeHtml(row.unit || '')}</span><span>${escapeHtml(expected)}</span><span>${escapeHtml(expectedText(row))}${escapeHtml(row.unit || '')}</span><span>${escapeHtml(row.deviationDirection ? `${row.deviationDirection === 'below' ? '-' : row.deviationDirection === 'above' ? '+' : ''}${fmtNum(Math.abs(row.deviation || 0))} ${row.deviationDirection}` : deviationText(row.latestActual, row))}</span><span>${fmtDuration(row.totalDeviationDurationMs)}</span>
  </button>`;
}

function renderStateComparison(selected) {
  if (!selected) return '';
  const summaries = selected.stateSummaries || [];
  if (!summaries.length) return `<div class="state-comparison-panel">${renderEmptyState('No state comparison yet', 'This signal has no evaluated state-level samples.', selected.status)}</div>`;
  return `<div class="state-comparison-panel"><h3>State comparison</h3><div class="state-comparison-table"><div class="state-comparison-row state-comparison-head"><span>State</span><span>Expected</span><span>Allowed Range</span><span>Average Actual</span><span>Minimum</span><span>Maximum</span><span>Out-of-Range %</span><span>Out-of-Range Duration</span><span>Status</span></div>${summaries.map(row => `<div class="state-comparison-row ${statusClass(row.status)}"><span>${escapeHtml(row.state)}</span><span>${fmtNum(row.expected)}</span><span>${escapeHtml(formatRangeSafe(row.allowedLow, row.allowedHigh))}</span><span>${fmtNum(row.averageActual)}</span><span>${fmtNum(row.minActual)}</span><span>${fmtNum(row.maxActual)}</span><span>${fmtNum(row.outOfRangePercent)}%</span><span>${fmtDuration(row.outOfRangeDurationMs)}</span><span>${renderStatusBadge(row.status)}</span></div>`).join('')}</div></div>`;
}

function formatRangeSafe(low, high) {
  return `${Number.isFinite(low) ? fmtNum(low) : '−∞'}–${Number.isFinite(high) ? fmtNum(high) : '+∞'}`;
}

function renderSelectedParameter(result, selected, events) {
  const latestEvent = events[0];
  const status = normalizeStatus(selected.status);
  return `<div class="selected-param-stack ${statusClass(status)}">
    <div class="selected-head">${renderStatusBadge(status)}<h2>${escapeHtml(selected.signal)}</h2><p>${escapeHtml(selected.component || selected.subsystem || 'No component')}</p></div>
    <div class="comparison-grid compact"><div><label>Actual</label><strong>${fmtNum(selected.latestActual)}</strong></div><div><label>Expected</label><strong>${escapeHtml(expectedText(selected))}</strong></div><div><label>Deviation</label><strong>${escapeHtml(deviationText(selected.latestActual, selected))}</strong></div></div>
    ${renderComparisonGauge({ actual: selected.latestActual, expectedLow: selected.expectedLow, expectedHigh: selected.expectedHigh, status })}
    <div class="context-list"><h3>Operational context</h3>${fact('Machine State', selected.currentMachineState)}${fact('System State', selected.currentSystemState)}${fact('Latest timestamp', selected.rawTimestamp || fmtTime(latestEvent?.endTimestampMs))}${fact('First deviation', fmtTime(latestEvent?.startTimestampMs))}${fact('Last deviation', fmtTime(latestEvent?.endTimestampMs))}${fact('Total duration', fmtDuration(selected.totalDeviationDurationMs))}${fact('Event count', selected.eventCount || 0)}</div>
    <div class="context-list"><h3>Rule</h3>${fact('Excel row', selected.ruleRow)}${fact('Check type', selected.checkType || 'From AnalysisResult')}${fact('Tolerance / thresholds', hasExpectedRange(selected) ? expectedText(selected) : 'Missing Expected/Tolerance configuration')}</div>
    <div class="action-box ${statusClass(status)}"><strong>${status === 'needs_configuration' ? 'Configuration required' : 'Recommended action'}</strong><p>${escapeHtml(selected.recommendedAction || selected.latestReason || blockerLabel(selected.blocker))}</p></div>
  </div>`;
}

function fact(label, value) {
  return `<div class="fact"><label>${escapeHtml(label)}</label><b>${escapeHtml(value ?? '—')}</b></div>`;
}

function renderBottomInvestigation(result, selected, events) {
  if (!selected) return renderEmptyState('No investigation selected', 'Choose a parameter to view events, related rule, and evidence samples.', 'not_analyzed');
  const evidence = (result.evidence || []).filter(item => item.ruleRow === selected.ruleRow || item.signal === selected.signal).slice(0, 8);
  return `<div class="investigation-grid four">
    <div><h3>Recent occurrences</h3>${renderOccurrences(selected, events)}</div>
    <div><h3>Related rule</h3>${renderRuleSummary(selected)}</div>
    <div><h3>Latest evidence</h3>${evidence.map(sample => `<div class="compact-item ${statusClass(sample.result)}"><strong>${fmtTime(sample.timestampMs)}</strong><small>Actual ${fmtNum(sample.actual)} · ${escapeHtml(sample.machineState || 'No state')} · ${escapeHtml(sample.source || '')}</small></div>`).join('') || '<div class="compact-item no-data">No bounded evidence samples were included for this parameter.</div>'}</div>
    <div><h3>Recommended actions</h3><div class="compact-item ${statusClass(selected.status)}"><strong>${escapeHtml(selected.recommendedAction || selected.latestReason || blockerLabel(selected.blocker))}</strong><small>${escapeHtml(selected.system)} · row ${escapeHtml(selected.ruleRow || '—')}</small></div></div>
  </div>`;
}

function renderOccurrences(selected, events) {
  const status = normalizeStatus(selected.status);
  if (status === 'needs_configuration') return '<div class="compact-item needs-configuration">No operational occurrences can be calculated until the rule is fully configured.</div>';
  if (!events.length) return '<div class="compact-item ok">No operational deviation occurrences were calculated for this parameter.</div>';
  return `<div class="occurrence-table"><div class="occurrence-head"><span>Start</span><span>End</span><span>Duration</span><span>Maximum deviation</span><span>Machine State</span><span>Severity</span></div>${events.slice(0, 8).map(event => `<div class="occurrence-row ${statusClass(event.severity)}"><span>${fmtTime(event.startTimestampMs)}</span><span>${fmtTime(event.endTimestampMs)}</span><span>${fmtDuration(event.durationMs)}</span><span>${fmtNum(event.maximumDeviation)}</span><span>${escapeHtml([...(event.machineStatesSeen || [])][0] || '—')}</span><span>${statusLabel(event.severity)}</span></div>`).join('')}</div>`;
}

function renderRuleSummary(selected) {
  const missing = hasExpectedRange(selected) ? '' : '<small class="missing-field">Missing: Expected value / Spec Tolerance</small>';
  return `<div class="compact-item ${statusClass(selected.status)}"><strong>Excel row ${escapeHtml(selected.ruleRow || '—')}</strong><small>${escapeHtml(selected.system)} · ${escapeHtml(selected.subsystem || 'No subsystem')}</small><small>Signal: ${escapeHtml(selected.signal)}</small><small>Check: ${escapeHtml(selected.checkType || 'Configured rule')}</small><small>Expected: ${escapeHtml(expectedText(selected))}</small>${missing}<small>Action: ${escapeHtml(selected.recommendedAction || selected.latestReason || blockerLabel(selected.blocker))}</small></div>`;
}
