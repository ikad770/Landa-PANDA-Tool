import { STATUS_TAXONOMY } from './config.js';
import { formatRange } from './evaluation.js';

export const OPERATIONAL_STATUSES = new Set(['critical', 'warning']);
export const EVALUATED_STATUSES = new Set(['ok', 'warning', 'critical']);
export const ATTENTION_STATUSES = new Set(['critical', 'warning', 'needs_validation', 'needs_configuration']);

const STATUS_ORDER = ['critical', 'warning', 'ok', 'needs_configuration', 'needs_validation', 'no_data', 'no_rule', 'not_analyzed'];
const STATUS_SCORE = Object.fromEntries(STATUS_ORDER.map((status, index) => [status, STATUS_ORDER.length - index]));

export function normalizeDecisionStatus(status) {
  if (status === 'evaluator_pending') return 'needs_validation';
  return STATUS_TAXONOMY[status] ? status : 'no_data';
}

export function isOperationalStatus(status) {
  return ['ok', 'warning', 'critical'].includes(normalizeDecisionStatus(status));
}

export function buildServiceDecision(result = {}) {
  const metadata = result.metadata || {};
  const parameterSummaries = result.signalSummaries || [];
  const parameterStateSummaries = buildParameterStateSummaries(parameterSummaries);
  const deviationEvents = (result.deviationEvents || []).map(normalizeDeviationEvent).sort(byFindingPriority);
  const systemSummaries = buildSystemSummaries(result.systemHealth || [], parameterSummaries, deviationEvents);
  const statusCounts = countRulesByStatus(parameterSummaries);
  const criticalParameters = parameterSummaries.filter(row => normalizeDecisionStatus(row.status) === 'critical');
  const warningParameters = parameterSummaries.filter(row => normalizeDecisionStatus(row.status) === 'warning');
  const healthyParameters = parameterSummaries.filter(row => normalizeDecisionStatus(row.status) === 'ok');
  const validationProblems = parameterSummaries.filter(row => normalizeDecisionStatus(row.status) === 'needs_validation');
  const configurationProblems = parameterSummaries.filter(row => normalizeDecisionStatus(row.status) === 'needs_configuration');
  const fullyEvaluatedRules = parameterSummaries.filter(row => isOperationalStatus(row.status) && (row.fullyEvaluatedPoints || row.okPointCount || row.warningPointCount || row.criticalPointCount || 0) > 0);
  const matchedSignals = parameterSummaries.filter(row => (row.matchedRows || 0) > 0);
  const criticalFindings = deviationEvents.filter(event => normalizeDecisionStatus(event.severity) === 'critical');
  const warningFindings = deviationEvents.filter(event => normalizeDecisionStatus(event.severity) === 'warning');
  const operationalFindings = [...criticalFindings, ...warningFindings].sort(byFindingPriority);
  const systemsAtRisk = systemSummaries.filter(system => OPERATIONAL_STATUSES.has(normalizeDecisionStatus(system.status)));
  const systemsRequiringAttention = systemSummaries.filter(system => ATTENTION_STATUSES.has(normalizeDecisionStatus(system.status)));
  const primaryFinding = operationalFindings[0] || sortRules([...validationProblems, ...configurationProblems, ...parameterSummaries])[0] || null;
  const primarySystem = systemsAtRisk[0]?.system || primaryFinding?.system || systemsRequiringAttention[0]?.system || systemSummaries.find(system => normalizeDecisionStatus(system.status) === 'ok')?.system || systemSummaries[0]?.system || null;
  const machineStatus = chooseMachineStatus(systemSummaries, parameterSummaries);
  const nextRecommendedAction = buildRecommendedAction(machineStatus, primaryFinding, { configurationProblems, validationProblems });
  const affectedParameters = new Set(operationalFindings.map(event => `${event.system}::${event.signal}`));
  return {
    machineStatus,
    machineStatusLabel: STATUS_TAXONOMY[machineStatus]?.label || machineStatus,
    machineSummary: buildMachineSummary(machineStatus, primarySystem, primaryFinding, { criticalFindings, warningFindings, validationProblems, configurationProblems, affectedParameters, deviationEvents }),
    systemsAtRisk,
    systemsAtRiskCount: systemsAtRisk.length,
    systemsRequiringAttention,
    systemsRequiringAttentionCount: systemsRequiringAttention.length,
    criticalFindings,
    warningFindings,
    operationalFindings,
    validationProblems,
    configurationProblems,
    fullyEvaluatedSystems: systemSummaries.filter(system => isOperationalStatus(system.status) && (system.evaluatedParameters || 0) > 0),
    partiallyEvaluatedSystems: systemSummaries.filter(system => !isOperationalStatus(system.status) && (system.rules || 0) > 0),
    primarySystem,
    primaryFinding,
    topFindings: topOperationalFindings(parameterSummaries, deviationEvents),
    parameterSummaries,
    parameterStateSummaries,
    systemSummaries,
    stateSummaries: parameterStateSummaries,
    deviationEvents,
    recommendedActions: buildRecommendedActions(parameterSummaries),
    evaluationCoverage: { fullyEvaluatedRules: fullyEvaluatedRules.length, matchedSignals: matchedSignals.length, rulesRequiringConfiguration: configurationProblems.length, rulesRequiringValidation: validationProblems.length },
    diagnosticsSummary: result.diagnosticsSummary || {},
    nextRecommendedAction,
    fullyEvaluatedRules,
    matchedSignals,
    analysisCompleteness: ratio(fullyEvaluatedRules.length, metadata.rulesValid || parameterSummaries.length),
    dataQuality: ratio((metadata.relevantValuesFound || 0) - (metadata.needsValidationPoints || 0), metadata.relevantValuesFound || 0),
    ruleCoverage: ratio(metadata.relevantSignalsFound || 0, metadata.relevantSignalsRequired || 0),
    statusCounts,
    kpis: {
      systemsAtRisk: systemsAtRisk.length,
      affectedParameters: affectedParameters.size,
      deviationEvents: deviationEvents.length,
      criticalParameters: criticalParameters.length,
      warningParameters: warningParameters.length,
      healthyParameters: healthyParameters.length,
      fullyEvaluatedRules: fullyEvaluatedRules.length,
      evaluationReadiness: { evaluated: fullyEvaluatedRules.length, total: metadata.rulesValid || parameterSummaries.length },
      validationIssues: validationProblems.length,
      configurationIssues: configurationProblems.length,
      signalCoverage: { found: metadata.relevantSignalsFound || matchedSignals.length, required: metadata.relevantSignalsRequired || parameterSummaries.length }
    }
  };
}

