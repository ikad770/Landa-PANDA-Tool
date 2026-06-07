import { STATUS_PRIORITY, STATUS_TAXONOMY } from './config.js';
import { formatRange } from './evaluation.js';

export const OPERATIONAL_STATUSES = new Set(['critical', 'warning']);
export const ATTENTION_STATUSES = new Set(['critical', 'warning', 'needs_validation', 'needs_configuration']);

export function normalizeDecisionStatus(status) {
  if (status === 'evaluator_pending') return 'needs_validation';
  return STATUS_TAXONOMY[status] ? status : 'no_data';
}

export function buildServiceDecision(result = {}) {
  const metadata = result.metadata || {};
  const systems = result.systemHealth || [];
  const rules = result.signalSummaries || [];
  const events = result.deviationEvents || [];
  const statusCounts = countRulesByStatus(rules);
  const systemRisk = systems.filter(system => OPERATIONAL_STATUSES.has(normalizeDecisionStatus(system.status)));
  const systemsRequiringAttention = systems.filter(system => ATTENTION_STATUSES.has(normalizeDecisionStatus(system.status)));
  const criticalFindings = events.filter(event => normalizeDecisionStatus(event.severity) === 'critical');
  const warningFindings = events.filter(event => normalizeDecisionStatus(event.severity) === 'warning');
  const operationalFindings = [...criticalFindings, ...warningFindings].sort(byFindingPriority);
  const validationProblems = rules.filter(rule => normalizeDecisionStatus(rule.status) === 'needs_validation');
  const configurationProblems = rules.filter(rule => normalizeDecisionStatus(rule.status) === 'needs_configuration');
  const fullyEvaluatedSystems = systems.filter(system => ['ok', 'warning', 'critical'].includes(normalizeDecisionStatus(system.status)) && (system.evaluated || 0) > 0);
  const partiallyEvaluatedSystems = systems.filter(system => ['needs_validation', 'needs_configuration', 'no_data'].includes(normalizeDecisionStatus(system.status)) && (system.rules || 0) > 0);
  const primaryFinding = choosePrimaryFinding({ operationalFindings, validationProblems, configurationProblems, rules });
  const primarySystem = (systemRisk.sort(bySystemPriority)[0]?.system) || primaryFinding?.system || systemsRequiringAttention.sort(bySystemPriority)[0]?.system || fullyEvaluatedSystems[0]?.system || systems[0]?.system || null;
  const machineStatus = chooseMachineStatus({ criticalFindings, warningFindings, validationProblems, configurationProblems, rules, systems });
  const nextRecommendedAction = buildRecommendedAction(machineStatus, primaryFinding, { configurationProblems, validationProblems, operationalFindings });
  const fullyEvaluatedRules = rules.filter(rule => ['ok', 'warning', 'critical'].includes(normalizeDecisionStatus(rule.status)) && (rule.fullyEvaluatedPoints || 0) > 0);
  const matchedSignals = rules.filter(rule => (rule.matchedRows || 0) > 0);
  const analysisCompleteness = ratio(metadata.rulesEvaluated || statusCounts.ok + statusCounts.warning + statusCounts.critical, metadata.rulesValid || rules.length);
  const dataQuality = ratio((metadata.relevantValuesFound || 0) - (metadata.needsValidationPoints || 0), metadata.relevantValuesFound || 0);
  const ruleCoverage = ratio(metadata.relevantSignalsFound || 0, metadata.relevantSignalsRequired || 0);
  return {
    machineStatus,
    machineStatusLabel: STATUS_TAXONOMY[machineStatus]?.label || machineStatus,
    machineSummary: buildMachineSummary(machineStatus, primarySystem, primaryFinding, { criticalFindings, warningFindings, validationProblems, configurationProblems, metadata }),
    systemsAtRisk: systemRisk,
    systemsAtRiskCount: systemRisk.length,
    systemsRequiringAttention,
    systemsRequiringAttentionCount: systemsRequiringAttention.length,
    criticalFindings,
    warningFindings,
    operationalFindings,
    validationProblems,
    configurationProblems,
    fullyEvaluatedSystems,
    partiallyEvaluatedSystems,
    primarySystem,
    primaryFinding,
    topFindings: operationalFindings.slice(0, 3),
    nextRecommendedAction,
    fullyEvaluatedRules,
    matchedSignals,
    analysisCompleteness,
    dataQuality,
    ruleCoverage,
    statusCounts,
    kpis: {
      systemsAtRisk: systemRisk.length,
      criticalFindings: criticalFindings.length,
      warningFindings: warningFindings.length,
      evaluationReadiness: { evaluated: metadata.rulesEvaluated || statusCounts.ok + statusCounts.warning + statusCounts.critical, total: metadata.rulesValid || rules.length },
      validationIssues: validationProblems.length,
      configurationIssues: configurationProblems.length,
      signalCoverage: { found: metadata.relevantSignalsFound || 0, required: metadata.relevantSignalsRequired || 0 }
    }
  };
}

