export function buildAlert({ reading, rule, evaluation, stateContext, durationSec = 0 }) {
  return {
    id: `${reading.machineId}-${rule.id}-${reading.timestamp}`,
    machineId: reading.machineId,
    system: rule.system,
    component: rule.component,
    signalName: rule.signalName,
    state: stateContext.machineState,
    severity: evaluation.status,
    confidence: evaluation.status === 'critical' ? 0.86 : 0.72,
    startTime: reading.timestamp,
    durationSec,
    ruleId: rule.id,
    evidence: evaluation.evidence,
    recommendedAction: rule.recommendedAction,
    status: 'New'
  };
}

export function buildMockAlerts(rules) {
  return rules.slice(0, 3).map((rule, index) => ({
    id: `mock-alert-${index + 1}`,
    machineId: index === 0 ? 'Awaiting upload' : 'Sample context',
    system: rule.system,
    component: rule.component,
    signalName: rule.signalName,
    state: rule.applicableStates[0],
    severity: index === 0 ? 'warning' : 'normal',
    confidence: index === 0 ? 0.74 : 0.61,
    startTime: 'Pending parsed readings',
    durationSec: rule.allowedDurationSec,
    ruleId: rule.id,
    evidence: `Rule ${rule.id} is loaded and ready for parsed ${rule.sourceLog} readings.`,
    recommendedAction: rule.recommendedAction,
    status: 'New'
  }));
}
