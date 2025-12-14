// backend/routes/googleConnect.js
'use strict';

const express = require('express');
const { OAuth2Client } = require('google-auth-library');
const { google } = require('googleapis');
const mongoose = require('mongoose');

const { discoverAndEnrich, selfTest } = require('../services/googleAdsService');

const router = express.Router();

const User = require('../models/User');

/* =========================================================
 *  Modelo GoogleAccount (fallback si no existe el archivo)
 * =======================================================*/
let GoogleAccount;
try {
  GoogleAccount = require('../models/GoogleAccount');
} catch (_) {
  const { Schema, model } = mongoose;

  const AdAccountSchema = new Schema(
    {
      id: { type: String, required: true }, // customerId
      name: { type: String },
      currencyCode: { type: String },
      timeZone: { type: String },
      status: { type: String },
    },
    { _id: false }
  );

  const schema = new Schema(
    {
      user: { type: Schema.Types.ObjectId, ref: 'User', index: true, sparse: true },
      userId: { type: Schema.Types.ObjectId, ref: 'User', index: true, sparse: true },

      // ✅ (Fix) email se usa en el código; si no existe en schema strict, no se persiste.
      email: { type: String, default: null },

      accessToken: { type: String, select: false },
      refreshToken: { type: String, select: false },
      scope: { type: [String], default: [] },
      expiresAt: { type: Date },

      // Ads
      managerCustomerId: { type: String },
      loginCustomerId: { type: String },
      defaultCustomerId: { type: String },
      customers: { type: Array, default: [] },
      ad_accounts: { type: [AdAccountSchema], default: [] },

      // ✅ Canonical selección Ads (array)
      selectedCustomerIds: { type: [String], default: [] },

      // GA4 cache
      gaProperties: { type: Array, default: [] },
      defaultPropertyId: { type: String },

      // ✅ Canonical selección GA4 (array)
      selectedPropertyIds: { type: [String], default: [] },

      // Legacy GA4 (para compat con código viejo)
      selectedGaPropertyId: { type: String },

      // Misc
      objective: { type: String, enum: ['ventas', 'alcance', 'leads'], default: null },
      lastAdsDiscoveryError: { type: String, default: null },
      lastAdsDiscoveryLog: { type: mongoose.Schema.Types.Mixed, default: null, select: false },

      createdAt: { type: Date, default: Date.now },
      updatedAt: { type: Date, default: Date.now },
    },
    { collection: 'googleaccounts' }
  );

  schema.pre('save', function (next) {
    this.updatedAt = new Date();
    next();
  });

  GoogleAccount = mongoose.models.GoogleAccount || model('GoogleAccount', schema);
}

/* =========================
 * ENV
 * ========================= */
const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI,          // preferido
  GOOGLE_CONNECT_CALLBACK_URL,  // fallback legacy
} = process.env;

const DEFAULT_GOOGLE_OBJECTIVE = 'ventas';

/* =========================
 * Helpers
 * ========================= */
function requireSession(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
}

function oauth() {
  const redirectUri = GOOGLE_REDIRECT_URI || GOOGLE_CONNECT_CALLBACK_URL;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !redirectUri) {
    // No tiramos error duro; devolvemos client igual para no reventar runtime,
    // pero logueamos para diagnóstico.
    console.warn('[googleConnect] Missing GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI');
  }
  return new OAuth2Client({
    clientId: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    redirectUri,
  });
}

/**
 * ✅ Revocar token en Google (best-effort)
 * - intenta revocar refresh_token primero (ideal)
 * - si no hay refresh_token, intenta access_token
 * - si falla revocación, NO bloquea la desconexión local
 */
async function revokeGoogleTokenBestEffort({ refreshToken, accessToken }) {
  const token = refreshToken || accessToken;
  if (!token) return { attempted: false, ok: true };

  try {
    const client = oauth();
    await client.revokeToken(token);
    return { attempted: true, ok: true };
  } catch (e) {
    console.warn(
      '[googleConnect] revokeToken failed (best-effort):',
      e?.response?.data || e?.message || e
    );
    return { attempted: true, ok: false };
  }
}

