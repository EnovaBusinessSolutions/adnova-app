// backend/routes/onboardingStatus.js
'use strict';

const express = require('express');
const mongoose = require('mongoose');

const router = express.Router();

const User = require('../models/User');

let MetaAccount, GoogleAccount, ShopConnections, PixelSelection;

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

try {
  PixelSelection = require('../models/PixelSelection');
} catch {
  PixelSelection = null;
}

/* ======================= helpers ======================= */
function requireAuth(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
}

// UX: máximo 1 selección por tipo (Meta / Google Ads / GA4)
const MAX_SELECT = 1;

// --- normalizers ---
const normActId = (s = '') => String(s || '').trim().replace(/^act_/, '');

// Google Ads customers siempre dígitos
const normGaId = (s = '') =>
  String(s || '')
    .trim()
    .replace(/^customers\//, '')
    .replace(/[^\d]/g, '');

// GA4 canónico: siempre "properties/<digits>"
const normGA4Id = (s = '') => {
  const raw = String(s || '').trim();
  if (!raw) return '';
  const digits = raw.replace(/^properties\//, '').replace(/[^\d]/g, '');
  return digits ? `properties/${digits}` : '';
};

const safeStr = (v) => String(v || '').trim();

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

/**
 * Separación OAuth por producto (alineado al modelo GoogleAccount.js)
 * - ADS: accessToken/refreshToken + scope
 * - GA4: ga4AccessToken/ga4RefreshToken + ga4Scope
 */
function hasGoogleOAuthAds(gaDoc) {
  return !!(gaDoc?.refreshToken || gaDoc?.accessToken);
}
function hasGoogleOAuthGa4(gaDoc) {
  return !!(gaDoc?.ga4RefreshToken || gaDoc?.ga4AccessToken);
}

function normalizeScopes(raw) {
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : String(raw).split(/[,\s]+/);
  return uniq(arr.map((s) => String(s || '').trim().toLowerCase()).filter(Boolean));
}

function hasAdwordsScope(scopes = []) {
  const s = normalizeScopes(scopes);
  return s.some((x) => x.includes('/auth/adwords'));
}

function hasGAReadScope(scopes = []) {
  const s = normalizeScopes(scopes);
  return s.some((x) => x.includes('/auth/analytics.readonly'));
}

function hasGoogleOAuthMerchant(gaDoc) {
  return !!(gaDoc?.merchantRefreshToken || gaDoc?.merchantAccessToken);
}

function hasMerchantScope(scopes = []) {
  return normalizeScopes(scopes).some((x) => x.includes('/auth/content'));
}

function merchantAvailableIds(gaDoc) {
  return uniq(
    (Array.isArray(gaDoc?.merchantAccounts) ? gaDoc.merchantAccounts : [])
      .map((a) => String(a?.merchantId || '').trim().replace(/^accounts\//, '').replace(/[^\d]/g, ''))
      .filter(Boolean)
  );
}

function selectedMerchantFromDoc(gaDoc) {
  return uniq(
    (Array.isArray(gaDoc?.selectedMerchantIds) ? gaDoc.selectedMerchantIds : [])
      .map((id) => String(id || '').trim().replace(/^accounts\//, '').replace(/[^\d]/g, ''))
      .filter(Boolean)
  );
}

// --- availability builders ---
function metaAvailableIds(metaDoc) {
  const list = Array.isArray(metaDoc?.ad_accounts)
    ? metaDoc.ad_accounts
    : Array.isArray(metaDoc?.adAccounts)
      ? metaDoc.adAccounts
      : [];
  return uniq(list.map((a) => normActId(a?.id || a?.account_id || '')).filter(Boolean));
}

function googleAvailableIds(gaDoc) {
  const fromAd = (Array.isArray(gaDoc?.ad_accounts) ? gaDoc.ad_accounts : [])
    .map((a) => normGaId(a?.id))
    .filter(Boolean);

  const fromCu = (Array.isArray(gaDoc?.customers) ? gaDoc.customers : [])
    .map((c) => normGaId(c?.id))
    .filter(Boolean);

  return uniq([...fromAd, ...fromCu]);
}

function ga4AvailableIds(gaDoc) {
  const props = Array.isArray(gaDoc?.gaProperties) ? gaDoc.gaProperties : [];
  const ids = props
    .map((p) => normGA4Id(p?.propertyId || p?.property_id || p?.name || ''))
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
 * Selección GA4:
 * - Preferimos GoogleAccount.selectedPropertyIds (nuevo)
 * - Fallback: GoogleAccount.selectedGaPropertyId (legacy)
 * - Fallback: user.selectedGAProperties (legacy)
 *
 * Importante: NO usar defaultPropertyId como “selección”.
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
 * requiredSelection:
 * - hay más de MAX_SELECT disponibles y NO hay selección
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

    const [metaDoc, gaDoc, shopDoc, userDoc, pixelDocs] = await Promise.all([
      MetaAccount.findOne({ $or: [{ user: uid }, { userId: uid }] })
        .select('_id ad_accounts adAccounts access_token token accessToken longLivedToken longlivedToken selectedAccountIds defaultAccountId')
        .lean(),

      GoogleAccount.findOne({ $or: [{ user: uid }, { userId: uid }] })
        .select(
          [
            '_id',
            'refreshToken',
            'accessToken',
            'scope',
            'ga4RefreshToken',
            'ga4AccessToken',
            'ga4Scope',
            'connectedAds',
            'connectedGa4',
            'ad_accounts',
            'customers',
            'gaProperties',
            'selectedCustomerIds',
            'defaultCustomerId',
            'selectedPropertyIds',
            'selectedGaPropertyId',
            'defaultPropertyId',
            'merchantRefreshToken',
            'merchantAccessToken',
            'merchantScope',
            'connectedMerchant',
            'merchantAccounts',
            'selectedMerchantIds',
            'defaultMerchantId',
          ].join(' ')
        )
        .lean(),

      ShopConnections.findOne({ $or: [{ user: uid }, { userId: uid }] })
        .select('_id shop accessToken access_token')
        .lean(),

      User.findById(uid)
        .select('_id metaConnected googleConnected shopifyConnected metaAccessToken selectedMetaAccounts selectedGoogleAccounts selectedGAProperties shop')
        .lean(),

      PixelSelection
        ? PixelSelection.find({ $or: [{ userId: uid }, { user: uid }] })
            .select('provider selectedId selectedName meta confirmedAt')
            .lean()
        : Promise.resolve([]),
    ]);

    const user = userDoc || req.user || {};

    // ===== PIXELS / CONVERSIONS =====
    const pxList = Array.isArray(pixelDocs) ? pixelDocs : [];
    const pxMeta = pxList.find((d) => d?.provider === 'meta') || null;
    const pxGoogle = pxList.find((d) => d?.provider === 'google_ads') || null;

    const metaPixelSelected = !!safeStr(pxMeta?.selectedId);
    const metaPixelConfirmed = !!pxMeta?.confirmedAt;

    const googleConvSelected = !!safeStr(pxGoogle?.selectedId);
    const googleConvConfirmed = !!pxGoogle?.confirmedAt;

    // ===== META =====
    const metaAvailIds = metaDoc ? metaAvailableIds(metaDoc) : [];
    const metaSelectedRaw = selectedMetaFromDocOrUser(metaDoc || {}, user);
    const metaSelectedEff = effectiveSelected(metaSelectedRaw, metaAvailIds).slice(0, MAX_SELECT);

    const metaConnected = !!(hasAnyMetaToken(metaDoc) || user?.metaAccessToken);
    const metaRequiredSel =
      metaConnected && requiredSelectionByUX(metaAvailIds.length, metaSelectedEff.length);

    const metaDefault =
      metaDoc?.defaultAccountId
        ? normActId(metaDoc.defaultAccountId)
        : (metaSelectedEff[0] || null);

    // ===== GOOGLE ADS =====
    const adsOAuth = !!(gaDoc && hasGoogleOAuthAds(gaDoc));
    const adsScopesArr = normalizeScopes(gaDoc?.scope || []);
    const adsScopeOk = hasAdwordsScope(adsScopesArr);

    const googleAdsConnected = !!((adsOAuth && adsScopeOk) || (adsOAuth && gaDoc?.connectedAds));

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
    const ga4OAuth = !!(gaDoc && hasGoogleOAuthGa4(gaDoc));
    const ga4ScopesArr = normalizeScopes(gaDoc?.ga4Scope || []);
    const gaScopeOk = hasGAReadScope(ga4ScopesArr);

    const ga4Connected = !!((ga4OAuth && gaScopeOk) || (ga4OAuth && gaDoc?.connectedGa4));

    const ga4AvailIds = gaDoc ? ga4AvailableIds(gaDoc) : [];
    const ga4SelectedRaw = selectedGA4FromDocOrUser(gaDoc || {}, user);
    const ga4SelectedEff = effectiveSelected(ga4SelectedRaw, ga4AvailIds).slice(0, MAX_SELECT);

    const ga4RequiredSel =
      ga4Connected &&
      ga4AvailIds.length > 0 &&
      requiredSelectionByUX(ga4AvailIds.length, ga4SelectedEff.length);

    const ga4Default =
      gaDoc?.defaultPropertyId
        ? normGA4Id(gaDoc.defaultPropertyId)
        : (ga4SelectedEff[0] || null);

    // ===== MERCHANT =====
    const merchantOAuth     = !!(gaDoc && hasGoogleOAuthMerchant(gaDoc));
    const merchantScopeOk   = hasMerchantScope(gaDoc?.merchantScope || []);
    const merchantConnected = !!(
      (merchantOAuth && merchantScopeOk) || (merchantOAuth && gaDoc?.connectedMerchant)
    );

    const merchantAvailIds  = gaDoc ? merchantAvailableIds(gaDoc) : [];
    const merchantSelectedRaw = selectedMerchantFromDoc(gaDoc || {});
    const merchantSelectedEff = effectiveSelected(merchantSelectedRaw, merchantAvailIds).slice(0, MAX_SELECT);

    const merchantRequiredSel =
      merchantConnected &&
      merchantAvailIds.length > 0 &&
      requiredSelectionByUX(merchantAvailIds.length, merchantSelectedEff.length);

    const merchantDefault =
      gaDoc?.defaultMerchantId
        ? String(gaDoc.defaultMerchantId).trim().replace(/^accounts\//, '').replace(/[^\d]/g, '')
        : (merchantSelectedEff[0] || null);

    const merchantIntegrationReady =
      merchantConnected &&
      merchantAvailIds.length > 0 &&
      !merchantRequiredSel &&
      merchantSelectedEff.length > 0;

    // ===== SHOPIFY =====
    const shopifyConnected = !!(
      (shopDoc && shopDoc.shop && (shopDoc.accessToken || shopDoc.access_token)) ||
      user?.shopifyConnected
    );

    // ===== ADRAY PIXEL SETUP =====
    // Connected = user ran the PixelSetupWizard (confirm-shop sets user.shop + ShopConnections)
    const pixelSetupShop = (shopDoc?.accessToken === 'pixel-setup' && shopDoc?.shop)
      ? shopDoc.shop
      : null;
    const pixelConnectedShop = user?.shop || pixelSetupShop || null;
    const pixelConnected = !!pixelConnectedShop;

    // ===== OPTIONAL FLAGS =====
    // Pixel / conversion ya no bloquean el onboarding.
    const metaPixelOptional = true;
    const googleConversionOptional = true;

    // ===== Payload base =====
    const status = {
      meta: {
        connected: metaConnected,
        availableCount: metaAvailIds.length,
        selectedCount: metaSelectedEff.length,
        requiredSelection: metaRequiredSel,
        selected: metaSelectedEff,
        defaultAccountId: metaDefault,
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
        count: ga4AvailIds.length,
        maxSelect: MAX_SELECT,
        gaScopeOk,
      },

      merchant: {
        connected:        merchantConnected,
        availableCount:   merchantAvailIds.length,
        selectedCount:    merchantSelectedEff.length,
        requiredSelection: merchantRequiredSel,
        selected:         merchantSelectedEff,
        defaultMerchantId: merchantDefault,
        count:            merchantAvailIds.length,
        maxSelect:        MAX_SELECT,
      },

      integrationReady: {
        merchant: merchantIntegrationReady,
      },

      shopify: {
        connected: shopifyConnected,
      },

      pixel: {
        connected: pixelConnected,
        shop: pixelConnectedShop,
      },

      pixels: {
        meta: {
          optional: metaPixelOptional,
          selected: metaPixelSelected,
          confirmed: metaPixelConfirmed,
          selectedId: pxMeta?.selectedId || null,
          selectedName: pxMeta?.selectedName || null,
          meta: pxMeta?.meta || {},
          confirmedAt: pxMeta?.confirmedAt || null,
        },
        googleAds: {
          optional: googleConversionOptional,
          selected: googleConvSelected,
          confirmed: googleConvConfirmed,
          selectedId: pxGoogle?.selectedId || null,
          selectedName: pxGoogle?.selectedName || null,
          meta: pxGoogle?.meta || {},
          confirmedAt: pxGoogle?.confirmedAt || null,
        },
      },
    };

    // ===== LEGACY: onboarding3.js =====
    status.google = {
      connected: !!(
        (adsOAuth && adsScopeOk) ||
        (ga4OAuth && gaScopeOk) ||
        (adsOAuth && gaDoc?.connectedAds) ||
        (ga4OAuth && gaDoc?.connectedGa4)
      ),
      count: status.ga4.count,
    };

    /**
     * ===== READY FLAGS =====
     * Nueva regla:
     * - Pixel / conversion NO bloquean readyToContinue ni readyToAnalyze
     * - Si la cuenta está conectada y la selección principal está correcta, la fuente está lista
     *
     * Esto alinea backend con el nuevo onboarding inline:
     * “sin pixel pero conectado”.
     */
    status.readyToContinue = {
      meta: metaConnected && !metaRequiredSel && status.meta.selectedCount > 0,
      googleAds: googleAdsConnected && !gRequiredSel && status.googleAds.selectedCount > 0,
      ga4: ga4Connected && ga4AvailIds.length > 0 && !ga4RequiredSel && status.ga4.selectedCount > 0,
    };

    status.readyToAnalyze = {
      meta: metaConnected && !metaRequiredSel && status.meta.selectedCount > 0,
      googleAds: googleAdsConnected && !gRequiredSel && status.googleAds.selectedCount > 0,
      ga4: ga4Connected && ga4AvailIds.length > 0 && !ga4RequiredSel && status.ga4.selectedCount > 0,
    };

    // Fuentes a analizar:
    // ya no dependen de pixel/conversion confirmado porque ahora son opcionales.
    const sourcesToAnalyze = [
      ...(status.readyToAnalyze.meta ? ['meta'] : []),
      ...(status.readyToAnalyze.googleAds ? ['google'] : []),
      ...(status.readyToAnalyze.ga4 ? ['ga4'] : []),
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