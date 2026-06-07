import { normalizeText } from './evaluation.js';

export function validateLoginFields({ username = '', password = '' } = {}) {
  const cleanUsername = normalizeText(username);
  const cleanPassword = String(password ?? '');
  const errors = {};
  if (!cleanUsername) errors.username = 'Username is required.';
  else if (cleanUsername.length < 2) errors.username = 'Enter a valid username.';
  if (!cleanPassword) errors.password = 'Password is required.';
  else if (cleanPassword.length < 4) errors.password = 'Password must contain at least 4 characters.';
  return { valid: Object.keys(errors).length === 0, errors, username: cleanUsername };
}

export function createLocalSession(username) {
  return { username: normalizeText(username) || 'Service User', signedInAt: new Date().toISOString() };
}