const normCustomerId = (s = '') =>
  String(s || '').replace(/^customers\//, '').replace(/[^\d]/g, '');
const normId = (s = '') => normCustomerId(s);

const normPropertyId = (val = '') => {
  const raw = String(val || '').trim();
  if (!raw) return '';
  if (/^properties\/\d+$/.test(raw)) return raw;
  const digits = raw.replace(/^properties\//, '').replace(/[^\d]/g, '');
  return digits ? `properties/${digits}` : '';
};

const uniq = (arr = []) => [...new Set((arr || []).filter(Boolean))];

const normalizeScopes = (raw) =>
  Array.from(
    new Set(
      (Array.isArray(raw) ? raw : String(raw || '').split(/[,\s]+/))
        .map((s) => String(s || '').trim())
        .filter(Boolean)
    )
  );

// Scopes Ads / GA
const ADS_SCOPE = 'https://www.googleapis.com/auth/adwords';
const GA_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';

const hasAdwordsScope = (scopes = []) =>
  Array.isArray(scopes) && scopes.some((s) => String(s).includes('/auth/adwords'));

const hasGaScope = (scopes = []) =>
  Array.isArray(scopes) && scopes.some((s) => String(s).includes('/auth/analytics.readonly'));

function filterSelectedByAvailable(selectedIds, availableSet) {
  const sel = Array.isArray(selectedIds) ? selectedIds : [];
  return sel.map(normId).filter(Boolean).filter((id) => availableSet.has(id));
}

function filterSelectedPropsByAvailable(selectedPropIds, availableSet) {
  const sel = Array.isArray(selectedPropIds) ? selectedPropIds : [];
  return sel.map(normPropertyId).filter(Boolean).filter((pid) => availableSet.has(pid));
}

/* =========================================================
 *  Google Analytics Admin — listar GA4 properties
 * =======================================================*/
async function fetchGA4Properties(oauthClient) {
  const admin = google.analyticsadmin({ version: 'v1beta', auth: oauthClient });

  // ✅ Método robusto (si falla accounts.list + properties.list, intentamos properties.search)
  // 1) Intento legacy: accounts.list -> properties.list
  try {
    const props = [];
    const accounts = await admin.accounts
      .list({ pageSize: 200 })
      .then((r) => r.data.accounts || [])
      .catch(() => []);

    for (const acc of accounts) {
      const accountId = (acc.name || '').split('/')[1];
      if (!accountId) continue;
      try {
        const resp = await admin.properties.list({
          filter: `parent:accounts/${accountId}`,
          pageSize: 200,
        });
        const list = resp.data.properties || [];
        for (const p of list) {
          props.push({
            propertyId: p.name, // "properties/123"
            displayName: p.displayName || p.name,
            timeZone: p.timeZone,
            currencyCode: p.currencyCode,
          });
        }
      } catch (e) {
        console.warn(
          '⚠️ properties.list fail for account',
          accountId,
          e?.response?.data || e.message
        );
      }
    }

    if (props.length) return props;
  } catch (_) {
    // ignore y cae al fallback
  }

  // 2) Fallback moderno: properties.search
  const out = [];
  let pageToken;
  do {
    const resp = await admin.properties.search({
      requestBody: { query: '' },
      pageToken,
      pageSize: 200,
    });
    (resp.data.properties || []).forEach((p) => {
      out.push({
        propertyId: p.name,
        displayName: p.displayName || p.name,
        timeZone: p.timeZone || null,
        currencyCode: p.currencyCode || null,
      });
    });
    pageToken = resp.data.nextPageToken || undefined;
  } while (pageToken);

  return out;
}

/* =========================================================
 *  Iniciar OAuth (Ads + GA) — estilo Master Metrics
 * =======================================================*/
function buildAuthUrl(req, returnTo) {
  const client = oauth();
  const state = JSON.stringify({
    uid: String(req.user._id),
    returnTo,
  });

  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: true,
    scope: [
      'openid',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
      GA_SCOPE,
      ADS_SCOPE,
    ],
    state,
  });
}

async function startConnect(req, res) {
  try {
    const returnTo =
      typeof req.query.returnTo === 'string' && req.query.returnTo.trim()
        ? req.query.returnTo
        : '/onboarding?google=connected';

    const url = buildAuthUrl(req, returnTo);
    return res.redirect(url);
  } catch (err) {
    console.error('[googleConnect] connect error:', err);
    return res.redirect('/onboarding?google=error&reason=connect_build');
  }
}

// Rutas para iniciar OAuth
router.get('/connect', requireSession, startConnect);
// alias más explícito
router.get('/ads', requireSession, startConnect);

/* =========================================================
 *  Callback compartido (connect / ads)
 * =======================================================*/
