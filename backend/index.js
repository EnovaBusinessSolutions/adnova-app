// backend/index.js
require('dotenv').config();

const express = require('express');
const session = require('express-session');
const passport = require('passport');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const helmet = require('helmet');
const compression = require('compression');

require('./auth');

const User = require('./models/User');
const { sendVerifyEmail, sendWelcomeEmail, sendResetPasswordEmail } = require('./services/emailService');


/* =========================
 * Modelos para Integraciones (Disconnect)
 * (cargan con fallback para NO romper si cambia el schema)
 * ========================= */
let MetaAccount, GoogleAccount, ShopConnections;
try { MetaAccount = require('./models/MetaAccount'); } catch (_) { MetaAccount = null; }
try { GoogleAccount = require('./models/GoogleAccount'); } catch (_) { GoogleAccount = null; }
try { ShopConnections = require('./models/ShopConnections'); } catch (_) { ShopConnections = null; }


// Routers
const googleConnect = require('./routes/googleConnect');
const googleAdsInsightsRouter = require('./routes/googleAdsInsights');
const gaRouter = require('./routes/googleAnalytics');
const metaAuthRoutes = require('./routes/meta');
const privacyRoutes = require('./routes/privacyRoutes');
const mockShopify = require('./routes/mockShopify');
const shopifyRoutes = require('./routes/shopify');
const verifySessionToken = require('../middlewares/verifySessionToken');
const secureRoutes = require('./routes/secure');
const dashboardRoute = require('./api/dashboardRoute');
const { publicCSP, shopifyCSP } = require('../middlewares/csp');
const subscribeRouter = require('./routes/subscribe');
const userRoutes = require('./routes/user');
const auditRunnerRoutes = require('./routes/auditRunner');
const stripeRouter = require('./routes/stripe');
const billingRoutes = require('./routes/billing');
const connector = require('./routes/shopifyConnector');
const webhookRoutes = require('./routes/shopifyConnector/webhooks');
const auditsRoutes = require('./routes/audits');

// Meta
const metaInsightsRoutes = require('./routes/metaInsights');
const metaAccountsRoutes = require('./routes/metaAccounts');
const metaTable = require('./routes/metaTable');

const app = express();

// ✅ Debug de correo (ya usa mailer.js/emailService.js)
app.use('/__mail', require('./routes/mailDebug'));

const PORT = process.env.PORT || 3000;
const APP_URL = (process.env.APP_URL || 'https://adray.ai').replace(/\/$/, '');


/* =========================
 * Seguridad y performance
 * ========================= */
app.disable('x-powered-by');
app.use(
  helmet({
    // IMPORTANTE para apps embebidas de Shopify
    frameguard: false,
    contentSecurityPolicy: false,

    // esto lo puedes dejar
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);
app.use(compression());

/* =========================
 * CORS
 * ========================= */
const ALLOWED_ORIGINS = [
  'https://adray.ai',
  'https://admin.shopify.com',
  /^https?:\/\/[^/]+\.myshopify\.com$/i,
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // same-origin / curl / server-side
      const ok = ALLOWED_ORIGINS.some((rule) =>
        rule instanceof RegExp ? rule.test(origin) : rule === origin
      );
      return cb(ok ? null : new Error('CORS not allowed'), ok);
    },
    credentials: true,
  })
);
app.options(/.*/, cors());

/* =========================
 * Sesión y Passport
 * (ANTES de Stripe, webhooks y APIs)
 * ========================= */
app.set('trust proxy', 1);
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'adnova_secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
    },
  })
);
app.use(passport.initialize());
app.use(passport.session());

function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  return res.redirect('/login');
}
function ensureNotOnboarded(req, res, next) {
  if (!(req.isAuthenticated && req.isAuthenticated()))
    return res.redirect('/login');
  if (!req.user?.onboardingComplete) return next();
  return res.redirect('/dashboard');
}
function sessionGuard(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  return res.status(401).json({ error: 'No hay sesión' });
}

