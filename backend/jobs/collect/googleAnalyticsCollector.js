'use strict';
/**
 * Collector GA4 (Analytics Data API)
 * Requiere: GoogleAccount con accessToken y defaultPropertyId (formato "properties/123")
 */

const fetch = require('node-fetch');
const mongoose = require('mongoose');

let GoogleAccount;
try { GoogleAccount = require('../../models/GoogleAccount'); }
catch (_) {
  const { Schema, model } = mongoose;
  const schema = new Schema({
    user: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    accessToken: { type: String, select: false },
    refreshToken:{ type: String, select: false },
    gaProperties: { type: Array, default: [] },
    defaultPropertyId: String,
    scope: { type: [String], default: [] },
  }, { collection: 'googleaccounts' });
  GoogleAccount = mongoose.models.GoogleAccount || model('GoogleAccount', schema);
}

async function collectGA4(userId, { property_id, start='30daysAgo', end='yesterday' } = {}) {
  const acc = (typeof GoogleAccount.findWithTokens === 'function')
    ? await GoogleAccount.findWithTokens({ user: userId }).lean()
    : await GoogleAccount.findOne({ user: userId }).select('+accessToken +refreshToken').lean();

  if (!acc) return { notAuthorized: true, reason: 'NO_GOOGLEACCOUNT' };

  const token = acc.accessToken;
  const property = property_id || acc.defaultPropertyId || acc.gaProperties?.[0]?.propertyId;
  if (!token || !property) {
    return { notAuthorized: true, reason: !token ? 'NO_ACCESS_TOKEN' : 'NO_DEFAULT_PROPERTY' };
  }

  // Dimensiones/Métricas útiles por canal
  const body = {
    dateRanges: [{ startDate: start, endDate: end }],
    dimensions: [{ name: 'sessionDefaultChannelGroup' }],
    metrics: [{ name: 'totalUsers' }, { name: 'sessions' }, { name: 'conversions' }, { name: 'purchaseRevenue' }],
    limit: '1000'
  };

  const r = await fetch(`https://analyticsdata.googleapis.com/v1beta/${property}:runReport`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const j = await r.json();
  if (!r.ok) {
    const msg = j?.error?.message || 'GA4 runReport failed';
    return { notAuthorized: true, reason: msg, channels: [] };
  }

  const rows = Array.isArray(j.rows) ? j.rows : [];
  const channels = rows.map(rw => ({
    channel: rw.dimensionValues?.[0]?.value || '(other)',
    users: Number(rw.metricValues?.[0]?.value || 0),
    sessions: Number(rw.metricValues?.[1]?.value || 0),
    conversions: Number(rw.metricValues?.[2]?.value || 0),
    revenue: Number(rw.metricValues?.[3]?.value || 0),
  }));

  return {
    notAuthorized: false,
    property,
    dateRange: { start, end },
    channels
  };
}

module.exports = { collectGA4 };
