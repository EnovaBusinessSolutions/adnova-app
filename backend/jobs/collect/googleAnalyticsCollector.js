// backend/api/jobs/collect/googleAnalyticsCollector.js
'use strict';

const fetch = require('node-fetch');
const mongoose = require('mongoose');
const { OAuth2Client } = require('google-auth-library');

const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_CONNECT_CALLBACK_URL: GOOGLE_REDIRECT_URI,
} = process.env;

/* ---------------- models ---------------- */
let GoogleAccount;
try { GoogleAccount = require('../../models/GoogleAccount'); }
catch (_) {
  const { Schema, model } = mongoose;
  const schema = new Schema({
    user: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    accessToken: { type: String, select: false },
    refreshToken:{ type: String, select: false },
    gaProperties: { type: Array, default: [] }, // [{ propertyId, displayName, account, accountName? }, ...]
    defaultPropertyId: String,
    scope: { type: [String], default: [] },
    expiresAt: { type: Date },
    updatedAt: { type: Date, default: Date.now },
  }, { collection: 'googleaccounts' });
  schema.pre('save', function(n){ this.updatedAt = new Date(); n(); });
  GoogleAccount = mongoose.models.GoogleAccount || model('GoogleAccount', schema);
}

// NEW: leer selección desde User.preferences
let UserModel = null;
try { UserModel = require('../../models/User'); } catch (_) {}

/* ---------------- helpers ---------------- */
const GA_SCOPE_READ = 'https://www.googleapis.com/auth/analytics.readonly';
const MAX_BY_RULE = 3; // máx. 3 propiedades por auditoría

const normPropertyId = (val) => {
  if (!val) return '';
  const v = String(val).trim();
  if (/^properties\/\d+$/.test(v)) return v;
  const onlyDigits = v.replace(/[^\d]/g, '');
  return onlyDigits ? `properties/${onlyDigits}` : '';
};

const toNum = (v) => Number(v || 0);

function oauthClient() {
  return new OAuth2Client({
    clientId: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    redirectUri: GOOGLE_REDIRECT_URI,
  });
}

/** Refresca y persiste el accessToken usando refreshToken */
async function ensureAccessToken(gaDoc) {
  if (gaDoc?.accessToken) return gaDoc.accessToken;
  if (!gaDoc?.refreshToken) return null;

  const client = oauthClient();
  client.setCredentials({ refresh_token: gaDoc.refreshToken });

  const { credentials } = await client.refreshAccessToken();
  const token = credentials?.access_token || null;

  if (token) {
    await GoogleAccount.updateOne(
      { _id: gaDoc._id },
      {
        $set: {
          accessToken: token,
          expiresAt: credentials?.expiry_date ? new Date(credentials.expiry_date) : null,
          updatedAt: new Date(),
        }
      }
    );
  }
  return token;
}

/** Ejecuta runReport de GA4 */
async function ga4RunReport({ token, property, body }) {
  const url = `https://analyticsdata.googleapis.com/v1beta/${property}:runReport`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg  = j?.error?.message || `GA4 runReport failed (HTTP_${r.status})`;
    const code = j?.error?.status || '';
    const err  = new Error(msg);
    err._ga = { code, http: r.status };
    throw err;
  }
  return j;
}

/** '30daysAgo' / 'yesterday' → GA4 acepta estos literales tal cual */
function resolveDateRange({ start = '30daysAgo', end = 'yesterday' }) {
  const abs = /^\d{4}-\d{2}-\d{2}$/;
  const isAbs = abs.test(String(start)) && abs.test(String(end));
  return isAbs ? { start, end } : { start, end };
}

/* -------- selección de propiedades (respeta preferencias) -------- */

function listAvailableProperties(acc) {
  const list = Array.isArray(acc?.gaProperties) ? acc.gaProperties : [];
  // normaliza a { id, displayName, accountName }
  return list.map(p => {
    const id = normPropertyId(p?.propertyId || p?.id);
    return id ? { id, displayName: p?.displayName || '', accountName: p?.accountName || p?.account || '' } : null;
  }).filter(Boolean);
}

async function resolvePropertiesForAudit({ userId, accDoc, forcedPropertyId }) {
  // 1) universo disponible
  let available = listAvailableProperties(accDoc);

  // 2) override del caller (forzar una sola)
  if (forcedPropertyId) {
    const id = normPropertyId(forcedPropertyId);
    if (id) return [{ id, displayName: '', accountName: '' }];
  }

  // 3) sin override: si no hay lista, caer a defaultPropertyId
  if (!available.length) {
    const d = normPropertyId(accDoc?.defaultPropertyId);
    if (d) available = [{ id: d, displayName: '', accountName: '' }];
  }
  if (!available.length) return { error: 'NO_DEFAULT_PROPERTY' };

  // 4) leer preferencias del usuario
  let selected = [];
  if (UserModel && userId) {
    const user = await UserModel.findById(userId).lean().select('preferences');
    selected = Array.isArray(user?.preferences?.googleAnalytics?.auditPropertyIds)
      ? user.preferences.googleAnalytics.auditPropertyIds.map(normPropertyId).filter(Boolean)
      : [];
  }

  // 5) si hay selección explícita, úsala (máx. 3 y validada)
  if (selected.length > 0) {
    const byId = new Map(available.map(a => [a.id, a]));
    const picked = [...new Set(selected)].filter(id => byId.has(id)).slice(0, MAX_BY_RULE).map(id => byId.get(id));
    if (picked.length === 0) return { error: 'NO_VALID_SELECTED_PROPERTIES' };
    return picked;
  }

  // 6) sin selección: si disponibles <=3, usa todas; si >3, requiere selección
  if (available.length <= MAX_BY_RULE) return available;

  return { error: 'SELECTION_REQUIRED(>3_PROPERTIES)', availableCount: available.length };
}