export function buildParameterStateSummaries(parameters = []) {
  return parameters.flatMap(parameter => (parameter.stateSummaries || []).map(state => ({
    parameterId: parameter.ruleId,
    parameterName: parameter.parameterName || parameter.signal,
    system: parameter.system,
    subsystem: parameter.subsystem,
    component: parameter.component,
    unit: parameter.unit || '',
    state: state.state || 'Other / Unsupported',
    timeInStateMs: state.timeInStateMs || 0,
    sampleCount: state.sampleCount || 0,
    expected: state.expected ?? null,
    allowedLow: state.allowedLow ?? null,
    allowedHigh: state.allowedHigh ?? null,
    averageActual: state.averageActual ?? null,
    minimumActual: state.minimumActual ?? state.minActual ?? null,
    maximumActual: state.maximumActual ?? state.maxActual ?? null,
    latestActual: state.latestActual ?? null,
    okPointCount: state.okPointCount ?? state.okCount ?? 0,
    warningPointCount: state.warningPointCount ?? state.warningCount ?? 0,
    criticalPointCount: state.criticalPointCount ?? state.criticalCount ?? 0,
    validationPointCount: state.validationPointCount ?? state.needsValidationCount ?? 0,
    configurationPointCount: state.configurationPointCount ?? state.needsConfigurationCount ?? 0,
    outOfRangePointCount: state.outOfRangePointCount ?? state.outOfRangeCount ?? 0,
    outOfRangePercent: state.outOfRangePercent || 0,
    outOfRangeDurationMs: state.outOfRangeDurationMs || 0,
    longestDeviationMs: state.longestDeviationMs ?? state.longestContinuousDeviationMs ?? 0,
    firstDeviation: state.firstDeviation ?? null,
    lastDeviation: state.lastDeviation ?? null,
    status: normalizeDecisionStatus(state.status),
    blocker: state.blocker || parameter.blocker || null,
    ruleRow: state.ruleRow || parameter.ruleRow
  })));
}

function normalizeDeviationEvent(event = {}) {
  return {
    ...event,
    startTime: event.startTime ?? event.startTimestampMs ?? event.start,
    endTime: event.endTime ?? event.endTimestampMs ?? event.end,
    startTimestampMs: event.startTimestampMs ?? event.startTime ?? event.start,
    endTimestampMs: event.endTimestampMs ?? event.endTime ?? event.end,
    state: event.state || event.systemStatesSeen?.[0] || event.machineStatesSeen?.[0] || '—',
    expected: event.expected ?? event.expectedValue ?? null,
    allowedLow: event.allowedLow ?? event.expectedLow ?? null,
    allowedHigh: event.allowedHigh ?? event.expectedHigh ?? null,
    averageActual: event.averageActual ?? null,
    minimumActual: event.minimumActual ?? event.minActual ?? null,
    maximumActual: event.maximumActual ?? event.maxActual ?? null,
    severity: normalizeDecisionStatus(event.severity)
  };
}

