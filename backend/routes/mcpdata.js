// backend/routes/mcpdata.js
'use strict';

const express = require('express');
const router = express.Router();

const McpData = require('../models/McpData');

let MetaAccount = null;
let GoogleAccount = null;
try { MetaAccount = require('../models/MetaAccount'); } catch {}
try { GoogleAccount = require('../models/GoogleAccount'); } catch {}

function ymd(d = new Date()) {
  const x = new Date(d);
  const yyyy = x.getUTCFullYear();
  const mm = String(x.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(x.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function pickMetaAccount(meta) {
  const selected = Array.isArray(meta?.selectedAccountIds) ? meta.selectedAccountIds : [];
  const act = selected[0] || meta?.defaultAccountId || meta?.ad_accounts?.[0]?.id || meta?.adAccounts?.[0]?.id || null;
  if (!act) return null;

  const pool = (meta?.ad_accounts?.length ? meta.ad_accounts : meta?.adAccounts) || [];
  const found = pool.find(a => String(a?.id || a?.account_id || '') === String(act)) || null;

  return {
    accountId: String(act),
    name: found?.name || found?.account_name || null,
    currency: found?.currency || found?.account_currency || null,
    timezone: found?.timezone_name || found?.timezone || null,
  };
}

function pickGoogleAdsCustomer(ga) {
  const selected = Array.isArray(ga?.selectedCustomerIds) ? ga.selectedCustomerIds : [];
  const cid =
    selected[0] ||
    ga?.defaultCustomerId ||
    ga?.customers?.[0]?.id ||
    ga?.ad_accounts?.[0]?.id ||
    null;

  if (!cid) return null;

  const pool = [
    ...(Array.isArray(ga?.customers) ? ga.customers : []),
    ...(Array.isArray(ga?.ad_accounts) ? ga.ad_accounts : []),
  ];
  const found = pool.find(x => String(x?.id || '') === String(cid)) || null;

  return {
    customerId: String(cid),
    name: found?.descriptiveName || found?.name || null,
    currency: found?.currencyCode || null,
    timezone: found?.timeZone || null,
  };
}

function pickGa4Property(ga) {
  const selected = Array.isArray(ga?.selectedPropertyIds) ? ga.selectedPropertyIds : [];
  const pid =
    selected[0] ||
    ga?.defaultPropertyId ||
    ga?.gaProperties?.[0]?.propertyId ||
    ga?.selectedGaPropertyId ||
    null;

  if (!pid) return null;

  const pool = Array.isArray(ga?.gaProperties) ? ga.gaProperties : [];
  const found = pool.find(p => String(p?.propertyId || '') === String(pid)) || null;

  return {
    propertyId: String(pid),
    name: found?.displayName || null,
    currency: found?.currencyCode || null,
    timezone: found?.timeZone || null,
  };
}

/**
 * POST /api/mcpdata/bootstrap
 * Crea/actualiza el ROOT del usuario en mcpdata usando selecciones actuales.
 */
router.post('/bootstrap', async (req, res) => {
  try {
    const userId = req.user?._id;
    if (!userId) return res.status(401).json({ ok: false, error: 'NO_SESSION' });

    const meta = MetaAccount ? await MetaAccount.findOne({ $or: [{ user: userId }, { userId }] }).lean() : null;
    const google = GoogleAccount ? await GoogleAccount.findOne({ $or: [{ user: userId }, { userId }] }).lean() : null;

    const metaPick = meta ? pickMetaAccount(meta) : null;
    const adsPick = google ? pickGoogleAdsCustomer(google) : null;
    const ga4Pick = google ? pickGa4Property(google) : null;

    const snapshotId = `snap_${ymd(new Date())}`;

    const rootPatch = {
      latestSnapshotId: snapshotId,
      coverage: {
        range: { from: null, to: null, tz: 'America/Mexico_City' },
        defaultRangeDays: 30,
        granularity: ['daily', 'campaign', 'adset', 'ad', 'landing_page'],
      },
      sources: {
        metaAds: {
          connected: !!meta,
          ready: !!(meta && metaPick),
          accountId: metaPick?.accountId || null,
          name: metaPick?.name || null,
          currency: metaPick?.currency || null,
          timezone: metaPick?.timezone || null,
          lastSyncAt: null,
          lastError: null,
        },
        googleAds: {
          connected: !!google?.connectedAds,
          ready: !!(google?.connectedAds && adsPick),
          customerId: adsPick?.customerId || null,
          name: adsPick?.name || null,
          currency: adsPick?.currency || null,
          timezone: adsPick?.timezone || null,
          lastSyncAt: null,
          lastError: null,
        },
        ga4: {
          connected: !!google?.connectedGa4,
          ready: !!(google?.connectedGa4 && ga4Pick),
          propertyId: ga4Pick?.propertyId || null,
          name: ga4Pick?.name || null,
          currency: ga4Pick?.currency || null,
          timezone: ga4Pick?.timezone || null,
          lastSyncAt: null,
          lastError: null,
        },
      },
    };

    const root = await McpData.upsertRoot(userId, rootPatch);
    return res.json({ ok: true, data: root });
  } catch (e) {
    console.error('[mcpdata/bootstrap] error:', e);
    return res.status(500).json({ ok: false, error: 'MCP_BOOTSTRAP_FAILED' });
  }
});

/**
 * POST /api/mcpdata/mock
 * Inserta un CHUNK de prueba para validar escritura.
 */
router.post('/mock', async (req, res) => {
  try {
    const userId = req.user?._id;
    if (!userId) return res.status(401).json({ ok: false, error: 'NO_SESSION' });

    const snapshotId = `snap_${ymd(new Date())}`;

    const chunk = await McpData.insertChunk({
      userId,
      snapshotId,
      source: 'metaAds',
      dataset: 'meta.insights_daily_campaign',
      range: { from: ymd(Date.now() - 7 * 86400000), to: ymd(), tz: 'America/Mexico_City' },
      data: [
        { date: ymd(Date.now() - 2 * 86400000), spend: 120.5, clicks: 88, impressions: 12000, conversions: 6 },
        { date: ymd(Date.now() - 1 * 86400000), spend: 98.2,  clicks: 71, impressions: 9800,  conversions: 4 },
      ],
      stats: { rows: 2, bytes: 0 },
    });

    return res.json({ ok: true, data: chunk });
  } catch (e) {
    console.error('[mcpdata/mock] error:', e);
    return res.status(500).json({ ok: false, error: 'MCP_MOCK_FAILED' });
  }
});

module.exports = router;