async function googleCallbackHandler(req, res) {
  try {
    if (req.query.error) {
      return res.redirect(`/onboarding?google=error&reason=${encodeURIComponent(req.query.error)}`);
    }

    const code = req.query.code;
    if (!code) {
      return res.redirect('/onboarding?google=error&reason=no_code');
    }

    const client = oauth();
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);

    const accessToken = tokens.access_token;
    const refreshToken = tokens.refresh_token || null;
    const expiresAt = tokens.expiry_date ? new Date(tokens.expiry_date) : null;
    const grantedScopes = normalizeScopes(tokens.scope || []);

    if (!accessToken) {
      return res.redirect('/onboarding?google=error&reason=no_access_token');
    }

    // Perfil básico de Google (email)
    const oauth2 = google.oauth2({ version: 'v2', auth: client });
    const { data: profile } = await oauth2.userinfo.get().catch(() => ({ data: {} }));

    const q = { $or: [{ user: req.user._id }, { userId: req.user._id }] };
    let ga = await GoogleAccount.findOne(q).select(
      '+refreshToken scope selectedCustomerIds selectedPropertyIds selectedGaPropertyId'
    );

    if (!ga) {
      ga = new GoogleAccount({ user: req.user._id, userId: req.user._id });
    }

    ga.email = profile.email || ga.email || null;

    // Tokens
    if (refreshToken) {
      ga.refreshToken = refreshToken;
    } else if (!ga.refreshToken && tokens.refresh_token) {
      ga.refreshToken = tokens.refresh_token;
    }

    ga.accessToken = accessToken;
    ga.expiresAt = expiresAt;

    // Scopes acumulados
    const existingScopes = Array.isArray(ga.scope) ? ga.scope : [];
    ga.scope = normalizeScopes([...existingScopes, ...grantedScopes]);

    ga.updatedAt = new Date();
    await ga.save();

    // ============================
    // 1) Descubrir cuentas de Ads
    // ============================
    if (hasAdwordsScope(ga.scope) && ga.refreshToken) {
      try {
        const enriched = await discoverAndEnrich(ga); // multi-usuario (usa refreshToken)

        const customers = enriched.map((c) => ({
          id: normId(c.id),
          descriptiveName: c.name,
          currencyCode: c.currencyCode || null,
          timeZone: c.timeZone || null,
          status: c.status || null,
        }));

        const ad_accounts = enriched.map((c) => ({
          id: normId(c.id),
          name: c.name,
          currencyCode: c.currencyCode || null,
          timeZone: c.timeZone || null,
          status: c.status || null,
        }));

        const previous = normId(ga.defaultCustomerId || '');
        const firstEnabledId = ad_accounts.find((a) => (a.status || '').toUpperCase() === 'ENABLED')?.id;
        const defaultCustomerId = previous || firstEnabledId || (ad_accounts[0]?.id || null);

        ga.customers = customers;
        ga.ad_accounts = ad_accounts;

        if (defaultCustomerId) ga.defaultCustomerId = normId(defaultCustomerId);

        // ✅ (Fix) NO borres selección si el usuario ya eligió antes.
        const available = new Set(customers.map((c) => normId(c.id)).filter(Boolean));
        const adsCount = customers.length;

        if (adsCount === 1) {
          const onlyId = normId(customers[0].id);
          ga.selectedCustomerIds = [onlyId];

          // espejo en User (legacy/compat UI)
          await User.updateOne(
            { _id: req.user._id },
            {
              $set: {
                selectedGoogleAccounts: [onlyId],
                'preferences.googleAds.auditAccountIds': [onlyId],
              },
            }
          );
        } else if (adsCount > 1) {
          const kept = filterSelectedByAvailable(ga.selectedCustomerIds, available);
          ga.selectedCustomerIds = kept; // si está vacío, queda vacío => forzará selector
        }

        // (Opcional) si hay selección, asegúrate que default caiga dentro
        if (Array.isArray(ga.selectedCustomerIds) && ga.selectedCustomerIds.length) {
          const d = normId(ga.defaultCustomerId || '');
          if (!d || !ga.selectedCustomerIds.includes(d)) {
            ga.defaultCustomerId = ga.selectedCustomerIds[0];
          }
        }

        ga.lastAdsDiscoveryError = null;
        ga.lastAdsDiscoveryLog = null;
        ga.updatedAt = new Date();
        await ga.save();

        // selftest opcional
        try {
          const st = await selfTest(ga);
          console.log('[googleConnect] Google Ads selfTest:', st);
        } catch (err) {
          console.warn('[googleConnect] selfTest error:', err.message);
        }
      } catch (e) {
        const reason = e?.response?.data || e?.message || 'DISCOVERY_FAILED';
        console.warn('⚠️ Ads discovery failed:', reason);
        ga.lastAdsDiscoveryError = String(reason).slice(0, 4000);
        ga.updatedAt = new Date();
        await ga.save();
      }
    } else {
      if (!hasAdwordsScope(ga.scope)) {
        ga.lastAdsDiscoveryError = 'ADS_SCOPE_MISSING';
        await ga.save();
      }
    }

    // ============================
    // 2) Listar properties GA4
    // ============================
    if (hasGaScope(ga.scope) && ga.refreshToken) {
      try {
        const propsRaw = await fetchGA4Properties(client);

        // normaliza + dedupe
        const map = new Map();
        for (const p of Array.isArray(propsRaw) ? propsRaw : []) {
          const pid = normPropertyId(p?.propertyId || p?.name || '');
          if (!pid) continue;
          map.set(pid, {
            propertyId: pid,
            displayName: p?.displayName || pid,
            timeZone: p?.timeZone || null,
            currencyCode: p?.currencyCode || null,
          });
        }
        const props = Array.from(map.values());

        if (props.length > 0) {
          ga.gaProperties = props;

          const availableProps = new Set(props.map((p) => p.propertyId));

          // defaultPropertyId: siempre debe ser válido
          const currDefault = normPropertyId(ga.defaultPropertyId);
          if (!currDefault || !availableProps.has(currDefault)) {
            ga.defaultPropertyId = props[0].propertyId;
          } else {
            ga.defaultPropertyId = currDefault;
          }

          // ✅ (Fix) No borres selección si ya existía; valida contra disponibles.
          if (props.length === 1) {
            const onlyPid = props[0].propertyId;
            ga.selectedPropertyIds = [onlyPid];
            ga.selectedGaPropertyId = onlyPid; // legacy mirror
            ga.defaultPropertyId = onlyPid;

            // espejo en User (legacy + preferences)
            await User.updateOne(
              { _id: req.user._id },
              {
                $set: {
                  selectedGAProperties: [onlyPid],
                  'preferences.googleAnalytics.auditPropertyIds': [onlyPid],
                },
              }
            );
          } else if (props.length > 1) {
            // Canonical primero
            let kept = filterSelectedPropsByAvailable(ga.selectedPropertyIds, availableProps);

            // Si no hay canonical, intenta legacy
            if (!kept.length) {
              const legacy = normPropertyId(ga.selectedGaPropertyId);
              if (legacy && availableProps.has(legacy)) kept = [legacy];
            }

            ga.selectedPropertyIds = kept;

            // Mantén legacy alineado (si hay selección)
            if (kept.length) {
              ga.selectedGaPropertyId = kept[0];
              if (!ga.defaultPropertyId || !kept.includes(normPropertyId(ga.defaultPropertyId))) {
                ga.defaultPropertyId = kept[0];
              }
            } else {
              // si no hay selección, no forces legacy (para que el sistema pida selector)
              ga.selectedGaPropertyId = null;
            }
          }

          ga.updatedAt = new Date();
          await ga.save();
        }
      } catch (e) {
        console.warn('⚠️ GA4 properties listing failed:', e?.response?.data || e.message);
      }
    }

    // Marcar usuario como conectado a Google
    await User.findByIdAndUpdate(req.user._id, {
      $set: { googleConnected: true },
    });

    // Objetivo por defecto (ventas) si no existe
    const [uObj, gaObj] = await Promise.all([
      User.findById(req.user._id).select('googleObjective').lean(),
      GoogleAccount.findOne(q).select('objective').lean(),
    ]);

    if (!(uObj?.googleObjective) && !(gaObj?.objective)) {
      await Promise.all([
        User.findByIdAndUpdate(req.user._id, {
          $set: { googleObjective: DEFAULT_GOOGLE_OBJECTIVE },
        }),
        GoogleAccount.findOneAndUpdate(
          q,
          { $set: { objective: DEFAULT_GOOGLE_OBJECTIVE, updatedAt: new Date() } },
          { upsert: true }
        ),
      ]);
    }

    // ========== Selector? (más preciso) ==========
    const freshGa = await GoogleAccount.findOne(q)
      .select('customers gaProperties selectedCustomerIds selectedPropertyIds selectedGaPropertyId')
      .lean();

    const customers = Array.isArray(freshGa?.customers) ? freshGa.customers : [];
    const gaProps = Array.isArray(freshGa?.gaProperties) ? freshGa.gaProperties : [];

    const adsCount = customers.length;
    const gaCount = gaProps.length;

    const selAds = Array.isArray(freshGa?.selectedCustomerIds)
      ? freshGa.selectedCustomerIds.map(normId).filter(Boolean)
      : [];
    const selGa = Array.isArray(freshGa?.selectedPropertyIds)
      ? freshGa.selectedPropertyIds.map(normPropertyId).filter(Boolean)
      : [];

    const legacyGa = freshGa?.selectedGaPropertyId ? normPropertyId(freshGa.selectedGaPropertyId) : null;
    const gaEffectiveSel = selGa.length ? selGa : legacyGa ? [legacyGa] : [];

    const needsSelector =
      (adsCount > 1 && selAds.length === 0) ||
      (gaCount > 1 && gaEffectiveSel.length === 0);

    // ReturnTo desde state
    let returnTo = '/onboarding?google=connected';
    if (req.query.state) {
      try {
        const s = JSON.parse(req.query.state);
        if (s && typeof s.returnTo === 'string' && s.returnTo.trim()) {
          returnTo = s.returnTo;
        }
      } catch {
        // ignore
      }
    }

    const sep = returnTo.includes('?') ? '&' : '?';
    returnTo = `${returnTo}${sep}selector=${needsSelector ? '1' : '0'}`;

    return res.redirect(returnTo);
  } catch (err) {
    console.error('[googleConnect] callback error:', err?.response?.data || err.message || err);
    return res.redirect('/onboarding?google=error&reason=callback_exception');
  }
}