function isIframeRequest(req) {
  const dest = (req.get('sec-fetch-dest') || '').toLowerCase();
  return dest === 'iframe' || req.query.embedded === '1';
}

// ✅ Debe estar ANTES de cualquier uso
function topLevelRedirect(res, url, label = 'Continuar con Shopify') {
  return res
    .status(200)
    .type('html')
    .send(`<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Continuar</title>
  <style>
    :root{color-scheme:dark}
    body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b1020;color:#fff;font-family:Inter,system-ui,Segoe UI,Roboto,Arial}
    .card{width:min(720px,92vw);background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:18px;padding:22px;box-shadow:0 18px 45px rgba(0,0,0,.55)}
    .btn{display:inline-flex;justify-content:center;align-items:center;border:0;border-radius:14px;padding:12px 16px;font-weight:800;font-size:14px;cursor:pointer;color:#fff;
      background:linear-gradient(90deg,rgba(124,58,237,1),rgba(59,130,246,1));min-width:220px}
    .muted{opacity:.75;font-size:12px;line-height:1.5;margin-top:10px}
    code{font-size:12px;opacity:.9}
  </style>
</head>
<body>
  <div class="card">
    <h2 style="margin:0 0 8px 0;">${label}</h2>
    <div class="muted">
      Shopify requiere abrir esta página <b>fuera del iframe</b>. Da clic para continuar.
      <br/>Si no avanza, desactiva Brave Shields / AdBlock para <code>admin.shopify.com</code> y <code>adray.ai</code> en esta prueba.
    </div>
    <div style="margin-top:14px;">
      <button class="btn" id="go">Continuar</button>
    </div>
    <div class="muted" style="margin-top:10px;">
      <a href="${url}" target="_top" rel="noopener noreferrer" style="color:#9ecbff;">Abrir manualmente</a>
    </div>
  </div>

  <script>
    (function(){
      var url = ${JSON.stringify(url)};
      document.getElementById('go').addEventListener('click', function(){
        try { window.top.location.href = url; }
        catch(e){ window.location.href = url; }
      });
    })();
  </script>
</body>
</html>`);
}

// Si NO usas /connector/auth realmente, puedes borrar este bloque completo.
// Si SÍ existe, déjalo así:
app.get(['/connector/auth', '/connector/auth/callback'], (req, res, next) => {
  if (isIframeRequest(req)) {
    const url = new URL(req.originalUrl, APP_URL);
    return topLevelRedirect(res, url.toString());
  }
  return next();
});


/* =========================
 * Parsers especiales (antes de JSON global)
 * ========================= */
app.use(
  '/connector/webhooks',
  express.raw({ type: '*/*' }),
  webhookRoutes
);


// 2) Stripe: RAW **solo** en /api/stripe/webhook; JSON normal para el resto
app.use('/api/stripe', (req, res, next) => {
  if (req.path === '/webhook') {
    return express.raw({ type: 'application/json' })(req, res, next);
  }
  return express.json()(req, res, next);
});

// Router de Stripe (ya con sesión/passport disponibles)
app.use('/api/stripe', stripeRouter);

// Parsers globales
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

/* =========================
 * CSP (orden importante)
 * ========================= */
app.use(publicCSP);
app.use(shopifyCSP);


/* robots.txt simple */
app.get('/robots.txt', (_req, res) => {
  res.type('text/plain').send('User-agent: *\nDisallow:');
});

/* =========================
 * MongoDB
 * ========================= */
if (!process.env.MONGO_URI) {
  console.warn('⚠️  MONGO_URI no está configurado');
}
mongoose
  .connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log('✅ Conectado a MongoDB Atlas'))
  .catch((err) => console.error('❌ Error al conectar con MongoDB:', err));

/* =========================
 * Rutas utilitarias públicas
 * ========================= */
