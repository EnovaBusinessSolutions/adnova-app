// backend/utils/googleAdsHelpers.js
'use strict';

/** Normaliza IDs a solo dígitos (y quita 'customers/'). */
function normalizeId(s = '') {
  return String(s).replace(/^customers\//, '').replace(/[^\d]/g, '').trim();
}

/** Mapea presets a los que entiende el backend/Google (con compat). */
function mapDatePreset(raw) {
  const v = String(raw || '').toUpperCase();

  // Compatibilidad: last_30d → LAST_30_DAYS, etc.
  const lc = String(raw || '').toLowerCase();
  if (lc === 'last_30d') return 'LAST_30_DAYS';
  if (lc === 'last_7d')  return 'LAST_7_DAYS';

  // Acepta TODAY/YESTERDAY/LAST_7_DAYS/LAST_14_DAYS/LAST_30_DAYS/THIS_MONTH/LAST_MONTH
  const allowed = new Set([
    'TODAY','YESTERDAY','LAST_7_DAYS','LAST_14_DAYS','LAST_30_DAYS','THIS_MONTH','LAST_MONTH'
  ]);
  if (allowed.has(v)) return v;

  // Acepta LAST_30D / LAST30D / LAST_90D...
  if (/^LAST_?\d{1,3}D$/.test(v)) return v.replace('_', '');

  return 'LAST_30_DAYS';
}

/**
 * Firma de compatibilidad: el router lo invoca pero no necesita el SDK.
 * Devolvemos solo metadatos normalizados por si los quisieras loguear.
 */
function getAdsCustomer({ user, customerId, loginCustomerId }) {
  return {
    userId: user?._id || null,
    customerId: normalizeId(customerId || ''),
    loginCustomerId: normalizeId(loginCustomerId || ''),
  };
}

module.exports = { normalizeId, mapDatePreset, getAdsCustomer };
