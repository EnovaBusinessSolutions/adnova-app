// backend/middleware/sanitizeLogs.js
'use strict';

/**
 * Redacta/oculta valores sensibles en objetos o strings antes de loguearlos.
 * - Cubre Authorization, developer-token, login-customer-id, access/refresh_token, apiKey, secret, password, etc.
 * - Trunca strings muy largos para evitar volcar cuerpos completos.
 */

const SENSITIVE_KEYS = [
  'authorization',
  'developer-token',
  'login-customer-id',
  'access_token',
  'refresh_token',
  'id_token',
  'apiKey',
  'apikey',
  'secret',
  'client_secret',
  'password',
  'token',
];

const MAX_STRING = 800; // evita logs gigantes

function mask(val) {
  if (typeof val !== 'string') return val;
  const short = val.length > 16 ? val.slice(0, 12) + '…***' : '***';
  return short;
}

function redactByKey(key, val) {
  if (!key) return val;
  const k = String(key).toLowerCase();
  if (SENSITIVE_KEYS.some(s => k.includes(s))) return mask(typeof val === 'string' ? val : JSON.stringify(val));
  return val;
}

function deepRedact(input, seen = new WeakSet()) {
  if (input == null) return input;

  if (typeof input === 'string') {
    // Redactar tokens en strings sueltos (por si se loguea un raw dump)
    let out = input;
    out = out.replace(/(ya29\.[0-9a-zA-Z\-_]+)/g, 'ya29…***'); // access token Google
    out = out.replace(/(Bearer\s+[0-9a-zA-Z\.\-\_]+)/gi, 'Bearer …***');
    out = out.replace(/(developer-token|login-customer-id)\s*[:=]\s*([^\s,;]+)/gi, (_m, k) => `${k}: ***`);
    if (out.length > MAX_STRING) out = out.slice(0, MAX_STRING) + ' …[truncated]';
    return out;
  }

  if (typeof input !== 'object') return input;
  if (seen.has(input)) return '[Circular]';
  seen.add(input);

  if (Array.isArray(input)) {
    return input.map(v => deepRedact(v, seen));
  }

  const out = {};
  for (const [k, v] of Object.entries(input)) {
    if (v && typeof v === 'object') {
      out[k] = redactByKey(k, deepRedact(v, seen));
    } else {
      out[k] = redactByKey(k, v);
      if (typeof out[k] === 'string' && out[k].length > MAX_STRING) {
        out[k] = out[k].slice(0, MAX_STRING) + ' …[truncated]';
      }
    }
  }
  return out;
}

module.exports = function sanitize(obj) {
  try {
    return deepRedact(obj);
  } catch {
    return '[Unserializable log payload]';
  }
};
