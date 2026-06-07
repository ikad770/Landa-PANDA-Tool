import { $, blockerLabel, chooseInitialParameter, chooseInitialSystem, deviationText, escapeAttr, escapeHtml, expectedText, fmtDuration, fmtNum, fmtTime, groupParameters, hasExpectedRange, normalizeStatus, priority, renderActualExpectedChart, renderComparisonGauge, renderEmptyState, renderParameterCard, renderStateTimeline, renderStatusBadge, renderSystemHealthDonut, statusClass, statusLabel } from './render.js';

export function renderDrilldown(app, handlers) {
  const result = app.analysisResult;
  if (!result) {
    $('drilldownRoot').innerHTML = renderEmptyState('No analysis loaded', 'Run an analysis before opening Drill-Down.', 'not_analyzed');
    return;
  }
  const system = app.selectedSystem || chooseInitialSystem(result);
  app.selectedSystem = system;
  const health = (result.systemHealth || []).find(item => item.system === system) || { system, status: 'no_rule', label: 'Rules not configured' };
  const summaries = (result.signalSummaries || []).filter(item => item.system === system).sort((a, b) => priority(b.status) - priority(a.status) || String(a.signal).localeCompare(String(b.signal)));
  const selected = summaries.find(item => item.ruleId === app.selectedRuleId) || chooseInitialParameter({ signalSummaries: summaries }, system);
  if (selected && app.selectedRuleId !== selected.ruleId) app.selectedRuleId = selected.ruleId;
  const chart = selected ? result.chartSeries?.[selected.ruleId] || [] : [];
  const events = selected ? (result.deviationEvents || []).filter(event => event.system === selected.system && event.signal === selected.signal) : [];
  $('drillSubtitle').textContent = `${system || 'No system selected'} · ${statusLabel(health.status)} · ${summaries.length} parameters`;
  $('drilldownRoot').innerHTML = `
    <section class="drill-summary panel pad">${renderSummaryBar(health, summaries, selected)}</section>
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
  return `<div class="investigation-grid">
    <div><h3>Deviation events</h3>${events.slice(0, 8).map(event => `<div class="compact-item ${statusClass(event.severity)}"><strong>${escapeHtml(event.signal)}</strong><small>${fmtTime(event.startTimestampMs)} · ${fmtDuration(event.durationMs)} · Actual ${fmtNum(event.latestActual)} vs ${escapeHtml(expectedText(event))}</small></div>`).join('') || '<div class="compact-item ok">No deviation events for this parameter.</div>'}</div>
    <div><h3>Related rule</h3><div class="compact-item ${statusClass(selected.status)}"><strong>Excel row ${escapeHtml(selected.ruleRow || '—')}</strong><small>${escapeHtml(selected.signal)} · ${escapeHtml(expectedText(selected))}</small><small>${escapeHtml(selected.latestReason || blockerLabel(selected.blocker))}</small></div></div>
    <div><h3>Evidence samples</h3>${evidence.map(sample => `<div class="compact-item ${statusClass(sample.result)}"><strong>${fmtTime(sample.timestampMs)}</strong><small>Actual ${fmtNum(sample.actual)} · ${escapeHtml(sample.machineState || 'No state')} · ${escapeHtml(sample.file || '')}</small></div>`).join('') || '<div class="compact-item no-data">No evidence samples included for this parameter.</div>'}</div>
  </div>`;
}
