'use strict';

const express = require('express');
const axios = require('axios');
const { OAuth2Client } = require('google-auth-library');
const mongoose = require('mongoose');
const router = express.Router();

const User = require('../models/User');

/* ============================================================
 * Modelo GoogleAccount “resiliente” (si no existe el require)
 * ============================================================ */
let GoogleAccount;
try {
  GoogleAccount = require('../models/GoogleAccount');
} catch (_) {
  const { Schema, model } = mongoose;
  const schema = new Schema(
    {
      user:              { type: Schema.Types.ObjectId, ref: 'User', index: true, sparse: true },
      userId:            { type: Schema.Types.ObjectId, ref: 'User', index: true, sparse: true },
      accessToken:       { type: String, select: false },
      refreshToken:      { type: String, select: false },
      expiresAt:         { type: Date },
      managerCustomerId: { type: String },
      defaultCustomerId: { type: String }, // “1234567890” (sin guiones)
      customers:         { type: Array, default: [] }, // [{id, resourceName, descriptiveName, currencyCode, timeZone}]
      objective:         { type: String, enum: ['ventas','alcance','leads'], default: null },
      createdAt:         { type: Date, default: Date.now },
      updatedAt:         { type: Date, default: Date.now },
    },
    { collection: 'googleaccounts' }
  );
  schema.pre('save', function (next) { this.updatedAt = new Date(); next(); });
  GoogleAccount = mongoose.models.GoogleAccount || model('GoogleAccount', schema);
}

/* ========================
 * ENV
 * ====================== */
const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_CONNECT_CALLBACK_URL,   // ej: https://ai.adnova.digital/auth/google/connect/callback
  GOOGLE_DEVELOPER_TOKEN,
  GOOGLE_ADS_LOGIN_CUSTOMER_ID,  // opcional (MCC)
} = process.env;

const ADS_API = 'https://googleads.googleapis.com/v16';

/* ========================
 * Helpers / middlewares
 * ====================== */
function requireSession(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
}

function oauth() {
  return new OAuth2Client({
    clientId:     GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    redirectUri:  GOOGLE_CONNECT_CALLBACK_URL,
  });
}

const normId = (s='') => String(s).replace(/-/g, '').trim();

/* ================ Google Ads small helpers ================= */
async function listAccessibleCustomers(accessToken) {
  // https://developers.google.com/google-ads/api/reference/rpc/v16/CustomerService#listaccessiblecustomers
  const { data } = await axios.get(`${ADS_API}/customers:listAccessibleCustomers`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'developer-token': GOOGLE_DEVELOPER_TOKEN,
      'Content-Type': 'application/json',
    },
    timeout: 20000,
  });
  // resourceNames: ["customers/1234567890", ...]
  return Array.isArray(data?.resourceNames) ? data.resourceNames : [];
}

