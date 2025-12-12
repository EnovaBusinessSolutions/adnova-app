// backend/routes/onboardingStatus.js
'use strict';

const express = require('express');
const mongoose = require('mongoose');

const router = express.Router();

const User = require('../models/User');

let MetaAccount, GoogleAccount, ShopConnections;
try {
  MetaAccount = require('../models/MetaAccount');
} catch {
  const { Schema, model } = mongoose;
  MetaAccount =
    mongoose.models.MetaAccount ||
    model('MetaAccount', new Schema({}, { strict: false, collection: 'metaaccounts' }));
}
try {
  GoogleAccount = require('../models/GoogleAccount');
} catch {
  const { Schema, model } = mongoose;
  GoogleAccount =
    mongoose.models.GoogleAccount ||
    model('GoogleAccount', new Schema({}, { strict: false, collection: 'googleaccounts' }));
}
try {
  ShopConnections = require('../models/ShopConnections');
} catch {
  const { Schema, model } = mongoose;
  ShopConnections =
    mongoose.models.ShopConnections ||
    model('ShopConnections', new Schema({}, { strict: false, collection: 'shopconnections' }));
}

/* ======================= helpers ======================= */
function requireAuth(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
}

// ✅ Tu UX actual: 1 selección por tipo (Meta / Google Ads / GA4)
const MAX_SELECT = 1;