app.get('/agendar', (_req, res) => {
  const file = path.join(__dirname, '../public/agendar.html');
  let html = fs.readFileSync(file, 'utf8');

  const bookingUrl = process.env.BOOKING_URL || '';
  html = html.replace(/{{BOOKING_URL}}/g, bookingUrl);

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

app.get('/api/public-config', (_req, res) => {
  res.json({ bookingUrl: process.env.BOOKING_URL || '' });
});

/* =========================
 * Static / dashboard
 * ========================= */
const DASHBOARD_DIST = path.join(__dirname, '../dashboard-src/dist');
const LEGACY_DASH = path.join(__dirname, '../public/dashboard');
const HAS_DASHBOARD_DIST = fs.existsSync(path.join(DASHBOARD_DIST, 'index.html'));

if (HAS_DASHBOARD_DIST) {
  app.use(
    '/assets',
    express.static(path.join(DASHBOARD_DIST, 'assets'), {
      immutable: true,
      maxAge: '1y',
    })
  );
  app.use('/dashboard', ensureAuthenticated, express.static(DASHBOARD_DIST));
  app.get(/^\/dashboard(?:\/.*)?$/, ensureAuthenticated, (_req, res) => {
    res.sendFile(path.join(DASHBOARD_DIST, 'index.html'));
  });
  console.log('✅ Dashboard servido desde submódulo: dashboard-src/dist');
} else {
  app.use('/assets', express.static(path.join(LEGACY_DASH, 'assets')));
  app.use('/dashboard', ensureAuthenticated, express.static(LEGACY_DASH));
  app.get(/^\/dashboard(?:\/.*)?$/, ensureAuthenticated, (_req, res) => {
    res.sendFile(path.join(LEGACY_DASH, 'index.html'));
  });
  console.warn('⚠️ dashboard-src/dist no encontrado. Usando fallback /public/dashboard');
}

app.use('/api/bookcall', require('./routes/bookcall'));

/* =========================
 * Rutas de autenticación e integraciones
 * ========================= */
app.use('/auth/google', googleConnect);
app.use('/auth/meta', metaAuthRoutes);
app.use('/', privacyRoutes);

// Google Analytics (GA4)
app.use('/api/google/analytics', gaRouter);

app.use('/api/google/ads/insights', sessionGuard, googleAdsInsightsRouter);
app.use('/api/google/ads', sessionGuard, googleAdsInsightsRouter);

app.use('/api/onboarding/status', sessionGuard, require('./routes/onboardingStatus'));

/* =========================
 * ✅ Integraciones: DISCONNECT (E2E)
 * - Limpia tokens + selección (DB)
 * - No rompe nada de lo actual (solo agrega rutas nuevas)
 * ========================= */

// Utilidad pequeña para limpiar arrays
const emptyArr = () => [];

// GOOGLE (Ads + GA4) — desconectar
app.post('/api/integrations/disconnect/google', sessionGuard, async (req, res) => {
  try {
    const uid = req.user._id;

    // 1) GoogleAccount (canónico)
    if (GoogleAccount) {
      await GoogleAccount.updateOne(
        { $or: [{ user: uid }, { userId: uid }] },
        {
          $set: {
            accessToken: null,
            refreshToken: null,
            expiresAt: null,
            scope: emptyArr(),

            // Ads
            managerCustomerId: null,
            loginCustomerId: null,
            defaultCustomerId: null,
            customers: emptyArr(),
            ad_accounts: emptyArr(),
            selectedCustomerIds: emptyArr(),
            lastAdsDiscoveryError: null,

            // GA4
            gaProperties: emptyArr(),
            defaultPropertyId: null,
            selectedPropertyIds: emptyArr(),
            selectedGaPropertyId: null,

            updatedAt: new Date(),
          },
        },
        { upsert: false }
      );
    }

    // 2) User (legacy flags + selections)
    await User.updateOne(
      { _id: uid },
      {
        $set: {
          googleConnected: false,
          selectedGoogleAccounts: emptyArr(),
          selectedGAProperties: emptyArr(),
        },
        $unset: {
          // si existen en tu User schema viejo, los quitamos sin romper
          googleAccessToken: '',
          googleRefreshToken: '',
        },
      }
    );

    // 3) Preferences (si existen, no rompe si no existen)
    await User.updateOne(
      { _id: uid },
      {
        $set: {
          'preferences.googleAds.auditAccountIds': emptyArr(),
          'preferences.googleAnalytics.auditPropertyIds': emptyArr(),
        },
      }
    );

    return res.json({ ok: true });
  } catch (e) {
    console.error('[disconnect/google] error:', e);
    return res.status(500).json({ ok: false, error: 'DISCONNECT_GOOGLE_FAILED' });
  }
});

// Alias (por si tu frontend lo llama así)
app.post('/api/integrations/google/disconnect', sessionGuard, (req, res) =>
  res.redirect(307, '/api/integrations/disconnect/google')
);


// META — desconectar
app.post('/api/integrations/disconnect/meta', sessionGuard, async (req, res) => {
  try {
    const uid = req.user._id;

    // 1) MetaAccount (canónico)
    if (MetaAccount) {
      await MetaAccount.updateOne(
        { $or: [{ user: uid }, { userId: uid }] },
        {
          $set: {
            // tokens (alias)
            longLivedToken: null,
            longlivedToken: null,
            access_token: null,
            accessToken: null,
            token: null,

            expiresAt: null,
            expires_at: null,

            // cuentas + selección
            ad_accounts: emptyArr(),
            adAccounts: emptyArr(),
            selectedAccountIds: emptyArr(),
            defaultAccountId: null,

            // scopes / metadata
            scopes: emptyArr(),
            fb_user_id: null,

            updatedAt: new Date(),
          },
        },
        { upsert: false }
      );
    }

    // 2) User (legacy flags + selections)
    await User.updateOne(
      { _id: uid },
      {
        $set: {
          metaConnected: false,
          metaFbUserId: null,
          metaScopes: emptyArr(),
          selectedMetaAccounts: emptyArr(),
        },
        $unset: {
          metaAccessToken: '',
          metaTokenExpiresAt: '',
          metaDefaultAccountId: '',
        },
      }
    );

    return res.json({ ok: true });
  } catch (e) {
    console.error('[disconnect/meta] error:', e);
    return res.status(500).json({ ok: false, error: 'DISCONNECT_META_FAILED' });
  }
});

// Alias
app.post('/api/integrations/meta/disconnect', sessionGuard, (req, res) =>
  res.redirect(307, '/api/integrations/disconnect/meta')
);


// SHOPIFY — desconectar
app.post('/api/integrations/disconnect/shopify', sessionGuard, async (req, res) => {
  try {
    const uid = req.user._id;

    // 1) ShopConnections (si existe)
    if (ShopConnections) {
      await ShopConnections.updateOne(
        { $or: [{ user: uid }, { userId: uid }] },
        {
          $set: {
            shop: null,
            accessToken: null,
            access_token: null,
            updatedAt: new Date(),
          },
        },
        { upsert: false }
      );
    }

    // 2) User
    await User.updateOne(
      { _id: uid },
      {
        $set: { shopifyConnected: false },
        $unset: {
          shop: '',
          shopifyAccessToken: '',
        },
      }
    );

    return res.json({ ok: true });
  } catch (e) {
    console.error('[disconnect/shopify] error:', e);
    return res.status(500).json({ ok: false, error: 'DISCONNECT_SHOPIFY_FAILED' });
  }
});

// Alias
app.post('/api/integrations/shopify/disconnect', sessionGuard, (req, res) =>
  res.redirect(307, '/api/integrations/disconnect/shopify')
);


// ✅ Auditorías
app.use('/api/audits', sessionGuard, auditRunnerRoutes);
app.use('/api/audits', sessionGuard, auditsRoutes);
app.use('/api/audit', sessionGuard, auditRunnerRoutes);
app.use('/api/dashboard/audits', sessionGuard, auditsRoutes);

app.post('/api/audit/start',        sessionGuard, (req, res) => res.redirect(307, '/api/audits/start'));
app.post('/api/audit/google/start', sessionGuard, (req, res) => res.redirect(307, '/api/audits/start'));
app.post('/api/audit/meta/start',   sessionGuard, (req, res) => res.redirect(307, '/api/audits/start'));
app.post('/api/audit/shopify/start',sessionGuard, (req, res) => res.redirect(307, '/api/audits/start'));
// Alias legacy del dashboard → usa el runner nuevo de auditorías
app.post('/api/dashboard/audit', sessionGuard, (req, res) => {
  // 307 = mantiene método y body (POST + JSON)
  return res.redirect(307, '/api/audits/start');
});


// Stripe / Facturapi / Billing
app.use('/api/facturapi', require('./routes/facturapi'));
app.use('/api/billing', billingRoutes);

// Meta Ads
app.use('/api/meta/insights', sessionGuard, metaInsightsRoutes);
app.use('/api/meta/accounts', sessionGuard, metaAccountsRoutes);
app.use('/api/meta', metaTable);

// Shopify
const verifyShopifyToken = require('../middlewares/verifyShopifyToken'); // (por ahora no usado)

// ✅ SERVIR assets del conector ANTES del router
const CONNECTOR_PUBLIC = path.join(__dirname, '../public/connector');

// Aplica el CSP de Shopify a todo lo que cuelgue de /connector
app.use(
  '/connector',
  express.static(CONNECTOR_PUBLIC, {
    index: false,
    maxAge: '1h',
  }),
  connector
);


app.use('/api/shopify', shopifyRoutes);
app.use('/api', mockShopify);


/* =========================
 * Páginas públicas y flujo de app
 * ========================= */
app.get('/', (req, res) => {
  const { shop } = req.query;
  if (shop) return res.redirect(`/connector?shop=${shop}`);
  if (req.isAuthenticated && req.isAuthenticated()) {
    return req.user.onboardingComplete
      ? res.redirect('/dashboard')
      : res.redirect('/onboarding');
  }
  return res.sendFile(path.join(__dirname, '../public/landing/index.html'));
});

app.get('/login', (_req, res) => {
  res.sendFile(path.join(__dirname, '../public/login.html'));
});

app.get('/onboarding', ensureNotOnboarded, async (req, res) => {
  const filePath = path.join(__dirname, '../public/onboarding.html');
  const user = await User.findById(req.user._id).lean();
  const alreadyConnectedShopify = user?.shopifyConnected || false;

  fs.readFile(filePath, 'utf8', (err, html) => {
    if (err) {
      console.error('❌ Error al leer onboarding.html:', err.stack || err);
      return res.status(500).send('Error al cargar la página de onboarding.');
    }
    let updatedHtml = html.replace('USER_ID_REAL', req.user._id.toString());
    updatedHtml = updatedHtml.replace(
      'SHOPIFY_CONNECTED_FLAG',
      alreadyConnectedShopify ? 'true' : 'false'
    );
    updatedHtml = updatedHtml.replace(
      'GOOGLE_CONNECTED_FLAG',
      user?.googleConnected ? 'true' : 'false'
    );
    res.send(updatedHtml);
  });
});

app.post('/api/complete-onboarding', async (req, res) => {
  try {
    if (!req.isAuthenticated()) {
      return res
        .status(401)
        .json({ success: false, message: 'No autenticado' });
    }
    const result = await User.findByIdAndUpdate(req.user._id, {
      onboardingComplete: true,
    });
    if (!result)
      return res
        .status(404)
        .json({ success: false, message: 'Usuario no encontrado' });
    res.json({ success: true });
  } catch (err) {
    console.error('❌ Error al completar onboarding:', err.stack || err);
    res.status(500).json({ success: false, message: 'Error del servidor' });
  }
});

// =========================
// Email verification helpers
// =========================
const VERIFY_TTL_HOURS = Number(process.env.VERIFY_EMAIL_TTL_HOURS || 24);

function makeVerifyToken() {
  return crypto.randomBytes(32).toString('hex'); // token que viaja por email
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}


/* =========================
 * Auth básica (email/pass)
 * ========================= */

app.post('/api/register', async (req, res) => {
  try {
    let { name, email, password } = req.body || {};

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Nombre, correo y contraseña son requeridos',
      });
    }

    name = String(name).trim();
    email = String(email).trim().toLowerCase();

    if (name.length < 2 || name.length > 60) {
      return res.status(400).json({
        success: false,
        message: 'El nombre debe tener entre 2 y 60 caracteres',
      });
    }

    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRe.test(email)) {
      return res.status(400).json({ success: false, message: 'Correo inválido' });
    }
    if (String(password).length < 8) {
      return res.status(400).json({
        success: false,
        message: 'La contraseña debe tener al menos 8 caracteres',
      });
    }

    const exists = await User.findOne({ email });
    if (exists) {
      return res.status(409).json({ success: false, message: 'El email ya está registrado' });
    }

    const hashed = await bcrypt.hash(password, 10);

    // ✅ Genera token verificación (guardamos hash en DB)
    const verifyToken = makeVerifyToken();
    const verifyTokenHash = hashToken(verifyToken);
    const verifyExpires = new Date(Date.now() + VERIFY_TTL_HOURS * 60 * 60 * 1000);

    // ✅ Crea usuario con verificación pendiente
    const user = await User.create({
      name,
      email,
      password: hashed,

      // Si tu schema no tenía estos campos, igual te recomiendo agregarlos al modelo User.
      // Si tu schema es strict y no los tiene, NO se guardarán (te lo indico abajo).
      emailVerified: false,
      verifyEmailTokenHash: verifyTokenHash,
      verifyEmailExpires: verifyExpires,
    });

    // ✅ Enviar correo de verificación (NO bloquea el registro si falla)
    try {
      await sendVerifyEmail({ toEmail: user.email, token: verifyToken, name: user.name });
    } catch (mailErr) {
      console.error('✉️  Email verificación falló (registro OK):', mailErr?.message || mailErr);
    }

    return res.status(201).json({
      success: true,
      message: 'Usuario registrado. Revisa tu correo para verificar tu cuenta.',
      confirmUrl: `/confirmation.html?email=${encodeURIComponent(user.email)}`,
    });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(409).json({ success: false, message: 'El email ya está registrado' });
    }
    console.error('❌ Error al registrar usuario:', err);
    return res.status(500).json({ success: false, message: 'Error interno al registrar' });
  }
});

