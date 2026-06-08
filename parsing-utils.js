import { parseDelimitedText } from './adapters.js';

export function appendRows(target, source) {
  for (const row of source) {
    target.push(row);
  }
}

export function parseTextLogsToRows(logs, progress = () => {}) {
  const rows = [];
  let processed = 0;
  for (const log of logs) {
    appendRows(rows, parseDelimitedText(log.text, log.name));
    processed += 1;
    progress(processed, logs.length, log.name, rows.length);
  }
  return rows;
}