function countRulesByStatus(rules) {
  const counts = { critical: 0, warning: 0, needs_validation: 0, needs_configuration: 0, ok: 0, no_data: 0, no_rule: 0, not_analyzed: 0 };
  for (const rule of rules) counts[normalizeDecisionStatus(rule.status)] += 1;
  return counts;
}

function chooseMachineStatus({ criticalFindings, warningFindings, validationProblems, configurationProblems, rules, systems }) {
  if (criticalFindings.length) return 'critical';
  if (warningFindings.length) return 'warning';
  if (validationProblems.length) return 'needs_validation';
  if (configurationProblems.length) return 'needs_configuration';
  if (rules.some(rule => normalizeDecisionStatus(rule.status) === 'ok')) return 'ok';
  if (systems.some(system => normalizeDecisionStatus(system.status) === 'no_data')) return 'no_data';
  if (systems.some(system => normalizeDecisionStatus(system.status) === 'no_rule')) return 'no_rule';
  return 'not_analyzed';
}

function choosePrimaryFinding({ operationalFindings, validationProblems, configurationProblems, rules }) {
  return operationalFindings[0] || validationProblems.sort(byRulePriority)[0] || configurationProblems.sort(byRulePriority)[0] || rules.sort(byRulePriority)[0] || null;
}

function byFindingPriority(a, b) {
  return (STATUS_PRIORITY[normalizeDecisionStatus(b.severity)] || 0) - (STATUS_PRIORITY[normalizeDecisionStatus(a.severity)] || 0) || (b.maximumDeviation || 0) - (a.maximumDeviation || 0) || (b.startTimestampMs || 0) - (a.startTimestampMs || 0);
}

function byRulePriority(a, b) {
  return (STATUS_PRIORITY[normalizeDecisionStatus(b.status)] || 0) - (STATUS_PRIORITY[normalizeDecisionStatus(a.status)] || 0) || (b.eventCount || 0) - (a.eventCount || 0) || String(a.signal || '').localeCompare(String(b.signal || ''));
}

function bySystemPriority(a, b) {
  return (STATUS_PRIORITY[normalizeDecisionStatus(b.status)] || 0) - (STATUS_PRIORITY[normalizeDecisionStatus(a.status)] || 0) || String(a.system || '').localeCompare(String(b.system || ''));
}

function buildRecommendedAction(status, finding, groups) {
  if (finding?.recommendedAction && ['critical', 'warning'].includes(status)) return finding.recommendedAction;
  if (status === 'critical' || status === 'warning') return 'No service action configured for this rule.';
  if (status === 'needs_validation') return validationAction(groups.validationProblems);
  if (status === 'needs_configuration') return configurationAction(groups.configurationProblems);
  if (status === 'no_data') return 'Collect logs that contain the required signal for the configured rule before evaluating operation.';
  if (status === 'no_rule') return 'Add an evaluation rule for this system before service status can be determined.';
  return 'No service action is required for fully evaluated parameters.';
}

