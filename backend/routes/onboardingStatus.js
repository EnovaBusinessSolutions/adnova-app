// backend/routes/onboardingStatus.js
'use strict';

const express = require('express');
const mongoose = require('mongoose');

const router = express.Router();

const User = require('../models/User');

let MetaAccount, GoogleAccount, ShopConnections;
try { MetaAccount = require('../models/MetaAccount'); } catch {
  const { Schema, model } = mongoose;
  MetaAccount = mongoose.models.MetaAccount ||
    model('MetaAccount', new Schema({}, { strict: false, collection: 'metaaccounts' }));
}
try { GoogleAccount = require('../models/GoogleAccount'); } catch {
  const { Schema, model } = mongoose;
  GoogleAccount = mongoose.models.GoogleAccount ||
    model('GoogleAccount', new Schema({}, { strict: false, collection: 'googleaccounts' }));
}
try { ShopConnections = require('../models/ShopConnections'); } catch {
  const { Schema, model } = mongoose;
  ShopConnections = mongoose.models.ShopConnections ||
    model('ShopConnections', new Schema({}, { strict: false, collection: 'shopconnections' }));
}

/* ======================= helpers ======================= */
function requireAuth(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
}

const MAX_BY_RULE = 3;

const normActId = (s = '') => String(s).trim().replace(/^act_/, '');
const normGaId  = (s = '') => String(s).trim().replace(/^customers\//, '').replace(/[^\d]/g, '');

function selectedMetaFromDocOrUser(metaDoc, user) {
  const fromDoc = Array.isArray(metaDoc?.selectedAccountIds) ? metaDoc.selectedAccountIds.map(normActId) : [];
  if (fromDoc.length) return [...new Set(fromDoc.filter(Boolean))];
  const legacy = Array.isArray(user?.selectedMetaAccounts) ? user.selectedMetaAccounts.map(normActId) : [];
  return [...new Set(legacy.filter(Boolean))];
}

function selectedGoogleFromDocOrUser(gaDoc, user) {
  const fromDoc = Array.isArray(gaDoc?.selectedCustomerIds) ? gaDoc.selectedCustomerIds.map(normGaId) : [];
  if (fromDoc.length) return [...new Set(fromDoc.filter(Boolean))];
  const legacy = Array.isArray(user?.selectedGoogleAccounts) ? user.selectedGoogleAccounts.map(normGaId) : [];
  return [...new Set(legacy.filter(Boolean))];
}

function metaAvailableIds(metaDoc) {
  const list = Array.isArray(metaDoc?.ad_accounts) ? metaDoc.ad_accounts
            : Array.isArray(metaDoc?.adAccounts)  ? metaDoc.adAccounts
            : [];
  return list.map(a => normActId(a?.id || a?.account_id || '')).filter(Boolean);
}

function googleAvailableIds(gaDoc) {
  const fromAd = (Array.isArray(gaDoc?.ad_accounts) ? gaDoc.ad_accounts : []).map(a => normGaId(a?.id)).filter(Boolean);
  const fromCu = (Array.isArray(gaDoc?.customers)   ? gaDoc.customers   : []).map(c => normGaId(c?.id)).filter(Boolean);
  return [...new Set([...fromAd, ...fromCu])];
}

function hasAnyMetaToken(metaDoc) {
  return !!(metaDoc?.access_token || metaDoc?.token || metaDoc?.accessToken || metaDoc?.longLivedToken || metaDoc?.longlivedToken);
}

function hasGoogleAdsOAuth(gaDoc) {
  return !!(gaDoc?.refreshToken || gaDoc?.accessToken);
}

function isGA4Connected(gaDoc) {
  // Requiere OAuth de Google y al menos una propiedad GA4 conocida
  const hasOauth = hasGoogleAdsOAuth(gaDoc);
  const props = Array.isArray(gaDoc?.gaProperties) ? gaDoc.gaProperties : [];
  return !!(hasOauth && props.length);
}

/* ======================= route ======================= */
/** GET /api/onboarding/status */
router.get('/', requireAuth, async (req, res) => {
  try {
    const uid = req.user._id;

    // Carga docs (tokens/selección/defaults)
    const [metaDoc, gaDoc, shopDoc] = await Promise.all([
      MetaAccount.findOne({ $or: [{ user: uid }, { userId: uid }] })
        .select('_id ad_accounts adAccounts access_token token accessToken longLivedToken longlivedToken selectedAccountIds defaultAccountId')
        .lean(),
      GoogleAccount.findOne({ $or: [{ user: uid }, { userId: uid }] })
        .select('_id refreshToken accessToken gaProperties selectedCustomerIds defaultCustomerId')
        .lean(),
      ShopConnections.findOne({ $or: [{ user: uid }, { userId: uid }] })
        .select('_id shop accessToken access_token')
        .lean(),
    ]);

    // ===== META =====
    const metaConnected   = !!(metaDoc && hasAnyMetaToken(metaDoc));
    const metaAvailIds    = metaDoc ? metaAvailableIds(metaDoc) : [];
    const metaSelected    = selectedMetaFromDocOrUser(metaDoc || {}, req.user);
    const metaRequiredSel = metaAvailIds.length > MAX_BY_RULE && metaSelected.length === 0;
    const metaDefault     = metaDoc?.defaultAccountId ? normActId(metaDoc.defaultAccountId) : null;

    // ===== GOOGLE ADS / GA4 =====
    const googleAdsConnected = !!(gaDoc && hasGoogleAdsOAuth(gaDoc));
    const ga4Connected       = !!(gaDoc && isGA4Connected(gaDoc));

    const gAvailIds    = gaDoc ? googleAvailableIds(gaDoc) : [];
    const gSelected    = selectedGoogleFromDocOrUser(gaDoc || {}, req.user);
    const gRequiredSel = gAvailIds.length > MAX_BY_RULE && gSelected.length === 0;
    const gDefault     = gaDoc?.defaultCustomerId ? normGaId(gaDoc.defaultCustomerId) : null;

    // ===== SHOPIFY =====
    const shopifyConnected = !!(shopDoc && shopDoc.shop && (shopDoc.accessToken || shopDoc.access_token));

    // ===== Armado de payload claro para Step 3 =====
    // Importante: separar Google Ads de GA4 para que tu UI no marque GA4 si solo hay Ads (y viceversa).
    const payload = {
      ok: true,
      status: {
        meta: {
          connected: metaConnected,
          availableCount: metaAvailIds.length,
          selectedCount: metaSelected.length,
          requiredSelection: metaRequiredSel,
          selected: metaSelected,
          defaultAccountId: metaDefault,
        },
        googleAds: {
          connected: googleAdsConnected,
          availableCount: gAvailIds.length,
          selectedCount: gSelected.length,
          requiredSelection: gRequiredSel,
          selected: gSelected,
          defaultCustomerId: gDefault,
        },
        ga4: {
          connected: ga4Connected,
          propertiesCount: Array.isArray(gaDoc?.gaProperties) ? gaDoc.gaProperties.length : 0,
          defaultPropertyId: gaDoc?.defaultPropertyId || null,
        },
        shopify: {
          connected: shopifyConnected,
        },
      },
      // Fuentes que SÍ deberían auditarse en este run (para tu barra de progreso)
      sourcesToAnalyze: [
        ...(metaConnected ? ['meta'] : []),
        ...(googleAdsConnected ? ['google'] : []),
        ...(shopifyConnected ? ['shopify'] : []),
        // GA4 no lanza auditoría LLM de Ads; si tuvieras una auditoría GA4, agrégala aquí como 'ga4'
      ],
      // Reglas de la sesión que puede necesitar la UI:
      rules: {
        selectionMaxRule: MAX_BY_RULE,
      },
    };

    return res.json(payload);
  } catch (e) {
    console.error('onboarding/status error:', e);
    return res.status(500).json({ ok: false, error: 'STATUS_ERROR' });
  }
});

module.exports = router;
