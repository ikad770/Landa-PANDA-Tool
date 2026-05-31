export function isStateApplicable(rule, stateContext) {
  const applicableStates = rule.applicableStates || [];
  if (applicableStates.length === 0) return true;
  return applicableStates.includes(stateContext.machineState);
}

export function isInsideTransitionGrace(rule, stateContext) {
  if (!stateContext.isTransition) return false;
  const grace = Number(rule.transitionGraceSec || 0);
  return Number(stateContext.transitionAgeSec || 0) < grace;
}