app.get('/api/auth/verify-email', async (req, res) => {
  try {
    const token = String(req.query.token || '').trim();
    if (!token) return res.status(400).send('Token faltante');

    const tokenHash = hashToken(token);

    const user = await User.findOne({
      verifyEmailTokenHash: tokenHash,
      verifyEmailExpires: { $gt: new Date() },
    });

    if (!user) {
      return res
        .status(400)
        .send('El enlace de verificación es inválido o expiró. Solicita uno nuevo.');
    }

    user.emailVerified = true;
    user.verifyEmailTokenHash = undefined;
    user.verifyEmailExpires = undefined;
    await user.save();

    // ✅ Redirección a una página bonita (elige una)
    return res.redirect(302, '/login?verified=1');
  } catch (err) {
    console.error('❌ verify-email:', err);
    return res.status(500).send('Error al verificar el correo');
  }
});

/* =========================
 * ✅ LOGIN (email/pass) — E2E
 * - Crea sesión (req.login)
 * - Bloquea si email no está verificado
 * - Responde { success:true, redirect }
 * ========================= */
app.post(['/api/login', '/api/auth/login', '/login'], async (req, res, next) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Ingresa tu correo y contraseña.' });
    }

    // Importante: aseguramos traer password aunque tu schema tenga select:false
    const user = await User.findOne({ email }).select('+password +emailVerified');

    if (!user || !user.password) {
      return res.status(401).json({ success: false, message: 'Correo o contraseña incorrectos.' });
    }

    // ✅ Bloquear login si no verificó correo
    if (user.emailVerified === false) {
      return res.status(403).json({
        success: false,
        message: 'Tu correo aún no está verificado. Revisa tu bandeja de entrada.',
      });
    }

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      return res.status(401).json({ success: false, message: 'Correo o contraseña incorrectos.' });
    }

    // ✅ Crear sesión con Passport (usa serializeUser/deserializeUser de ./auth)
    req.login(user, (err) => {
      if (err) return next(err);

      const redirect = user.onboardingComplete ? '/dashboard' : '/onboarding';
      return res.json({ success: true, redirect });
    });
  } catch (err) {
    console.error('❌ /api/login error:', err);
    return res.status(500).json({ success: false, message: 'Error del servidor' });
  }
});


