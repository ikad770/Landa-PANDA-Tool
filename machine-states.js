import { MACHINE_STATE_SYSTEMS, MAX_STATE_LOOKUP_GAP_MS } from './config.js';
import { normalizeState, normalizeText } from './evaluation.js';

const CANONICAL_STATES = new Set(['ON', 'Standby', 'Ready', 'Prepare2Print', 'Printing', 'PrintEnd', 'Recovery', 'Error']);

function isSupportedState(value) {
  return CANONICAL_STATES.has(normalizeState(value));
}

export function createStateIndex(options = {}) {
  const maxLookupGapMs = options.maxLookupGapMs ?? MAX_STATE_LOOKUP_GAP_MS;
  const series = Object.fromEntries(MACHINE_STATE_SYSTEMS.map(system => [system, []]));
  const previous = {};
  const unknownStates = {};
  return {
    series,
    unknownStates,
    addRow(timestampMs, row) {
      if (!Number.isFinite(timestampMs)) return;
      for (const system of MACHINE_STATE_SYSTEMS) {
        const raw = row[system] ?? row[system.toUpperCase()] ?? row[system.toLowerCase()];
        const clean = normalizeText(raw);
        if (clean && clean !== '---' && clean.toLowerCase() !== 'null') {
          const normalized = normalizeState(clean);
          previous[system] = normalized;
          if (!isSupportedState(normalized)) unknownStates[clean] = (unknownStates[clean] || 0) + 1;
        }
        const current = previous[system];
        if (!current) continue;
        const target = series[system] || (series[system] = []);
        if (target[target.length - 1]?.value !== current) target.push({ timestampMs, value: current, supported: isSupportedState(current) });
      }
    },
    finalize() {
      for (const [system, rows] of Object.entries(series)) {
        rows.sort((a, b) => a.timestampMs - b.timestampMs);
        series[system] = rows.filter((row, idx) => idx === 0 || row.timestampMs !== rows[idx - 1].timestampMs || row.value !== rows[idx - 1].value);
      }
    },
    getStateAt(timestampMs, system) {
      if (!Number.isFinite(timestampMs)) return missingState('missing');
      const machine = binaryState(series.Machine || [], timestampMs);
      const sys = binaryState(series[system] || [], timestampMs);
      const selected = sys || machine;
      if (!selected) return missingState('missing');
      const stateAgeMs = Math.max(0, timestampMs - selected.timestampMs);
      if (stateAgeMs > maxLookupGapMs) return { ...statePayload(machine, sys, selected, stateAgeMs), stateMatchStatus: 'too_old', status: 'too_old' };
      if (!selected.supported) return { ...statePayload(machine, sys, selected, stateAgeMs), stateMatchStatus: 'unsupported_state', status: 'unsupported_state' };
      const exact = selected.timestampMs === timestampMs;
      return { ...statePayload(machine, sys, selected, stateAgeMs), stateMatchStatus: exact ? 'exact' : 'previous_state', status: 'matched' };
    }
  };
}

function statePayload(machine, sys, selected, stateAgeMs) {
  return {
    machineState: machine?.value || null,
    systemState: sys?.value || null,
    matchedStateTimestamp: selected?.timestampMs ?? null,
    matchedStateTimestampMs: selected?.timestampMs ?? null,
    stateAgeMs,
    machineMatchedTimestampMs: machine?.timestampMs || null,
    systemMatchedTimestampMs: sys?.timestampMs || null
  };
}

function missingState(status) {
  return { machineState: null, systemState: null, matchedStateTimestamp: null, matchedStateTimestampMs: null, stateAgeMs: null, stateMatchStatus: status, status, machineMatchedTimestampMs: null, systemMatchedTimestampMs: null };
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
