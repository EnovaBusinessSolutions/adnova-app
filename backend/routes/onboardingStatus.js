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

// ✅ UX: máximo 1 selección por tipo (Meta / Google Ads / GA4)
const MAX_SELECT = 1;

// --- normalizers ---
const normActId = (s = '') => String(s || '').trim().replace(/^act_/, '');
const normGaId  = (s = '') => String(s || '').trim().replace(/^customers\//, '').replace(/[^\d]/g, '');
const normGA4Id = (s = '') => {
  const raw = String(s || '').trim();
  const digits = raw.replace(/^properties\//, '').replace(/[^\d]/g, '');
  return digits || raw.replace(/^properties\//, '').trim();
};

function uniq(arr = []) {
  return [...new Set((Array.isArray(arr) ? arr : []).filter(Boolean))];
}

function hasAnyMetaToken(metaDoc) {
  return !!(
    metaDoc?.access_token ||
    metaDoc?.token ||
    metaDoc?.accessToken ||
    metaDoc?.longLivedToken ||
    metaDoc?.longlivedToken
  );
}

function hasGoogleOAuth(gaDoc) {
  return !!(gaDoc?.refreshToken || gaDoc?.accessToken);
}

function normalizeScopes(raw) {
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : String(raw).split(/[,\s]+/);
  return uniq(arr.map(s => String(s || '').trim()).filter(Boolean));
}

function hasAdwordsScope(scopes = []) {
  const s = normalizeScopes(scopes);
  return s.some(x => String(x).includes('/auth/adwords'));
}

function hasGAReadScope(scopes = []) {
  const s = normalizeScopes(scopes);
  return s.some(x => String(x).includes('/auth/analytics.readonly'));
}

// --- availability builders ---
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
  // gaProperties puede traer objetos { propertyId:"properties/123" } o { name:"properties/123" }
  const props = Array.isArray(gaDoc?.gaProperties) ? gaDoc.gaProperties : [];
  const ids = props
    .map(p => normGA4Id(p?.propertyId || p?.property_id || p?.name || ''))
    .filter(Boolean);
  return uniq(ids);
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
 * ✅ Selección GA4 (fix crítico):
 * - Preferimos GoogleAccount.selectedPropertyIds (nuevo)
 * - Fallback: GoogleAccount.selectedGaPropertyId (legacy)
 * - Fallback: user.selectedGAProperties (legacy)
 *
 * 🚫 Importante: NO usar defaultPropertyId como “selección”.
 * defaultPropertyId es un default técnico interno (por ejemplo “primera propiedad”)
 * y cuando hay 2+ propiedades, NO debe evitar el selector.
 */
function selectedGA4FromDocOrUser(gaDoc, user) {
  const fromDoc = Array.isArray(gaDoc?.selectedPropertyIds)
    ? gaDoc.selectedPropertyIds.map(normGA4Id)
    : [];
  if (fromDoc.length) return uniq(fromDoc);

  const legacyOne = gaDoc?.selectedGaPropertyId ? normGA4Id(gaDoc.selectedGaPropertyId) : '';
  if (legacyOne) return [legacyOne];

  const legacy = Array.isArray(user?.selectedGAProperties)
    ? user.selectedGAProperties.map(normGA4Id)
    : [];
  return uniq(legacy);
}

/**
 * connected vs requiredSelection:
 * - connected = hay OAuth válido (y scope, si aplica)
 * - requiredSelection = hay > MAX_SELECT disponibles y NO hay selección
 */
function requiredSelectionByUX(availableCount, selectedCount) {
  return availableCount > MAX_SELECT && selectedCount === 0;
}

// Si sólo hay 1 disponible y no hay selección guardada,
// reportamos “effectiveSelected” para no bloquear el flujo.
function effectiveSelected(selectedArr, availableArr) {
  const s = Array.isArray(selectedArr) ? selectedArr.filter(Boolean) : [];
  if (s.length) return s;
  if (Array.isArray(availableArr) && availableArr.length === 1) return [availableArr[0]];
  return [];
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
        .select('_id refreshToken accessToken scope ad_accounts customers gaProperties selectedCustomerIds defaultCustomerId selectedPropertyIds selectedGaPropertyId defaultPropertyId')
        .lean(),
      ShopConnections.findOne({ $or: [{ user: uid }, { userId: uid }] })
        .select('_id shop accessToken access_token')
        .lean(),
      // legacy selections de User (para compat total)
      User.findById(uid)
        .select('_id metaConnected googleConnected shopifyConnected selectedMetaAccounts selectedGoogleAccounts selectedGAProperties')
        .lean(),
    ]);

    const user = userDoc || req.user || {};

    // ===== META =====
    const metaAvailIds = metaDoc ? metaAvailableIds(metaDoc) : [];
    const metaSelectedRaw = selectedMetaFromDocOrUser(metaDoc || {}, user);
    const metaSelectedEff = effectiveSelected(metaSelectedRaw, metaAvailIds).slice(0, MAX_SELECT);

    // conectado = token en MetaAccount o flag en User (no rompe)
    const metaConnected = !!(hasAnyMetaToken(metaDoc) || user?.metaConnected);

    const metaRequiredSel =
      metaConnected && requiredSelectionByUX(metaAvailIds.length, metaSelectedEff.length);

    const metaDefault =
      metaDoc?.defaultAccountId
        ? normActId(metaDoc.defaultAccountId)
        : (metaSelectedEff[0] || null);

    // ===== GOOGLE ADS =====
    const googleOAuth = !!(gaDoc && hasGoogleOAuth(gaDoc));
    const scopesArr = normalizeScopes(gaDoc?.scope || []);
    const adsScopeOk = hasAdwordsScope(scopesArr);
    const gaScopeOk  = hasGAReadScope(scopesArr);

    // Ads conectado = OAuth + adwords scope
    const googleAdsConnected = !!(googleOAuth && adsScopeOk);

    const gAvailIds = gaDoc ? googleAvailableIds(gaDoc) : [];
    const gSelectedRaw = selectedGoogleFromDocOrUser(gaDoc || {}, user);
    const gSelectedEff = effectiveSelected(gSelectedRaw, gAvailIds).slice(0, MAX_SELECT);

    const gRequiredSel =
      googleAdsConnected && requiredSelectionByUX(gAvailIds.length, gSelectedEff.length);

    const gDefault =
      gaDoc?.defaultCustomerId
        ? normGaId(gaDoc.defaultCustomerId)
        : (gSelectedEff[0] || null);

    // ===== GA4 =====
    // GA4 conectado = OAuth + analytics.readonly scope (aunque aún no haya gaProperties cacheadas)
    const ga4Connected = !!(googleOAuth && gaScopeOk);

    const ga4AvailIds = gaDoc ? ga4AvailableIds(gaDoc) : [];

    // 🔥 FIX: ya no cuenta defaultPropertyId como selección
    const ga4SelectedRaw = selectedGA4FromDocOrUser(gaDoc || {}, user);
    const ga4SelectedEff = effectiveSelected(ga4SelectedRaw, ga4AvailIds).slice(0, MAX_SELECT);

    // requiredSelection SOLO si ya hay propiedades disponibles
    const ga4RequiredSel =
      ga4Connected &&
      ga4AvailIds.length > 0 &&
      requiredSelectionByUX(ga4AvailIds.length, ga4SelectedEff.length);

    const ga4Default =
      gaDoc?.defaultPropertyId
        ? normGA4Id(gaDoc.defaultPropertyId)
        : (ga4SelectedEff[0] || null);

    // ===== SHOPIFY =====
    const shopifyConnected = !!(
      (shopDoc && shopDoc.shop && (shopDoc.accessToken || shopDoc.access_token)) ||
      user?.shopifyConnected
    );

    // ===== Payload =====
    const status = {
      meta: {
        connected: metaConnected,
        availableCount: metaAvailIds.length,
        selectedCount: metaSelectedEff.length,
        requiredSelection: metaRequiredSel,
        selected: metaSelectedEff,
        defaultAccountId: metaDefault,
        // legacy compat
        count: metaAvailIds.length,
        maxSelect: MAX_SELECT,
      },
      googleAds: {
        connected: googleAdsConnected,
        availableCount: gAvailIds.length,
        selectedCount: gSelectedEff.length,
        requiredSelection: gRequiredSel,
        selected: gSelectedEff,
        defaultCustomerId: gDefault,
        maxSelect: MAX_SELECT,
        adsScopeOk,
      },
      ga4: {
        connected: ga4Connected,
        propertiesCount: ga4AvailIds.length,
        availableCount: ga4AvailIds.length,
        selectedCount: ga4SelectedEff.length,
        requiredSelection: ga4RequiredSel,
        selected: ga4SelectedEff,
        defaultPropertyId: ga4Default,
        // legacy compat
        count: ga4AvailIds.length,
        maxSelect: MAX_SELECT,
        gaScopeOk,
      },
      shopify: {
        connected: shopifyConnected,
      },
    };

    // === LEGACY: onboarding3.js ===
    // "google.connected" históricamente se usaba como “google ok”
    // mantenemos: conectado si Ads o GA4 están conectados (por OAuth)
    status.google = {
      connected: !!(googleOAuth && (adsScopeOk || gaScopeOk)),
      count: status.ga4.count,
    };

    // Fuentes a analizar (para barra/progreso)
    // ✅ clave: NO incluir si requiere selección (evita la carrera)
    const sourcesToAnalyze = [
      ...(metaConnected && !metaRequiredSel && status.meta.selectedCount > 0 ? ['meta'] : []),
      ...(googleAdsConnected && !gRequiredSel && status.googleAds.selectedCount > 0 ? ['google'] : []),
      ...(ga4Connected && ga4AvailIds.length > 0 && !ga4RequiredSel && status.ga4.selectedCount > 0 ? ['ga4'] : []),
      ...(shopifyConnected ? ['shopify'] : []),
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