/* =========================
 * Utilidades de sesión / perfil
 * ========================= */
app.get('/api/session', async (req, res) => {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    return res.status(401).json({ authenticated: false });
  }
  try {
    const u = await User.findById(req.user._id).lean();
    if (!u) return res.status(401).json({ authenticated: false });
    return res.json({
      authenticated: true,
      user: {
        _id: u._id,
        email: u.email,
        shop: u.shop,
        onboardingComplete: u.onboardingComplete,
        googleConnected: !!u.googleConnected,
        metaConnected: !!u.metaConnected,
        shopifyConnected: !!u.shopifyConnected,
        googleObjective: u.googleObjective || null,
        metaObjective: u.metaObjective || null,
      },
    });
  } catch {
    return res.status(401).json({ authenticated: false });
  }
});

app.get('/api/saas/ping', sessionGuard, (req, res) => {
  res.json({ ok: true, user: req.user?.email });
});
app.use('/api/saas/shopify', sessionGuard, require('./routes/shopifyMatch'));

// Alias simple para /api/me (lo usa /plans/success y /plans)
app.get('/api/me', async (req, res) => {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    return res.status(401).json({ authenticated: false });
  }

  try {
    const u = await User.findById(req.user._id).lean();
    if (!u) {
      return res.status(401).json({ authenticated: false });
    }

    const {
      password,
      resetPasswordToken,
      resetPasswordExpires,
      ...safeUser
    } = u;

    return res.json({
      authenticated: true,
      user: {
        _id: safeUser._id,
        email: safeUser.email,
      },
      plan: safeUser.plan || 'gratis',
      subscription: safeUser.subscription || null,
    });
  } catch (e) {
    console.error('/api/me error', e);
    return res.status(500).json({
      authenticated: false,
      error: 'internal',
    });
  }
});

