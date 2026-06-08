import { STATUS_PRIORITY } from './config.js';

export function buildServiceDecision(result = {}) {
  const parameters = result.parameterSummaries || [];
  const noRuleBySystem = new Map();
  for (const signal of result.signalCatalog || []) {
    if (!signal.hasRule) noRuleBySystem.set(signal.system || 'Unassigned', (noRuleBySystem.get(signal.system || 'Unassigned') || 0) + 1);
  }
  const systems = new Map();
  for (const parameter of parameters) {
    const name = parameter.system || 'Unassigned';
    if (!systems.has(name)) systems.set(name, createSystem(name));
    const system = systems.get(name);
    system.totalParameters += 1;
    if (['ok', 'warning', 'critical'].includes(parameter.status)) system.evaluatedParameters += 1;
    if (parameter.status === 'critical') system.criticalCount += 1;
    else if (parameter.status === 'warning') system.warningCount += 1;
    else if (parameter.status === 'ok') system.okCount += 1;
    else if (parameter.status === 'needs_configuration') system.configurationIssueCount += 1;
    else if (parameter.status === 'needs_validation') system.validationIssueCount += 1;
    else if (parameter.status === 'no_data') system.noDataCount += 1;
    if (['critical', 'warning', 'needs_configuration', 'needs_validation'].includes(parameter.status)) system.affectedParameterIds.push(parameter.parameterId);
    if (!system.worstParameterId || (STATUS_PRIORITY[parameter.status] || 0) > (STATUS_PRIORITY[system.status] || 0)) {
      system.status = parameter.status;
      system.worstParameterId = parameter.parameterId;
      system.recommendedAction = parameter.recommendedAction || system.recommendedAction;
    }
  }
  for (const [name, count] of noRuleBySystem) {
    if (!systems.has(name)) systems.set(name, createSystem(name));
    systems.get(name).noRuleSignalCount = count;
  }
  return Array.from(systems.values()).sort((a, b) => (STATUS_PRIORITY[b.status] || 0) - (STATUS_PRIORITY[a.status] || 0) || a.systemName.localeCompare(b.systemName));
}

function createSystem(name) {
  return {
    systemId: name.toLowerCase().replace(/[^a-z0-9]+/g, '_') || 'unassigned',
    systemName: name,
    status: 'ok',
    totalParameters: 0,
    evaluatedParameters: 0,
    criticalCount: 0,
    warningCount: 0,
    okCount: 0,
    configurationIssueCount: 0,
    validationIssueCount: 0,
    noDataCount: 0,
    noRuleSignalCount: 0,
    affectedParameterIds: [],
    worstParameterId: null,
    recommendedAction: null
  };
}