function buildSystemSummaries(existing, parameters, events) {
  const systemNames = new Set([...existing.map(row => row.system), ...parameters.map(row => row.system)].filter(Boolean));
  return [...systemNames].map(system => {
    const base = existing.find(row => row.system === system) || { system, rules: 0 };
    const rows = parameters.filter(row => row.system === system);
    const counts = countRulesByStatus(rows);
    const status = systemStatus(rows, base.status);
    const systemEvents = events.filter(event => event.system === system);
    return { ...base, status, label: STATUS_TAXONOMY[status]?.label || status, totalParameters: rows.length, evaluatedParameters: counts.ok + counts.warning + counts.critical, criticalParameters: counts.critical, warningParameters: counts.warning, okParameters: counts.ok, noDataParameters: counts.no_data, noRuleParameters: counts.no_rule, configurationIssues: counts.needs_configuration, validationIssues: counts.needs_validation, affectedParameters: new Set(systemEvents.map(event => event.signal)).size, deviationEvents: systemEvents.length, worstParameter: topOperationalFindings(rows, systemEvents)[0]?.signal || null };
  }).sort(bySystemPriority);
}

function systemStatus(rows = [], fallback = 'no_data') {
  if (rows.some(row => normalizeDecisionStatus(row.status) === 'critical' && (row.fullyEvaluatedPoints || 0) > 0)) return 'critical';
  if (rows.some(row => normalizeDecisionStatus(row.status) === 'warning' && (row.fullyEvaluatedPoints || 0) > 0)) return 'warning';
  if (rows.some(row => normalizeDecisionStatus(row.status) === 'ok' && (row.fullyEvaluatedPoints || 0) > 0)) return 'ok';
  if (rows.some(row => normalizeDecisionStatus(row.status) === 'needs_configuration')) return 'needs_configuration';
  if (rows.some(row => normalizeDecisionStatus(row.status) === 'needs_validation')) return 'needs_validation';
  if (rows.some(row => normalizeDecisionStatus(row.status) === 'no_data')) return 'no_data';
  if (rows.length) return normalizeDecisionStatus(fallback);
  return normalizeDecisionStatus(fallback || 'no_rule');
}

function chooseMachineStatus(systems, rules) {
  if (systems.some(system => normalizeDecisionStatus(system.status) === 'critical')) return 'critical';
  if (systems.some(system => normalizeDecisionStatus(system.status) === 'warning')) return 'warning';
  if (systems.some(system => normalizeDecisionStatus(system.status) === 'ok')) return 'ok';
  if (rules.some(rule => normalizeDecisionStatus(rule.status) === 'needs_configuration')) return 'needs_configuration';
  if (rules.some(rule => normalizeDecisionStatus(rule.status) === 'needs_validation')) return 'needs_validation';
  if (rules.some(rule => normalizeDecisionStatus(rule.status) === 'no_data')) return 'no_data';
  return systems.some(system => normalizeDecisionStatus(system.status) === 'no_rule') ? 'no_rule' : 'not_analyzed';
}

function topOperationalFindings(parameters = [], events = []) {
  const bySignal = new Map();
  for (const event of events) {
    const key = `${event.system}::${event.signal}`;
    const row = bySignal.get(key) || { ...event, eventCount: 0, outOfRangePercent: 0 };
    row.eventCount += 1;
    row.durationMs = (row.durationMs || 0) + (event.durationMs || 0);
    row.maximumDeviation = Math.max(row.maximumDeviation || 0, event.maximumDeviation || 0);
    bySignal.set(key, row);
  }
  for (const parameter of parameters) {
    const key = `${parameter.system}::${parameter.signal}`;
    if (bySignal.has(key)) Object.assign(bySignal.get(key), { parameterName: parameter.parameterName, latestActual: parameter.latestActual, currentMachineState: parameter.currentMachineState, outOfRangePercent: maxStateOutOfRange(parameter), recommendedAction: parameter.recommendedAction || bySignal.get(key).recommendedAction });
  }
  return [...bySignal.values()].sort(byFindingPriority).slice(0, 3);
}

function maxStateOutOfRange(parameter = {}) {
  return Math.max(0, ...(parameter.stateSummaries || []).map(row => row.outOfRangePercent || 0));
}

