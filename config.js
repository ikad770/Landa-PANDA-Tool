export const AUTH_CONFIG = {
  username: 'Landa',
  password: 'Landa123456',
  sessionKey: 'panda_authenticated'
};

export const V2_PROGRESS_STAGES = [
  { key: 'upload', label: 'Upload', start: 0, end: 12 },
  { key: 'parse', label: 'Parse', start: 12, end: 45 },
  { key: 'index', label: 'Index', start: 45, end: 65 },
  { key: 'analyze', label: 'Analyze', start: 65, end: 88 },
  { key: 'finalize', label: 'Finalize', start: 88, end: 99 },
  { key: 'complete', label: 'Complete', start: 100, end: 100 }
];

export const USER_FACING_STAGES = V2_PROGRESS_STAGES.filter(stage => stage.key !== 'complete').map(stage => ({
  key: stage.key,
  label: stage.label,
  weight: stage.end - stage.start,
  stages: [stage.key]
}));

export const PROGRESS_MESSAGES = {
  upload: 'Receiving archive and rules workbook…',
  parse: 'Parsing supported text logs and rules…',
  index: 'Building signal and state indexes…',
  analyze: 'Evaluating configured signal streams…',
  finalize: 'Building bounded V2 result…',
  complete: 'Analysis complete.'
};

export const MAX_CHART_POINTS_PER_SIGNAL = 1500;
export const MAX_CONFIGURED_CHART_POINTS = 3000;
export const MAX_DEVIATION_EVENTS_PER_RULE = 200;
export const MAX_DIAGNOSTIC_ENTRIES = 250;
export const MAX_DIAGNOSTIC_MESSAGE_LENGTH = 500;
export const MAX_STACK_FRAMES = 10;
export const MAX_STATE_LOOKUP_GAP_MS = 30 * 60 * 1000;

export const MACHINE_STATE_SYSTEMS = ['Machine', 'BSS', 'IPS', 'PSS', 'Dryer', 'IPU', 'Ventilation', 'CWS', 'IRD', 'DFES', 'DPS', 'QCS', 'ICS', 'ECS', 'MSPS', 'ITS'];
export const SYSTEMS = ['DPS', 'DFES', 'MSPS', 'ITS', 'IPS', 'ICS', 'Ventilation', 'ECS', 'IRD', 'QCS', 'BSS', 'STS', 'IPU', 'FEC', 'CWS', 'PSS', 'Dryer', 'Machine', 'Unassigned'];

export const STATUS_PRIORITY = {
  critical: 90,
  warning: 70,
  ok: 50,
  needs_validation: 40,
  needs_configuration: 30,
  no_data: 20,
  no_rule: 10,
  not_analyzed: 0
};

export const STATUS_TAXONOMY = {
  critical: { label: 'Critical', shortLabel: 'Critical', cssClass: 'critical', icon: '●' },
  warning: { label: 'Warning', shortLabel: 'Warning', cssClass: 'warning', icon: '▲' },
  ok: { label: 'OK', shortLabel: 'OK', cssClass: 'ok', icon: '✓' },
  needs_validation: { label: 'Needs validation', shortLabel: 'Validate', cssClass: 'needs-validation', icon: '?' },
  needs_configuration: { label: 'Needs configuration', shortLabel: 'Config', cssClass: 'needs-configuration', icon: '!' },
  no_data: { label: 'No data', shortLabel: 'No data', cssClass: 'no-data', icon: '○' },
  no_rule: { label: 'No Rule', shortLabel: 'No Rule', cssClass: 'no-rule', icon: '◇' },
  not_analyzed: { label: 'Not analyzed', shortLabel: 'Pending', cssClass: 'not-analyzed', icon: '○' }
};
export const STATUS_LABEL = Object.fromEntries(Object.entries(STATUS_TAXONOMY).map(([key, value]) => [key, value.label]));

export function normalizeSourceIdentity(value) {
  return String(value || 'unknown')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .slice(-2)
    .join('/')
    .replace(/\.(csv|txt|log)$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9/]+/g, '_') || 'unknown';
}