async function fetchCustomer(accessToken, cid) {
  // GET customers/{id}
  const { data } = await axios.get(`${ADS_API}/customers/${cid}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'developer-token': GOOGLE_DEVELOPER_TOKEN,
      'Content-Type': 'application/json',
    },
    timeout: 15000,
  });
  // Campos más comunes para el front
  return {
    id: normId(cid),
    resourceName: data?.resourceName || `customers/${cid}`,
    descriptiveName: data?.descriptiveName || null,
    currencyCode: data?.currencyCode || null,
    timeZone: data?.timeZone || null,
  };
}

async function discoverCustomers(accessToken) {
  const rn = await listAccessibleCustomers(accessToken);
  const ids = rn.map((r) => (r || '').split('/')[1]).filter(Boolean);
  const out = [];
  for (const cid of ids.slice(0, 50)) {
    try { out.push(await fetchCustomer(accessToken, cid)); }
    catch { /* omitimos errores individuales */ }
  }
  return out;
}

/* ============================================================
 * 1) Iniciar conexión
 *    GET /auth/google/connect[?returnTo=/onboarding%3Fgoogle%3Dconnected]
 * ============================================================ */
router.get('/connect', requireSession, async (req, res) => {
  try {
    const client   = oauth();
    const returnTo = typeof req.query.returnTo === 'string' && req.query.returnTo.trim()
      ? req.query.returnTo
      : '/onboarding?google=connected';

    const url = client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent', // asegura refresh_token la primera vez
      scope: [
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/userinfo.profile',
        // Google Ads (imprescindible para insights/auditoría)
        'https://www.googleapis.com/auth/adwords',
      ],
      state: JSON.stringify({
        uid: String(req.user._id),
        returnTo,
      }),
    });

    return res.redirect(url);
  } catch (err) {
    console.error('google connect error:', err);
    return res.redirect('/onboarding?google=error&reason=connect_build');
  }
});

/* ============================================================
 * 2) Callback OAuth
 *    Acepta /auth/google/callback y /auth/google/connect/callback
 * ============================================================ */
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
    const { tokens } = await client.getToken(code); // { access_token, refresh_token?, expiry_date, ... }
    if (!tokens?.access_token) {
      return res.redirect('/onboarding?google=error&reason=no_access_token');
    }

    const accessToken = tokens.access_token;
    const refreshToken = tokens.refresh_token || null;
    const expiresAt = tokens.expiry_date ? new Date(tokens.expiry_date) : null;

    // Descubrir customers accesibles
    let customers = [];
    try {
      customers = await discoverCustomers(accessToken);
    } catch (e) {
      console.warn('⚠️ no se pudieron listar customers:', e?.response?.data || e.message);
    }

    // Elegimos defaultCustomerId si se puede
    const defaultCustomerId = customers?.[0]?.id || null;

    // Persistimos GoogleAccount
    const q = { $or: [{ user: req.user._id }, { userId: req.user._id }] };
    const update = {
      user: req.user._id,
      userId: req.user._id,
      accessToken,
      expiresAt,
      customers,
      ...(defaultCustomerId ? { defaultCustomerId } : {}),
      updatedAt: new Date(),
    };
    if (refreshToken) update.refreshToken = refreshToken;

    await GoogleAccount.findOneAndUpdate(q, update, { upsert: true, new: true, setDefaultsOnInsert: true });

    // Flag en el usuario
    await User.findByIdAndUpdate(req.user._id, { $set: { googleConnected: true } });

    // Resuelve returnTo desde state (si viene)
    let returnTo = '/onboarding?google=connected';
    if (req.query.state) {
      try {
        const s = JSON.parse(req.query.state);
        if (s && typeof s.returnTo === 'string' && s.returnTo.trim()) returnTo = s.returnTo;
      } catch { /* ignore */ }
    }

    return res.redirect(returnTo);
  } catch (err) {
    console.error('google callback error:', err?.response?.data || err.message || err);
    return res.redirect('/onboarding?google=error&reason=callback_exception');
  }
}

router.get('/callback',         requireSession, googleCallbackHandler);
router.get('/connect/callback', requireSession, googleCallbackHandler);

/* ============================================================
 * 3) Status para onboarding
 *    GET /auth/google/status
 * ============================================================ */
router.get('/status', requireSession, async (req, res) => {
  try {
    const u = await User.findById(req.user._id).lean();

    const ga = await GoogleAccount.findOne({
      $or: [{ user: req.user._id }, { userId: req.user._id }],
    })
      .select('+refreshToken +accessToken objective defaultCustomerId customers managerCustomerId')
      .lean();

    const hasTokens = !!(ga?.refreshToken || ga?.accessToken);
    const customers = Array.isArray(ga?.customers) ? ga.customers : [];
    const defaultCustomerId = ga?.defaultCustomerId || customers?.[0]?.id || null;

    res.json({
      ok: true,
      connected: !!u?.googleConnected && hasTokens,
      hasCustomers: customers.length > 0,
      defaultCustomerId,
      customers,
      objective: u?.googleObjective || ga?.objective || null,
      managerCustomerId: ga?.managerCustomerId || null,
    });
  } catch (err) {
    console.error('google status error:', err);
    res.status(500).json({ ok: false, error: 'STATUS_ERROR' });
  }
});

/* ============================================================
 * 4) Guardar objetivo
 *    POST /auth/google/objective  body: { objective: "ventas"|"alcance"|"leads" }
 * ============================================================ */
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
    console.error('save objective error:', err);
    res.status(500).json({ ok: false, error: 'SAVE_OBJECTIVE_ERROR' });
  }
});

/* ============================================================
 * 5) Listar cuentas (si necesitas re-listar tras conectar)
 *    GET /auth/google/accounts
 * ============================================================ */
router.get('/accounts', requireSession, async (req, res) => {
  try {
    const ga = await GoogleAccount.findOne({
      $or: [{ user: req.user._id }, { userId: req.user._id }],
    })
      .select('+accessToken +refreshToken customers')
      .lean();

    if (!ga || (!ga.accessToken && !ga.refreshToken)) {
      return res.json({ ok: true, customers: [], defaultCustomerId: null });
    }

    // Usamos el accessToken actual (sin refresh aquí por simplicidad)
    const accessToken = ga.accessToken;
    let customers = ga.customers || [];

    // Si no tenemos guardados, intentamos descubrir
    if (!customers || customers.length === 0) {
      try { customers = await discoverCustomers(accessToken); } catch {}
      await GoogleAccount.updateOne(
        { _id: ga._id },
        { $set: { customers, updatedAt: new Date() } }
      );
    }

    const defaultCustomerId = ga.defaultCustomerId || customers?.[0]?.id || null;
    res.json({ ok: true, customers, defaultCustomerId });
  } catch (err) {
    console.error('google accounts error:', err);
    res.status(500).json({ ok: false, error: 'ACCOUNTS_ERROR' });
  }
});

/* ============================================================
 * 6) Fijar cuenta por defecto
 *    POST /auth/google/default-customer  body: { customerId: "123..." }
 * ============================================================ */
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
    console.error('google default-customer error:', err);
    res.status(500).json({ ok: false, error: 'SAVE_DEFAULT_CUSTOMER_ERROR' });
  }
});

module.exports = router;