function countRulesByStatus(rules) {
  const counts = { critical: 0, warning: 0, needs_validation: 0, needs_configuration: 0, ok: 0, no_data: 0, no_rule: 0, not_analyzed: 0 };
  for (const rule of rules) counts[normalizeDecisionStatus(rule.status)] += 1;
  return counts;
}

function byFindingPriority(a, b) {
  return (STATUS_SCORE[normalizeDecisionStatus(b.severity || b.status)] || 0) - (STATUS_SCORE[normalizeDecisionStatus(a.severity || a.status)] || 0) || (b.maximumDeviation || 0) - (a.maximumDeviation || 0) || (b.durationMs || 0) - (a.durationMs || 0);
}

function bySystemPriority(a, b) {
  return (STATUS_SCORE[normalizeDecisionStatus(b.status)] || 0) - (STATUS_SCORE[normalizeDecisionStatus(a.status)] || 0) || String(a.system || '').localeCompare(String(b.system || ''));
}

function sortRules(rows) {
  return rows.sort((a, b) => (STATUS_SCORE[normalizeDecisionStatus(b.status)] || 0) - (STATUS_SCORE[normalizeDecisionStatus(a.status)] || 0) || String(a.signal || '').localeCompare(String(b.signal || '')));
}

function buildRecommendedAction(status, finding, groups) {
  if (finding?.recommendedAction && ['critical', 'warning'].includes(status)) return finding.recommendedAction;
  if (status === 'critical' || status === 'warning') return 'No service action configured for this rule.';
  if (status === 'needs_validation') return `Fix timestamp/state/source mapping for rule row ${groups.validationProblems[0]?.ruleRow || '—'}.`;
  if (status === 'needs_configuration') return `Complete Expected / Tolerance configuration in Excel row ${groups.configurationProblems[0]?.ruleRow || '—'}.`;
  if (status === 'no_data') return 'Collect logs containing the configured source signal, then rerun analysis.';
  if (status === 'no_rule') return 'Add an evaluation rule before service status can be determined.';
  return 'No service action is required for fully evaluated parameters.';
}

function buildMachineSummary(status, primarySystem, finding, groups) {
  if (status === 'critical' || status === 'warning') {
    const affected = groups.affectedParameters.size;
    const events = groups.deviationEvents.length;
    const state = finding?.state || finding?.machineStatesSeen?.[0] || finding?.currentMachineState || 'recorded state';
    return `${primarySystem || finding?.system || 'Machine'} is ${status}: ${affected} affected parameter${affected === 1 ? '' : 's'}, ${events} consolidated deviation${events === 1 ? '' : 's'}. Worst: ${finding?.signal || 'parameter'} during ${state}.`;
  }
  if (status === 'needs_validation') return `No operational alarm is raised: ${groups.validationProblems.length} parameter${groups.validationProblems.length === 1 ? '' : 's'} need validation context before comparison.`;
  if (status === 'needs_configuration') return `No operational alarm is raised: ${groups.configurationProblems.length} parameter${groups.configurationProblems.length === 1 ? '' : 's'} have Actual data but incomplete Expected/Tolerance configuration.`;
  if (status === 'ok') return 'All fully evaluated parameters are inside their configured ranges.';
  if (status === 'no_data') return 'Valid rules exist, but matching source values were not found.';
  return 'No configured evaluation rules are available.';
}

function buildRecommendedActions(rules) {
  return sortRules([...rules]).filter(rule => ATTENTION_STATUSES.has(normalizeDecisionStatus(rule.status))).slice(0, 25).map(rule => ({ ruleRow: rule.ruleRow, system: rule.system, signal: rule.signal, status: normalizeDecisionStatus(rule.status), action: rule.recommendedAction || (normalizeDecisionStatus(rule.status) === 'needs_configuration' ? `Complete Expected / Tolerance configuration in Excel row ${rule.ruleRow || '—'}.` : normalizeDecisionStatus(rule.status) === 'needs_validation' ? `Fix timestamp/state/source mapping for rule row ${rule.ruleRow || '—'}.` : 'No service action configured for this rule.'), expected: rule.expectedValue ?? rule.expected, allowedRange: formatRange(rule.allowedLow ?? rule.expectedLow, rule.allowedHigh ?? rule.expectedHigh), actual: rule.latestActual }));
}

function ratio(numerator, denominator) {
  const total = Number(denominator) || 0;
  if (!total) return { numerator: Number(numerator) || 0, denominator: total, percent: 0, label: '0%' };
  const value = Math.max(0, Math.min(1, (Number(numerator) || 0) / total));
  return { numerator: Number(numerator) || 0, denominator: total, percent: Math.round(value * 100), label: `${Math.round(value * 100)}%` };
}