function validationAction(rows) {
  const top = rows[0];
  if (!top) return 'Correct validation context, then rerun analysis.';
  if (top.blocker === 'missing_state') return `Align MachineState logs with ${top.system} signal timestamps so row ${top.ruleRow || '—'} can be evaluated.`;
  if (top.blocker === 'invalid_timestamp') return `Correct the source timestamp format for ${top.system} row ${top.ruleRow || '—'}, then rerun analysis.`;
  return `Resolve validation blocker for ${top.system} row ${top.ruleRow || '—'}: ${top.latestReason || top.blocker || 'missing evaluation context'}.`;
}

function configurationAction(rows) {
  if (!rows.length) return 'Complete incomplete rule definitions before operational evaluation.';
  const bySystem = rows.reduce((acc, row) => ((acc[row.system] = (acc[row.system] || 0) + 1), acc), {});
  const [system, count] = Object.entries(bySystem).sort((a, b) => b[1] - a[1])[0];
  const row = rows.find(item => item.system === system);
  const missing = missingConfigurationText(row);
  return count === 1 ? `Update Excel row ${row?.ruleRow || '—'} for ${system}: add ${missing}.` : `Complete ${count} incomplete ${system} rule definitions before operational evaluation.`;
}

function buildMachineSummary(status, primarySystem, finding, groups) {
  const signal = finding?.signal || 'selected parameter';
  if (status === 'critical' || status === 'warning') {
    const events = status === 'critical' ? groups.criticalFindings.length : groups.warningFindings.length;
    const state = [...(finding?.machineStatesSeen || [])][0] || finding?.currentMachineState || 'the recorded state';
    const deviation = deviationSentence(finding);
    return `${primarySystem || finding?.system || 'Machine'} has ${events} ${status} deviation${events === 1 ? '' : 's'} during ${state}. The most significant issue is ${signal}${deviation}.`;
  }
  if (status === 'needs_validation') return `Matching source values were found, but evaluation context is unavailable or invalid for ${groups.validationProblems.length} rule${groups.validationProblems.length === 1 ? '' : 's'}.`;
  if (status === 'needs_configuration') return `${primarySystem || 'Machine'} data was successfully extracted, but ${groups.configurationProblems.length} rule${groups.configurationProblems.length === 1 ? '' : 's'} cannot be fully evaluated because expected ranges or tolerances are incomplete.`;
  if (status === 'ok') return 'All fully configured and evaluated parameters are within their permitted ranges.';
  if (status === 'no_data') return 'Valid rules exist, but no matching log values were found for evaluation.';
  if (status === 'no_rule') return 'No configured evaluation rules are available for the selected systems.';
  return 'Run an analysis to determine machine service status.';
}

function deviationSentence(finding = {}) {
  const actual = finding.latestActual ?? finding.firstActual;
  if (!Number.isFinite(actual)) return '';
  if (Number.isFinite(finding.expectedHigh) && actual > finding.expectedHigh) return `, ${formatNumber(actual - finding.expectedHigh)} above the configured range`;
  if (Number.isFinite(finding.expectedLow) && actual < finding.expectedLow) return `, ${formatNumber(finding.expectedLow - actual)} below the configured range`;
  if (Number.isFinite(finding.expectedLow) || Number.isFinite(finding.expectedHigh)) return `, actual ${formatNumber(actual)} against expected ${formatRange(finding.expectedLow, finding.expectedHigh)}`;
  return `, actual ${formatNumber(actual)}`;
}

function missingConfigurationText(row = {}) {
  const reason = row.latestReason || row.blocker || '';
  if (reason.includes('tolerance') || row.blocker === 'missing_threshold_or_tolerance') return 'Spec Tolerance or thresholds';
  if (row.blocker === 'unsupported_evaluator') return 'a supported check type or evaluator';
  return 'Expected value and Spec Tolerance';
}

function formatNumber(value) {
  return Number.isFinite(value) ? Number(value).toFixed(Math.abs(value) >= 100 ? 1 : 2).replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1') : '—';
}

function ratio(numerator, denominator) {
  const total = Number(denominator) || 0;
  if (!total) return { numerator: Number(numerator) || 0, denominator: total, percent: 0, label: '0%' };
  const value = Math.max(0, Math.min(1, (Number(numerator) || 0) / total));
  return { numerator: Number(numerator) || 0, denominator: total, percent: Math.round(value * 100), label: `${Math.round(value * 100)}%` };
}