const normActId = (s = '') => String(s).trim().replace(/^act_/, '');
const normGaId  = (s = '') => String(s).trim().replace(/^customers\//, '').replace(/[^\d]/g, '');
const normGA4Id = (s = '') => {
  const raw = String(s || '').trim();
  const digits = raw.replace(/^properties\//, '').replace(/[^\d]/g, '');
  return digits || raw.replace(/^properties\//, '').trim();
};

function uniq(arr = []) {
  return [...new Set((arr || []).filter(Boolean))];
}

function metaAvailableIds(metaDoc) {
  const list = Array.isArray(metaDoc?.ad_accounts) ? metaDoc.ad_accounts
            : Array.isArray(metaDoc?.adAccounts)  ? metaDoc.adAccounts
            : [];
  return uniq(list.map(a => normActId(a?.id || a?.account_id || '')).filter(Boolean));
}

function googleAvailableIds(gaDoc) {
  const fromAd = (Array.isArray(gaDoc?.ad_accounts) ? gaDoc.ad_accounts : [])
    .map(a => normGaId(a?.id))
    .filter(Boolean);
  const fromCu = (Array.isArray(gaDoc?.customers) ? gaDoc.customers : [])
    .map(c => normGaId(c?.id))
    .filter(Boolean);
  return uniq([...fromAd, ...fromCu]);
}

function ga4AvailableIds(gaDoc) {
  // gaProperties puede traer objetos {propertyId, name:"properties/123", displayName}
  const props = Array.isArray(gaDoc?.gaProperties) ? gaDoc.gaProperties : [];
  const ids = props.map(p => normGA4Id(p?.propertyId || p?.property_id || p?.name || '')).filter(Boolean);
  return uniq(ids);
}

function hasAnyMetaToken(metaDoc) {
  return !!(metaDoc?.access_token || metaDoc?.token || metaDoc?.accessToken || metaDoc?.longLivedToken || metaDoc?.longlivedToken);
}

function hasGoogleOAuth(gaDoc) {
  return !!(gaDoc?.refreshToken || gaDoc?.accessToken);
}

/** Selección Meta: doc.selectedAccountIds > user.selectedMetaAccounts */
function selectedMetaFromDocOrUser(metaDoc, user) {
  const fromDoc = Array.isArray(metaDoc?.selectedAccountIds)
    ? metaDoc.selectedAccountIds.map(normActId)
    : [];
  if (fromDoc.length) return uniq(fromDoc);
  const legacy = Array.isArray(user?.selectedMetaAccounts)
    ? user.selectedMetaAccounts.map(normActId)
    : [];
  return uniq(legacy);
}

/** Selección Google Ads: doc.selectedCustomerIds > user.selectedGoogleAccounts */
function selectedGoogleFromDocOrUser(gaDoc, user) {
  const fromDoc = Array.isArray(gaDoc?.selectedCustomerIds)
    ? gaDoc.selectedCustomerIds.map(normGaId)
    : [];
  if (fromDoc.length) return uniq(fromDoc);
  const legacy = Array.isArray(user?.selectedGoogleAccounts)
    ? user.selectedGoogleAccounts.map(normGaId)
    : [];
  return uniq(legacy);
}

/**
 * ✅ Selección GA4:
 * - Preferimos GoogleAccount.selectedPropertyIds (nuevo)
 * - fallback a GoogleAccount.defaultPropertyId
 * - fallback legacy user.selectedGAProperties
 */
function selectedGA4FromDocOrUser(gaDoc, user) {
  const fromDoc = Array.isArray(gaDoc?.selectedPropertyIds)
    ? gaDoc.selectedPropertyIds.map(normGA4Id)
    : [];
  if (fromDoc.length) return uniq(fromDoc);

  const def = gaDoc?.defaultPropertyId ? normGA4Id(gaDoc.defaultPropertyId) : '';
  if (def) return [def];

  const legacy = Array.isArray(user?.selectedGAProperties)
    ? user.selectedGAProperties.map(normGA4Id)
    : [];
  return uniq(legacy);
}

/**
 * Conectado vs Listo:
 * - connected: hay OAuth
 * - requiredSelection: hay >1 disponible y no hay selección guardada
 */
function requiredSelectionByUX(availableCount, selectedCount) {
  return availableCount > MAX_SELECT && selectedCount === 0;
}

/* ======================= route ======================= */
/** GET /api/onboarding/status */
router.get('/', requireAuth, async (req, res) => {
  try {
    const uid = req.user._id;

    // Carga docs (tokens/selección/defaults)
    const [metaDoc, gaDoc, shopDoc, userDoc] = await Promise.all([
      MetaAccount.findOne({ $or: [{ user: uid }, { userId: uid }] })
        .select('_id ad_accounts adAccounts access_token token accessToken longLivedToken longlivedToken selectedAccountIds defaultAccountId')
        .lean(),
      GoogleAccount.findOne({ $or: [{ user: uid }, { userId: uid }] })
        .select('_id refreshToken accessToken scope ad_accounts customers gaProperties selectedCustomerIds defaultCustomerId selectedPropertyIds defaultPropertyId')
        .lean(),
      ShopConnections.findOne({ $or: [{ user: uid }, { userId: uid }] })
        .select('_id shop accessToken access_token')
        .lean(),
      // 👇 traemos legacy selections de User para consistencia total
      User.findById(uid)
        .select('_id selectedMetaAccounts selectedGoogleAccounts selectedGAProperties')
        .lean(),
    ]);

    const user = userDoc || req.user || {};

    // ===== META =====
    const metaConnected = !!(metaDoc && hasAnyMetaToken(metaDoc));
    const metaAvailIds  = metaDoc ? metaAvailableIds(metaDoc) : [];
    const metaSelected  = metaDoc ? selectedMetaFromDocOrUser(metaDoc, user) : selectedMetaFromDocOrUser({}, user);

    // en tu UX solo debe existir 1 selection; limitamos por seguridad
    const metaSelected1 = metaSelected.slice(0, MAX_SELECT);
    const metaRequiredSel = metaConnected && requiredSelectionByUX(metaAvailIds.length, metaSelected1.length);

    const metaDefault = metaDoc?.defaultAccountId ? normActId(metaDoc.defaultAccountId) : null;

    // ===== GOOGLE ADS =====
    const googleAdsConnected = !!(gaDoc && hasGoogleOAuth(gaDoc));
    const gAvailIds = gaDoc ? googleAvailableIds(gaDoc) : [];

    const gSelected = gaDoc ? selectedGoogleFromDocOrUser(gaDoc, user) : selectedGoogleFromDocOrUser({}, user);
    const gSelected1 = gSelected.slice(0, MAX_SELECT);
    const gRequiredSel = googleAdsConnected && requiredSelectionByUX(gAvailIds.length, gSelected1.length);

    const gDefault = gaDoc?.defaultCustomerId ? normGaId(gaDoc.defaultCustomerId) : null;

    // ===== GA4 =====
    // GA4 conectado: OAuth + al menos 1 propiedad detectada (disponible)
    const ga4AvailIds = gaDoc ? ga4AvailableIds(gaDoc) : [];
    const ga4Connected = !!(googleAdsConnected && ga4AvailIds.length > 0);

    const ga4Selected = gaDoc ? selectedGA4FromDocOrUser(gaDoc, user) : selectedGA4FromDocOrUser({}, user);
    const ga4Selected1 = ga4Selected.slice(0, MAX_SELECT);
    const ga4RequiredSel = ga4Connected && requiredSelectionByUX(ga4AvailIds.length, ga4Selected1.length);

    const ga4Default = gaDoc?.defaultPropertyId ? normGA4Id(gaDoc.defaultPropertyId) : (ga4Selected1[0] || null);

    // ===== SHOPIFY =====
    const shopifyConnected = !!(shopDoc && shopDoc.shop && (shopDoc.accessToken || shopDoc.access_token));

    // ===== Payload =====
    const status = {
      meta: {
        connected: metaConnected,
        availableCount: metaAvailIds.length,
        selectedCount: metaSelected1.length,
        requiredSelection: metaRequiredSel,
        selected: metaSelected1,
        defaultAccountId: metaDefault,
        // legacy:
        count: metaAvailIds.length,
        maxSelect: MAX_SELECT,
      },
      googleAds: {
        connected: googleAdsConnected,
        availableCount: gAvailIds.length,
        selectedCount: gSelected1.length,
        requiredSelection: gRequiredSel,
        selected: gSelected1,
        defaultCustomerId: gDefault,
        maxSelect: MAX_SELECT,
      },
      ga4: {
        connected: ga4Connected,
        propertiesCount: ga4AvailIds.length,
        availableCount: ga4AvailIds.length,
        selectedCount: ga4Selected1.length,
        requiredSelection: ga4RequiredSel,
        selected: ga4Selected1,
        defaultPropertyId: ga4Default,
        // legacy:
        count: ga4AvailIds.length,
        maxSelect: MAX_SELECT,
      },
      shopify: {
        connected: shopifyConnected,
      },
    };

    // === LEGACY: onboarding3.js ===
    status.google = {
      connected: status.googleAds.connected,
      count: status.ga4.count,
    };

    // Fuentes a analizar (para tu barra/progreso)
    // ✅ importante: google solo si NO requiere selección (evita la carrera)
    const sourcesToAnalyze = [
      ...(metaConnected && !metaRequiredSel ? ['meta'] : []),
      ...(googleAdsConnected && !gRequiredSel ? ['google'] : []),
      ...(shopifyConnected ? ['shopify'] : []),
      ...(ga4Connected && !ga4RequiredSel ? ['ga4'] : []),
    ];

    return res.json({
      ok: true,
      status,
      sourcesToAnalyze,
      rules: { selectionMaxRule: MAX_SELECT },
    });
  } catch (e) {
    console.error('onboarding/status error:', e);
    return res.status(500).json({ ok: false, error: 'STATUS_ERROR' });
  }
});

module.exports = router;
