export const MACHINE_ID_PATTERN = /^[SD]\d{6,}$/i;
export const MACHINE_ID_SEARCH_PATTERN = /(?:^|[/_\-\s])([SD]\d{6,})(?=$|[/_\-\s.])/i;

export const SUPPORTED_SYSTEMS = ['BSS', 'IRD', 'IPS', 'FEC', 'ECC', 'LLCI', 'DPS', 'QCS'];

export const LOG_FILE_EXTENSIONS = [
  '.log',
  '.txt',
  '.csv',
  '.json',
  '.xml',
  '.evtx',
  '.trace',
  '.dat'
];

export const ALERT_STATUSES = ['New', 'Acknowledged', 'In Progress', 'Resolved'];
export const RULE_STATES = ['Standby', 'Ready', 'Printing', 'Maintenance', 'Error Recovery'];

export const NAV_ITEMS = [
  'Service Radar',
  'Upload Logs',
  'Rules Catalog',
  'Machines',
  'Alerts',
  'Settings'
];