// Rutas de callback (mantengo las 3 que ya tenías)
router.get('/callback', requireSession, googleCallbackHandler);
router.get('/connect/callback', requireSession, googleCallbackHandler);
router.get('/ads/callback', requireSession, googleCallbackHandler);

/* =========================
 * Estado de conexión
 * ========================= */
router.get('/status', requireSession, async (req, res) => {
  try {
    const u = await User.findById(req.user._id).lean();

    const ga = await GoogleAccount.findOne({
      $or: [{ user: req.user._id }, { userId: req.user._id }],
    })
      .select(
        '+refreshToken +accessToken objective defaultCustomerId ' +
        'customers ad_accounts scope gaProperties defaultPropertyId ' +
        'lastAdsDiscoveryError lastAdsDiscoveryLog expiresAt ' +
        'selectedCustomerIds selectedGaPropertyId selectedPropertyIds'
      )
      .lean();

    const hasTokens = !!(ga?.refreshToken || ga?.accessToken);
    const customers = Array.isArray(ga?.customers) ? ga.customers : [];
    const adAccounts = Array.isArray(ga?.ad_accounts) ? ga.ad_accounts : [];
    const gaProperties = Array.isArray(ga?.gaProperties) ? ga.gaProperties : [];

    const previous = normId(ga?.defaultCustomerId || '');
    const firstEnabledId = adAccounts.find((a) => (a.status || '').toUpperCase() === 'ENABLED')?.id;
    const fallbackDefault = normId(customers?.[0]?.id || '') || null;
    const defaultCustomerId = previous || firstEnabledId || fallbackDefault;

    const scopesArr = Array.isArray(ga?.scope) ? ga.scope : [];
    const adsScopeOk = hasAdwordsScope(scopesArr);
    const gaScopeOk = hasGaScope(scopesArr);

    // ✅ Selección Ads
    const selectedCustomerIds = Array.isArray(ga?.selectedCustomerIds)
      ? ga.selectedCustomerIds.map(normId).filter(Boolean)
      : [];

    // ✅ Selección GA4 (effective: canonical > legacy)
    const canonicalProps = Array.isArray(ga?.selectedPropertyIds)
      ? ga.selectedPropertyIds.map(normPropertyId).filter(Boolean)
      : [];

    const legacySelectedGaPropertyId = ga?.selectedGaPropertyId ? normPropertyId(ga.selectedGaPropertyId) : null;

    const gaAvailableSet = new Set(
      gaProperties.map((p) => normPropertyId(p?.propertyId || p?.name)).filter(Boolean)
    );

    // Filtra selección a propiedades disponibles (evita estados “fantasma”)
    let selectedPropertyIds = canonicalProps.filter((pid) => gaAvailableSet.has(pid));
    if (!selectedPropertyIds.length && legacySelectedGaPropertyId && gaAvailableSet.has(legacySelectedGaPropertyId)) {
      selectedPropertyIds = [legacySelectedGaPropertyId];
    }

    const defaultPropertyId = ga?.defaultPropertyId ? normPropertyId(ga.defaultPropertyId) : null;
    const defaultPropertyIdSafe =
      defaultPropertyId && gaAvailableSet.has(defaultPropertyId)
        ? defaultPropertyId
        : (gaProperties[0]?.propertyId ? normPropertyId(gaProperties[0].propertyId) : null);

    // ✅ Flags útiles para UI / Integraciones
    const requiredSelectionAds = customers.length > 1 && selectedCustomerIds.length === 0;
    const requiredSelectionGa4 = gaProperties.length > 1 && selectedPropertyIds.length === 0;

    res.json({
      ok: true,
      connected: !!u?.googleConnected && hasTokens,

      // Ads
      hasCustomers: customers.length > 0,
      defaultCustomerId,
      customers,
      ad_accounts: adAccounts,
      selectedCustomerIds,

      // Scopes/objetivo
      scopes: scopesArr,
      adsScopeOk,
      gaScopeOk,
      objective: u?.googleObjective || ga?.objective || null,

      // GA4
      gaProperties,
      defaultPropertyId: defaultPropertyIdSafe,
      selectedPropertyIds,
      selectedGaPropertyId: legacySelectedGaPropertyId, // legacy para compat

      // UI hints (opcional pero útil)
      requiredSelectionAds,
      requiredSelectionGa4,

      // Debug
      expiresAt: ga?.expiresAt || null,
      lastAdsDiscoveryError: ga?.lastAdsDiscoveryError || null,
      lastAdsDiscoveryLog: ga?.lastAdsDiscoveryLog || null,
    });
  } catch (err) {
    console.error('[googleConnect] status error:', err);
    res.status(500).json({ ok: false, error: 'STATUS_ERROR' });
  }
});