/* =========================
 * Otras APIs internas
 * ========================= */
app.use('/api', userRoutes);

app.use('/api/secure', verifySessionToken, secureRoutes);
app.use('/api/dashboard', dashboardRoute);
app.use('/api/shopConnection', require('./routes/shopConnection'));
app.use('/api', subscribeRouter);

// Estáticos (públicos)
app.use('/assets', express.static(path.join(__dirname, '../public/landing/assets')));
app.use('/assets', express.static(path.join(__dirname, '../public/support/assets')));
app.use('/assets', express.static(path.join(__dirname, '../public/plans/assets')));
app.use('/assets', express.static(path.join(__dirname, '../public/bookcall/assets')));
app.use(express.static(path.join(__dirname, '../public')));


// ✅ Embedded entry: Shopify Admin abre /apps/<handle>
// Aquí NO rompas iframe. Solo manda al conector embebido con shop+host.
app.get(/^\/apps\/[^/]+\/?.*$/, shopifyCSP, (req, res) => {
  const shop = String(req.query.shop || '').trim();
  const host = String(req.query.host || '').trim();

  if (!shop) {
    return res.status(400).type('text/plain').send('Missing shop');
  }

  const target = new URL('/connector/interface', APP_URL);
  target.searchParams.set('shop', shop);
  if (host) target.searchParams.set('host', host);

  return res.redirect(302, target.toString());
});