/* ---------------- collector ---------------- */
async function collectGA4(userId, { property_id, start = '30daysAgo', end = 'yesterday' } = {}) {
  // 1) Cargar cuenta con tokens y scopes
  const acc = await GoogleAccount
    .findOne({ $or: [{ user: userId }, { userId }] })
    .select('+accessToken +refreshToken scope defaultPropertyId gaProperties')
    .lean();

  if (!acc) {
    return { notAuthorized: true, reason: 'NO_GOOGLEACCOUNT' };
  }

  // 2) Validar scope explícitamente para mensajes claros
  const hasScope = Array.isArray(acc.scope) && acc.scope.includes(GA_SCOPE_READ);
  if (!hasScope) {
    return { notAuthorized: true, reason: 'MISSING_SCOPE(analytics.readonly)' };
  }

  // 3) token (con refresco si es necesario)
  let token = acc.accessToken || null;
  if (!token && acc.refreshToken) token = await ensureAccessToken(acc);
  if (!token) {
    return { notAuthorized: true, reason: 'NO_ACCESS_TOKEN' };
  }

  // 4) resolver propiedades a auditar (respeta selección del usuario)
  const resolved = await resolvePropertiesForAudit({
    userId,
    accDoc: acc,
    forcedPropertyId: property_id
  });

  if (resolved?.error) {
    if (resolved.error === 'NO_DEFAULT_PROPERTY') {
      return { notAuthorized: true, reason: 'NO_DEFAULT_PROPERTY' };
    }
    if (resolved.error === 'NO_VALID_SELECTED_PROPERTIES') {
      return { notAuthorized: true, reason: 'NO_VALID_SELECTED_PROPERTIES' };
    }
    if (resolved.error.startsWith('SELECTION_REQUIRED')) {
      console.warn('[ga4Collector] Precondición: usuario tiene >3 propiedades sin selección explícita.');
      return { notAuthorized: true, reason: resolved.error, requiredSelection: true };
    }
  }

  const propertiesToAudit = (Array.isArray(resolved) ? resolved : []).slice(0, MAX_BY_RULE);

  // Log de diagnóstico
  try {
    if (UserModel && userId) {
      const user = await UserModel.findById(userId).lean().select('preferences');
      console.log('[ga4Collector] auditPropertyIds(pref):', user?.preferences?.googleAnalytics?.auditPropertyIds || []);
    }
  } catch {}
  console.log('[ga4Collector] -> auditing GA4 properties:', propertiesToAudit.map(p => p.id));

  const dateRange = resolveDateRange({ start, end });

  // 5) Reporte base (por canales)
  const reportBody = {
    dateRanges: [{ startDate: dateRange.start, endDate: dateRange.end }],
    dimensions: [{ name: 'sessionDefaultChannelGroup' }],
    metrics: [
      { name: 'totalUsers' },
      { name: 'sessions' },
      { name: 'conversions' },
      { name: 'purchaseRevenue' },
    ],
    limit: '1000',
  };

  const byProperty = [];
  let aggregate = { users: 0, sessions: 0, conversions: 0, revenue: 0 };

  // 6) Ejecutar para cada propiedad seleccionada
  for (const prop of propertiesToAudit) {
    const property = prop.id;
    const meta = (Array.isArray(acc.gaProperties) ? acc.gaProperties : []).find(p =>
      normPropertyId(p.propertyId) === property
    ) || {};
    const accountName  = meta.accountName || meta.account || prop.accountName || '';
    const propertyName = meta.displayName || prop.displayName || '';

    let j;
    try {
      j = await ga4RunReport({ token, property, body: reportBody });
    } catch (e) {
      const http = e?._ga?.http;
      // 401/403 → intentamos refrescar token una vez
      if ((http === 401 || http === 403) && acc.refreshToken) {
        token = await ensureAccessToken({ ...acc, accessToken: null });
        j = await ga4RunReport({ token, property, body: reportBody });
      } else {
        const msg = e?.message || 'GA4 runReport failed';
        const reason = (e?._ga?.code === 'PERMISSION_DENIED') ? 'PERMISSION_DENIED(analytics.readonly?)' : msg;
        byProperty.push({
          property,
          accountName,
          propertyName,
          dateRange,
          error: true,
          reason,
          channels: [],
        });
        continue; // sigue con las demás propiedades
      }
    }

    const rows = Array.isArray(j?.rows) ? j.rows : [];
    const channels = rows.map(rw => ({
      channel:     rw.dimensionValues?.[0]?.value || '(other)',
      users:       toNum(rw.metricValues?.[0]?.value),
      sessions:    toNum(rw.metricValues?.[1]?.value),
      conversions: toNum(rw.metricValues?.[2]?.value),
      revenue:     toNum(rw.metricValues?.[3]?.value),
    }));

    // Suma al agregado
    for (const c of channels) {
      aggregate.users += c.users || 0;
      aggregate.sessions += c.sessions || 0;
      aggregate.conversions += c.conversions || 0;
      aggregate.revenue += c.revenue || 0;
    }

    byProperty.push({
      property,
      accountName,
      propertyName,
      dateRange,
      channels,
    });
  }

  // Compat: si sólo hubo una propiedad, exponemos los campos “simples” también
  if (byProperty.length === 1) {
    const p = byProperty[0];
    return {
      notAuthorized: false,
      property: p.property,
      accountName: p.accountName,
      propertyName: p.propertyName,
      dateRange,
      channels: p.channels,
      byProperty,
      aggregate,
    };
  }

  return {
    notAuthorized: false,
    dateRange,
    byProperty,    // [{ property, accountName, propertyName, channels, ... }]
    aggregate,     // suma de métricas básicas
  };
}

module.exports = { collectGA4 };