/* =========================
 * Guardar objetivo (ventas / alcance / leads)
 * ========================= */
router.post('/objective', requireSession, express.json(), async (req, res) => {
  try {
    const val = String(req.body?.objective || '').trim().toLowerCase();
    if (!['ventas', 'alcance', 'leads'].includes(val)) {
      return res.status(400).json({ ok: false, error: 'BAD_OBJECTIVE' });
    }

    await User.findByIdAndUpdate(req.user._id, { $set: { googleObjective: val } });
    await GoogleAccount.findOneAndUpdate(
      { $or: [{ user: req.user._id }, { userId: req.user._id }] },
      { $set: { objective: val, updatedAt: new Date() } },
      { upsert: true }
    );

    res.json({ ok: true });
  } catch (err) {
    console.error('[googleConnect] save objective error:', err);
    res.status(500).json({ ok: false, error: 'SAVE_OBJECTIVE_ERROR' });
  }
});

/* =========================
 * Listar cuentas Ads (selector / Integraciones)
 * ========================= */
router.get('/accounts', requireSession, async (req, res) => {
  try {
    let ga = await GoogleAccount.findOne({
      $or: [{ user: req.user._id }, { userId: req.user._id }],
    })
      .select(
        '+refreshToken +accessToken customers ad_accounts scope defaultCustomerId ' +
        'lastAdsDiscoveryError lastAdsDiscoveryLog selectedCustomerIds'
      )
      .lean();

    if (!ga || (!ga.refreshToken && !ga.accessToken)) {
      return res.json({
        ok: true,
        customers: [],
        ad_accounts: [],
        defaultCustomerId: null,
        selectedCustomerIds: [],
        scopes: [],
        lastAdsDiscoveryError: ga?.lastAdsDiscoveryError || null,
        lastAdsDiscoveryLog: ga?.lastAdsDiscoveryLog || null,
      });
    }

    const scopesArr = Array.isArray(ga?.scope) ? ga.scope : [];
    if (!hasAdwordsScope(scopesArr)) {
      return res.status(428).json({
        ok: false,
        error: 'ADS_SCOPE_MISSING',
        message: 'Necesitamos permiso de Google Ads para listar tus cuentas.',
        connectUrl: '/auth/google/connect?returnTo=/onboarding?google=connected',
      });
    }

    let customers = ga.customers || [];
    let ad_accounts = ga.ad_accounts || [];
    const forceRefresh = req.query.refresh === '1';

    if (forceRefresh || customers.length === 0 || ad_accounts.length === 0) {
      const fullGa = await GoogleAccount.findOne({
        $or: [{ user: req.user._id }, { userId: req.user._id }],
      });

      if (!fullGa || !fullGa.refreshToken) {
        return res.json({
          ok: true,
          customers: [],
          ad_accounts: [],
          defaultCustomerId: null,
          selectedCustomerIds: [],
          scopes: scopesArr,
          lastAdsDiscoveryError: ga?.lastAdsDiscoveryError || null,
          lastAdsDiscoveryLog: ga?.lastAdsDiscoveryLog || null,
        });
      }

      try {
        const enriched = await discoverAndEnrich(fullGa);

        customers = enriched.map((c) => ({
          id: normId(c.id),
          descriptiveName: c.name,
          currencyCode: c.currencyCode || null,
          timeZone: c.timeZone || null,
          status: c.status || null,
        }));

        ad_accounts = enriched.map((c) => ({
          id: normId(c.id),
          name: c.name,
          currencyCode: c.currencyCode || null,
          timeZone: c.timeZone || null,
          status: c.status || null,
        }));

        fullGa.customers = customers;
        fullGa.ad_accounts = ad_accounts;
        fullGa.lastAdsDiscoveryError = null;
        fullGa.lastAdsDiscoveryLog = null;

        // ✅ Mantener selección si sigue siendo válida
        const avail = new Set(customers.map((c) => normId(c.id)).filter(Boolean));
        const kept = filterSelectedByAvailable(fullGa.selectedCustomerIds, avail);
        fullGa.selectedCustomerIds = kept;

        // default dentro de selección (si hay)
        if (kept.length) {
          const d = normId(fullGa.defaultCustomerId || '');
          if (!d || !kept.includes(d)) fullGa.defaultCustomerId = kept[0];
        }

        fullGa.updatedAt = new Date();
        await fullGa.save();

        ga = fullGa.toObject();
      } catch (e) {
        const reason = e?.response?.data || e?.message || 'LAZY_DISCOVERY_FAILED';
        console.warn('⚠️ lazy ads refresh failed:', reason);
        await GoogleAccount.updateOne(
          { $or: [{ user: req.user._id }, { userId: req.user._id }] },
          { $set: { lastAdsDiscoveryError: String(reason).slice(0, 4000), updatedAt: new Date() } }
        );
      }
    }

    const previous = normId(ga?.defaultCustomerId || '');
    const firstEnabledId = ad_accounts.find((a) => (a.status || '').toUpperCase() === 'ENABLED')?.id;
    const defaultCustomerId =
      previous || firstEnabledId || normId(customers?.[0]?.id || '') || null;

    const selectedCustomerIds = Array.isArray(ga?.selectedCustomerIds)
      ? ga.selectedCustomerIds.map(normId).filter(Boolean)
      : [];

    res.json({
      ok: true,
      customers,
      ad_accounts,
      defaultCustomerId,
      selectedCustomerIds,
      scopes: scopesArr,
      lastAdsDiscoveryError: ga?.lastAdsDiscoveryError || null,
      lastAdsDiscoveryLog: ga?.lastAdsDiscoveryLog || null,
    });
  } catch (err) {
    console.error('[googleConnect] accounts error:', err?.response?.data || err);
    return res.status(500).json({ ok: false, error: 'ACCOUNTS_ERROR' });
  }
});