/* =========================
 * OAuth Google (login simple)
 * ========================= */
app.get('/auth/google/login', passport.authenticate('google', { scope: ['profile', 'email'] }));
app.get('/auth/google/login/callback', (req, res, next) => {
  passport.authenticate('google', { failureRedirect: '/login' }, async (err, user, info) => {
    try {
      if (err) return next(err);
      if (!user) return res.redirect('/login');

      // ✅ IMPORTANTE: como usamos custom callback, debemos hacer login manual
      req.logIn(user, async (loginErr) => {
        if (loginErr) return next(loginErr);

        // ✅ Enviar email SOLO si fue creación nueva por Google
        const isNewGoogleUser =
          (info && (info.isNewUser === true || info.newUser === true)) ||
          user?._isNewUser === true;

        if (isNewGoogleUser) {
          // Fire & forget para NO frenar la redirección
          Promise.resolve()
            .then(() =>
              sendWelcomeEmail({
                toEmail: user.email,
                name: user.name || user.email?.split('@')?.[0] || 'Usuario',
              })
            )
            .catch((e) => console.error('✉️  Welcome email (Google) falló:', e?.message || e));
        }

        const destino = user.onboardingComplete ? '/dashboard' : '/onboarding';
        return res.redirect(destino);
      });
    } catch (e) {
      return next(e);
    }
  })(req, res, next);
});


