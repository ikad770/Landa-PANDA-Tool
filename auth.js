import { AUTH_CONFIG } from './config.js';
import { normalizeText } from './evaluation.js';

export function validateLoginFields({ username = '', password = '' } = {}) {
  const cleanUsername = normalizeText(username);
  const cleanPassword = String(password ?? '');
  const errors = {};
  if (!cleanUsername) errors.username = 'Username is required.';
  if (!cleanPassword) errors.password = 'Password is required.';
  return { valid: Object.keys(errors).length === 0, errors, username: cleanUsername, password: cleanPassword };
}

export function authenticateLocalPrototype({ username = '', password = '' } = {}) {
  const validation = validateLoginFields({ username, password });
  if (!validation.valid) return { ok: false, ...validation };
  const ok = validation.username === AUTH_CONFIG.username && validation.password === AUTH_CONFIG.password;
  return { ok, valid: true, errors: {}, username: validation.username, message: ok ? '' : 'Invalid username or password.' };
}

export function createLocalSession(username) {
  return { username: normalizeText(username) || AUTH_CONFIG.username, signedInAt: new Date().toISOString() };
}

export function readStoredSession(storage = globalThis.sessionStorage) {
  try {
    const raw = storage?.getItem(AUTH_CONFIG.sessionKey);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function storeSession(session, storage = globalThis.sessionStorage) {
  storage?.setItem(AUTH_CONFIG.sessionKey, JSON.stringify(session));
}

export function clearSession(storage = globalThis.sessionStorage) {
  storage?.removeItem(AUTH_CONFIG.sessionKey);
}
