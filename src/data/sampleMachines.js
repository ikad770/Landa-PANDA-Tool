export const sampleMachines = [];

export const mockFindings = [
  'IRD PID output exceeded warning range during Ready state sample.',
  'DPS pressure rule is loaded and waiting for parsed OPC readings.',
  'BSS blanket tension rule is ready once machine logs are scanned.'
];

export const sampleStateTimeline = [
  { state: 'Standby', width: 20 },
  { state: 'Ready', width: 30 },
  { state: 'Printing', width: 35 },
  { state: 'Maintenance', width: 15 }
];