/* =========================
 * Debug / Diagnóstico
 * ========================= */
const PUBLIC_DIR = path.join(__dirname, '../public');

app.get('/__ping', (_req, res) => {
  const successExists = fs.existsSync(path.join(PUBLIC_DIR, 'plans', 'success.html'));
  const cancelExists = fs.existsSync(path.join(PUBLIC_DIR, 'plans', 'cancel.html'));
  res.json({
    ok: true,
    cwd: __dirname,
    successHtml: successExists,
    cancelHtml: cancelExists,
    publicDir: PUBLIC_DIR,
  });
});

app.get('/__ls-public', (_req, res) => {
  const dir = path.join(PUBLIC_DIR, 'plans');
  fs.readdir(dir, (err, files) => {
    res.json({ dir, exists: !err, files: files || [], error: err?.message });
  });
});

// --- LOGOUT unificado --- //
function destroySessionAndReply(req, res, { redirectTo } = {}) {
  req.session?.destroy?.(() => {
    res.clearCookie('connect.sid', {
      path: '/',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
    });
    if (redirectTo) {
      return res.redirect(303, redirectTo);
    }
    return res.json({ ok: true });
  });
}

app.post('/api/logout', (req, res, next) => {
  req.logout?.((err) => {
    if (err) return next(err);
    destroySessionAndReply(req, res);
  });
});

app.get('/logout', (req, res, next) => {
  req.logout?.((err) => {
    if (err) return next(err);
    destroySessionAndReply(req, res, { redirectTo: '/login' });
  });
});

/* =========================
 * Rutas éxito/cancel Stripe
 * ========================= */
app.get('/plans/success', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'plans', 'success.html'));
});
app.get('/plans/cancel', (_req, res) => {
  const candidate = path.join(PUBLIC_DIR, 'plans', 'cancel.html');
  if (fs.existsSync(candidate)) return res.sendFile(candidate);
  res.redirect('/plans');
});

app.use('/api', (req, res) => {
  res.status(404).json({ ok:false, error:'Not Found', path: req.originalUrl });
});

/* =========================
 * 404 y errores
 * ========================= */
app.use((req, res) => res.status(404).send('Página no encontrada'));
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal Server Error' });
});

app.listen(PORT, () => {
  console.log(`✅ Servidor corriendo en http://localhost:${PORT}`);
});
