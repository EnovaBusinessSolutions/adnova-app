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

/* ---------------- helpers ---------------- */
const GA_SCOPE_READ = 'https://www.googleapis.com/auth/analytics.readonly';

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

  // 3) property a usar
  const propertyRaw =
    property_id ||
    acc.defaultPropertyId ||
    acc.gaProperties?.[0]?.propertyId ||
    '';
  const property = normPropertyId(propertyRaw);
  if (!property) {
    return { notAuthorized: true, reason: 'NO_DEFAULT_PROPERTY' };
  }

  // metadata de cuenta / propiedad (si está en gaProperties)
  const meta = (Array.isArray(acc.gaProperties) ? acc.gaProperties : []).find(p =>
    normPropertyId(p.propertyId) === property
  ) || {};
  const accountName  = meta.accountName || meta.account || '';
  const propertyName = meta.displayName || '';

  // 4) token (con refresco si es necesario)
  let token = acc.accessToken || null;
  if (!token && acc.refreshToken) token = await ensureAccessToken(acc);
  if (!token) {
    return { notAuthorized: true, reason: 'NO_ACCESS_TOKEN', property, accountName, propertyName };
  }

  const dateRange = resolveDateRange({ start, end });

  // 5) Reporte por canales
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
      return { notAuthorized: true, reason, property, accountName, propertyName, dateRange };
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

  return {
    notAuthorized: false,
    property,
    accountName,
    propertyName,
    dateRange,
    channels, // siempre arreglo (posible [])
  };
}

module.exports = { collectGA4 };
