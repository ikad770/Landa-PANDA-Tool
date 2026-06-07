import { MACHINE_STATE_SYSTEMS } from './config.js';
import { normalizeText } from './evaluation.js';

export function createStateIndex() {
  const series = Object.fromEntries(MACHINE_STATE_SYSTEMS.map(system => [system, []]));
  const previous = {};
  return {
    series,
    addRow(timestampMs, row) {
      for (const system of MACHINE_STATE_SYSTEMS) {
        const raw = row[system] ?? row[system.toUpperCase()] ?? row[system.toLowerCase()];
        const clean = normalizeText(raw);
        if (clean && clean !== '---' && clean.toLowerCase() !== 'null') previous[system] = clean;
        const current = previous[system];
        if (!current) continue;
        const target = series[system] || (series[system] = []);
        if (target[target.length - 1]?.value !== current) target.push({ timestampMs, value: current });
      }
    },
    finalize() {
      for (const [system, rows] of Object.entries(series)) {
        rows.sort((a, b) => a.timestampMs - b.timestampMs);
        series[system] = rows.filter((row, idx) => idx === 0 || row.timestampMs !== rows[idx - 1].timestampMs || row.value !== rows[idx - 1].value);
      }
    },
    getStateAt(timestampMs, system) {
      const machine = binaryState(series.Machine || [], timestampMs);
      const sys = binaryState(series[system] || [], timestampMs);
      return {
        machineState: machine?.value || null,
        systemState: sys?.value || null,
        status: sys ? 'matched' : machine ? 'machine_only' : 'missing',
        machineMatchedTimestampMs: machine?.timestampMs || null,
        systemMatchedTimestampMs: sys?.timestampMs || null
      };
    }
  };
}

function binaryState(rows, timestampMs) {
  let lo = 0;
  let hi = rows.length - 1;
  let match = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].timestampMs <= timestampMs) {
      match = rows[mid];
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return match;
}
