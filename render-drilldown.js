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
      <aside class="parameter-nav panel pad"><div class="panel-title"><h2>Parameter navigator</h2></div>${renderParameterNavigator(summaries, selected?.ruleId)}</aside>
      <section class="chart-panel panel pad"><div class="chart-heading"><div>${renderStatusBadge(selected?.status || health.status)}<h2>${escapeHtml(selected?.signal || 'No parameter selected')}</h2><p>${escapeHtml(selected?.component || selected?.subsystem || 'Select a parameter to investigate.')}</p></div><div class="legend"><span class="actual-key"></span>Actual <span class="expected-key"></span>Expected range</div></div>${selected ? renderActualExpectedChart(chart, selected, events) : renderEmptyState('No parameter selected', 'This system has no parameter summaries in the AnalysisResult.', health.status)}${renderStateTimeline({ stateTimeline: result.stateTimeline || [], events })}</section>
      <aside class="selected-param panel pad">${selected ? renderSelectedParameter(result, selected, events) : renderEmptyState('No parameter selected', 'No rules or matching values exist for this system.', health.status)}</aside>
    </section>
    <section class="drill-bottom panel pad">${renderBottomInvestigation(result, selected, events)}</section>`;
  $('drilldownRoot').querySelectorAll('[data-rule]').forEach(el => el.addEventListener('click', () => handlers.selectRule(el.dataset.rule)));
}

function renderSummaryBar(health, summaries, selected) {
  return `<div class="drill-summary-grid"><div><p class="brand-eyebrow">System scorecard</p>${renderSystemHealthDonut(health, summaries)}</div><div class="summary-metric"><label>Selected actual</label><strong>${fmtNum(selected?.latestActual)}</strong><small>${selected ? expectedText(selected) : 'No selected rule'}</small></div><div class="summary-metric"><label>Deviation</label><strong>${selected ? escapeHtml(deviationText(selected.latestActual, selected)) : '—'}</strong><small>${selected?.eventCount || 0} events</small></div><div class="summary-metric">${renderStatusBadge(selected?.status || health.status)}<small>${selected?.latestReason || blockerLabel(selected?.blocker)}</small></div></div>`;
}

function renderParameterNavigator(summaries, selectedId) {
  if (!summaries.length) return renderEmptyState('No parameters', 'No evaluation rule is configured for this system.', 'no_rule');
  return `<div class="parameter-groups">${groupParameters(summaries).map(group => `<details class="parameter-group" ${group.rows.length ? 'open' : ''}><summary>${escapeHtml(group.label)} <span>${group.rows.length}</span></summary><div class="param-list">${group.rows.map(row => renderParameterCard(row, selectedId)).join('') || '<div class="empty-inline">No parameters in this group.</div>'}</div></details>`).join('')}</div>`;
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