/* =========================
 * ✅ Guardar selección Ads (Integraciones / onboarding)
 * Body: { customerIds: ["123", "customers/123", ...] }
 * ========================= */
router.post('/accounts/selection', requireSession, express.json(), async (req, res) => {
  try {
    const customerIds = req.body?.customerIds || req.body?.accountIds;
    if (!Array.isArray(customerIds)) {
      return res.status(400).json({ ok: false, error: 'customerIds[] requerido' });
    }

    const doc = await GoogleAccount.findOne({
      $or: [{ user: req.user._id }, { userId: req.user._id }],
    }).select('_id customers ad_accounts defaultCustomerId selectedCustomerIds');

    if (!doc) return res.status(404).json({ ok: false, error: 'NO_GOOGLEACCOUNT' });

    const available = new Set(
      uniq([
        ...(Array.isArray(doc.customers) ? doc.customers.map((c) => normId(c?.id)) : []),
        ...(Array.isArray(doc.ad_accounts) ? doc.ad_accounts.map((a) => normId(a?.id)) : []),
      ]).filter(Boolean)
    );

    const wanted = uniq(customerIds.map(normId)).filter(Boolean);
    const selected = wanted.filter((id) => available.has(id));

    if (!selected.length) {
      return res.status(400).json({ ok: false, error: 'NO_VALID_CUSTOMERS' });
    }

    // default dentro de selección
    let nextDefault = doc.defaultCustomerId ? normId(doc.defaultCustomerId) : '';
    if (!nextDefault || !selected.includes(nextDefault)) nextDefault = selected[0];

    await GoogleAccount.updateOne(
      { _id: doc._id },
      { $set: { selectedCustomerIds: selected, defaultCustomerId: nextDefault, updatedAt: new Date() } }
    );

    // espejo en User
    await User.updateOne(
      { _id: req.user._id },
      {
        $set: {
          selectedGoogleAccounts: selected,
          'preferences.googleAds.auditAccountIds': selected,
        },
      }
    );

    return res.json({ ok: true, selectedCustomerIds: selected, defaultCustomerId: nextDefault });
  } catch (e) {
    console.error('[googleConnect] accounts/selection error:', e);
    return res.status(500).json({ ok: false, error: 'SELECTION_SAVE_ERROR' });
  }
});

