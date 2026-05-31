import { isInsideTransitionGrace, isStateApplicable } from './stateEvaluator.js';

function isNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function evidenceFor(reading, rule, status, reason) {
  const unit = reading.unit || rule.unit || '';
  const state = reading.state || 'state context';
  return `${reading.signalName}=${reading.value}${unit ? ` ${unit}` : ''} for ${reading.machineId} evaluated against ${rule.id} in ${state}: ${status} (${reason}).`;
}

export function evaluateReading(reading, rule, stateContext) {
  if (!isStateApplicable(rule, stateContext)) {
    const reason = `Rule applies to ${rule.applicableStates.join(', ')}, not ${stateContext.machineState}.`;
    return { status: 'ignored', reason, severity: 0, evidence: evidenceFor(reading, rule, 'ignored', reason) };
  }

  if (isInsideTransitionGrace(rule, stateContext)) {
    const reason = `Reading is inside ${rule.transitionGraceSec}s transition grace window.`;
    return { status: 'ignored', reason, severity: 0, evidence: evidenceFor(reading, rule, 'ignored', reason) };
  }

  const value = Number(reading.value);
  if (!isNumber(value)) {
    const reason = 'Reading value is not numeric.';
    return { status: 'ignored', reason, severity: 0, evidence: evidenceFor(reading, rule, 'ignored', reason) };
  }

  const criticalLowHit = isNumber(rule.criticalLow) && value < rule.criticalLow;
  const criticalHighHit = isNumber(rule.criticalHigh) && value > rule.criticalHigh;
  if (criticalLowHit || criticalHighHit) {
    const reason = criticalLowHit ? `Value is below critical low ${rule.criticalLow}.` : `Value is above critical high ${rule.criticalHigh}.`;
    return { status: 'critical', reason, severity: 3, evidence: evidenceFor(reading, rule, 'critical', reason) };
  }

  const warningLowHit = isNumber(rule.warningLow) && value < rule.warningLow;
  const warningHighHit = isNumber(rule.warningHigh) && value > rule.warningHigh;
  if (warningLowHit || warningHighHit) {
    const reason = warningLowHit ? `Value is below warning low ${rule.warningLow}.` : `Value is above warning high ${rule.warningHigh}.`;
    return { status: 'warning', reason, severity: 2, evidence: evidenceFor(reading, rule, 'warning', reason) };
  }

  const reason = 'Reading is within configured numeric ranges.';
  return { status: 'normal', reason, severity: 1, evidence: evidenceFor(reading, rule, 'normal', reason) };
}

export function rulesForSystem(rules, system) {
  if (!system) return rules;
  return rules.filter((rule) => rule.system === system);
}
