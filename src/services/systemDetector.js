import { systemCatalog } from '../data/systemCatalog.js';

export function detectSystemsFromPath(path) {
  const lower = String(path || '').toLowerCase();
  const systems = systemCatalog
    .filter((system) => system.terms.some((term) => lower.includes(term.toLowerCase())) || lower.includes(`/${system.key.toLowerCase()}/`))
    .map((system) => system.key);
  return [...new Set(systems)];
}

export function systemName(systemKey) {
  return systemCatalog.find((system) => system.key === systemKey)?.name || systemKey;
}
