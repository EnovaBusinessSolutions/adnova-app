// backend/utils/googleAdsHelpers.js
'use strict';

/**
 * Normaliza IDs de Google Ads a solo dígitos.
 * Acepta formatos "customers/123-456-7890" o "123-456-7890" y devuelve "1234567890".
 */
function normalizeId(s = '') {
  return String(s)
    .replace(/^customers\//, '')
    .replace(/[^\d]/g, '')
    .trim();
}

function mapDatePreset(raw) {
  if (!raw) return 'last_30d';
  const v = String(raw).trim();

  // ya en minúsculas válidas → devuélvelo tal cual
  const low = v.toLowerCase();
  const allowedLow = new Set([
    'today',
    'yesterday',
    'this_month',
    'last_7d',
    'last_14d',
    'last_28d',
    'last_60d',
    'last_90d',
    'last_30d', // fallback canónico
  ]);
  if (allowedLow.has(low)) return low;

  // normaliza variantes en MAYÚSCULAS/mixtas → minúsculas del service
  const up = v.toUpperCase().replace(/\s+/g, '');

  // básicos
  if (up === 'TODAY') return 'today';
  if (up === 'YESTERDAY') return 'yesterday';
  if (up === 'THIS_MONTH' || up === 'THISMONTH') return 'this_month';

  // last_X_days → last_Xd
  if (up === 'LAST_7_DAYS' || up === 'LAST7DAYS' || up === 'LAST_7D' || up === 'LAST7D') return 'last_7d';
  if (up === 'LAST_14_DAYS' || up === 'LAST14DAYS' || up === 'LAST_14D' || up === 'LAST14D') return 'last_14d';
  if (up === 'LAST_28_DAYS' || up === 'LAST28DAYS' || up === 'LAST_28D' || up === 'LAST28D') return 'last_28d';
  if (up === 'LAST_30_DAYS' || up === 'LAST30DAYS' || up === 'LAST_30D' || up === 'LAST30D' || up === 'LAST30')
    return 'last_30d';
  if (up === 'LAST_60_DAYS' || up === 'LAST60DAYS' || up === 'LAST_60D' || up === 'LAST60D')
    return 'last_60d';
  if (up === 'LAST_90_DAYS' || up === 'LAST90DAYS' || up === 'LAST_90D' || up === 'LAST90D')
    return 'last_90d';

  // no soportado por el service → aprox razonable
  if (up === 'LAST_MONTH' || up === 'LASTMONTH') return 'last_30d';

  // patrones tipo LAST_XXD o LASTXXD
  const m = up.match(/^LAST_?(\d{1,3})D$/);
  if (m) {
    const n = Number(m[1]);
    if (n === 7) return 'last_7d';
    if (n === 14) return 'last_14d';
    if (n === 28) return 'last_28d';
    if (n === 30) return 'last_30d';
    if (n === 60) return 'last_60d';
    if (n === 90) return 'last_90d';
    // cualquier otro valor cae al fallback
  }

  // Fallback canónico
  return 'last_30d';
}

/**
 * Firma de compatibilidad: devuelve metadatos útiles para logging.
 */
function getAdsCustomer({ user, customerId, loginCustomerId }) {
  return {
    userId: user?._id || null,
    customerId: normalizeId(customerId || ''),
    loginCustomerId: normalizeId(loginCustomerId || ''),
  };
}

module.exports = { normalizeId, mapDatePreset, getAdsCustomer };