/* =========================
 * Guardar defaultCustomerId (legacy, se mantiene)
 * ========================= */
router.post('/default-customer', requireSession, express.json(), async (req, res) => {
  try {
    const cid = normId(req.body?.customerId || '');
    if (!cid) return res.status(400).json({ ok: false, error: 'CUSTOMER_REQUIRED' });

    await GoogleAccount.findOneAndUpdate(
      { $or: [{ user: req.user._id }, { userId: req.user._id }] },
      { $set: { defaultCustomerId: cid, updatedAt: new Date() } },
      { upsert: true }
    );

    res.json({ ok: true, defaultCustomerId: cid });
  } catch (err) {
    console.error('[googleConnect] default-customer error:', err);
    res.status(500).json({ ok: false, error: 'SAVE_DEFAULT_CUSTOMER_ERROR' });
  }
});

/* =========================
 * Guardar defaultPropertyId (GA4)
 * ========================= */
router.post('/default-property', requireSession, express.json(), async (req, res) => {
  try {
    const pid = normPropertyId(req.body?.propertyId || '');
    if (!pid) return res.status(400).json({ ok: false, error: 'PROPERTY_REQUIRED' });

    await GoogleAccount.findOneAndUpdate(
      { $or: [{ user: req.user._id }, { userId: req.user._id }] },
      { $set: { defaultPropertyId: pid, updatedAt: new Date() } },
      { upsert: true }
    );

    res.json({ ok: true, defaultPropertyId: pid });
  } catch (err) {
    console.error('[googleConnect] default-property error:', err);
    res.status(500).json({ ok: false, error: 'SAVE_DEFAULT_PROPERTY_ERROR' });
  }
});

/* =========================
 * ✅ (Opcional) Guardar selección GA4 también desde aquí
 * Body: { propertyIds: ["properties/123","123"] }
 * Nota: tu canonical sigue siendo /api/google/analytics/selection,
 * pero esto ayuda si tu UI de Integraciones pega a /auth/google/...
 * ========================= */
router.post('/ga4/selection', requireSession, express.json(), async (req, res) => {
  try {
    const propertyIds = req.body?.propertyIds;
    if (!Array.isArray(propertyIds)) {
      return res.status(400).json({ ok: false, error: 'propertyIds[] requerido' });
    }

    const doc = await GoogleAccount.findOne({
      $or: [{ user: req.user._id }, { userId: req.user._id }],
    }).select('_id gaProperties defaultPropertyId selectedPropertyIds selectedGaPropertyId');

    if (!doc) return res.status(404).json({ ok: false, error: 'NO_GOOGLEACCOUNT' });

    const available = new Set(
      (Array.isArray(doc.gaProperties) ? doc.gaProperties : [])
        .map((p) => normPropertyId(p?.propertyId || p?.name))
        .filter(Boolean)
    );

    const wanted = uniq(propertyIds.map(normPropertyId)).filter(Boolean);
    const selected = wanted.filter((pid) => available.has(pid));

    if (!selected.length) {
      return res.status(400).json({ ok: false, error: 'NO_VALID_PROPERTIES' });
    }

    let nextDefault = doc.defaultPropertyId ? normPropertyId(doc.defaultPropertyId) : '';
    if (!nextDefault || !selected.includes(nextDefault)) nextDefault = selected[0];

    await GoogleAccount.updateOne(
      { _id: doc._id },
      {
        $set: {
          selectedPropertyIds: selected,
          selectedGaPropertyId: selected[0], // legacy mirror
          defaultPropertyId: nextDefault,
          updatedAt: new Date(),
        },
      }
    );

    await User.updateOne(
      { _id: req.user._id },
      {
        $set: {
          selectedGAProperties: selected,
          'preferences.googleAnalytics.auditPropertyIds': selected,
        },
      }
    );

    return res.json({ ok: true, selectedPropertyIds: selected, defaultPropertyId: nextDefault });
  } catch (e) {
    console.error('[googleConnect] ga4/selection error:', e);
    return res.status(500).json({ ok: false, error: 'SELECTION_SAVE_ERROR' });
  }
});

/* =========================
 * ✅ Desconectar Google (Ads + GA4)
 * POST /auth/google/disconnect
 * ========================= */
router.post('/disconnect', requireSession, express.json(), async (req, res) => {
  try {
    const q = { $or: [{ user: req.user._id }, { userId: req.user._id }] };

    // Traemos tokens (select:false) para poder revocar best-effort
    const ga = await GoogleAccount.findOne(q).select('+refreshToken +accessToken').lean();

    const refreshToken = ga?.refreshToken || null;
    const accessToken  = ga?.accessToken || null;

    // 1) Revocar token (best-effort)
    const revoke = await revokeGoogleTokenBestEffort({ refreshToken, accessToken });

    // 2) Limpiar GoogleAccount (canónico)
    await GoogleAccount.updateOne(
      q,
      {
        $set: {
          accessToken: null,
          refreshToken: null,
          expiresAt: null,

          scope: [],

          // Ads
          customers: [],
          ad_accounts: [],
          defaultCustomerId: null,
          selectedCustomerIds: [],
          managerCustomerId: null,
          loginCustomerId: null,

          // GA4
          gaProperties: [],
          defaultPropertyId: null,
          selectedPropertyIds: [],
          selectedGaPropertyId: null,

          // misc / debug
          lastAdsDiscoveryError: null,
          lastAdsDiscoveryLog: null,

          updatedAt: new Date(),
        },
      },
      { upsert: false }
    );

    // 3) Limpiar User (flags + selecciones)
    // ⚠️ NO tocamos googleObjective para no borrar preferencias del usuario.
    await User.updateOne(
      { _id: req.user._id },
      {
        $set: {
          googleConnected: false,

          // legacy selections
          selectedGoogleAccounts: [],
          selectedGAProperties: [],

          // preferences
          'preferences.googleAds.auditAccountIds': [],
          'preferences.googleAnalytics.auditPropertyIds': [],
        },
      }
    );

    return res.json({
      ok: true,
      disconnected: true,
      revokeAttempted: revoke.attempted,
      revokeOk: revoke.ok,
    });
  } catch (err) {
    console.error('[googleConnect] disconnect error:', err?.response?.data || err?.message || err);
    return res.status(500).json({ ok: false, error: 'DISCONNECT_ERROR' });
  }
});

module.exports = router;
