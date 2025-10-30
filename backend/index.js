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
const nodemailer = require('nodemailer');
const helmet = require('helmet');
const compression = require('compression');

require('./auth');

const User = require('./models/User');

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
const auditsRoutes = require('./routes/audits');
const stripeRouter = require('./routes/stripe');
const facturapiTest = require('./routes/facturapiTest');
const billingRoutes = require('./routes/billing');
const connector = require('./routes/shopifyConnector');
const webhookRoutes = require('./routes/shopifyConnector/webhooks');

// Meta
const metaInsightsRoutes = require('./routes/metaInsights');
const metaAccountsRoutes = require('./routes/metaAccounts');
const metaTable = require('./routes/metaTable');

const app = express();
const PORT = process.env.PORT || 3000;

/* =========================
 * Seguridad y performance
 * ========================= */
app.disable('x-powered-by');
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);
app.use(compression());

/* =========================
 * CORS
 * ========================= */
const ALLOWED_ORIGINS = [
  'https://ai.adnova.digital',
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
 * Parsers especiales (antes de JSON global)
 * ========================= */
// 1) Webhooks Shopify (raw)
app.use(
  '/connector/webhooks',
  express.raw({ type: 'application/json' }),
  webhookRoutes
);

// 2) Stripe: RAW **solo** en /api/stripe/webhook; JSON normal para el resto
app.use('/api/stripe', (req, res, next) => {
  if (req.path === '/webhook') {
    return express.raw({ type: 'application/json' })(req, res, next);
  }
  return express.json()(req, res, next);
});

/* =========================
 * Parsers globales
 * ========================= */
app.use(express.urlencoded({ extended: true }));

/* =========================
 * CSP público
 * ========================= */
app.use(publicCSP);

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
 * Sesión y Passport
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

app.get('/agendar', (_req, res) => {
  const file = path.join(__dirname, '../public/agendar.html');
  let html = fs.readFileSync(file, 'utf8');

  // Inyecta el enlace del booking (Appointment Schedule)
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

app.use(express.json({ limit: '1mb' }));
app.use('/api/bookcall', require('./routes/bookcall'));

/* =========================
 * Rutas de autenticación e integraciones
 * ========================= */
app.use('/auth/google', googleConnect);
app.use('/auth/meta', metaAuthRoutes);
app.use('/', privacyRoutes);

// Google Analytics (GA4)
app.use('/api/google/analytics', gaRouter);

// Google Ads (insights) — protegido por sesión
app.use('/api/google/ads/insights', sessionGuard, googleAdsInsightsRouter);
// Alias: /api/google/ads → /api/google/ads/insights
app.use(
  '/api/google/ads',
  sessionGuard,
  (req, _res, next) => {
    req.url = `/insights${req.url === '/' ? '' : req.url}`;
    next();
  },
  googleAdsInsightsRouter
);

// Stripe / Facturapi / Billing
app.use('/api/stripe', stripeRouter);
app.use('/api/facturapi-test', facturapiTest);
app.use('/api/facturapi', require('./routes/facturapi'));
app.use('/api/billing', billingRoutes);

// Meta Ads
app.use('/api/meta/insights', sessionGuard, metaInsightsRoutes);
app.use('/api/meta/accounts', sessionGuard, metaAccountsRoutes);
app.use('/api/meta', metaTable);

// Shopify
const verifyShopifyToken = require('../middlewares/verifyShopifyToken');
app.use('/connector', connector); // rutas del conector (incluye /webhooks arriba)
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

/* =========================
 * Auth básica (email/pass)
 * ========================= */
const FROM = process.env.SMTP_FROM || process.env.SMTP_USER;
let transporter = null;

const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;

const HAS_SMTP = !!(SMTP_HOST && SMTP_USER && SMTP_PASS);

if (HAS_SMTP) {
  const secure = SMTP_PORT === 465; // 465 SSL, 587 STARTTLS
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    pool: true,
    maxConnections: 5,
    maxMessages: 100,
    tls: {
      rejectUnauthorized: true,
    },
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    socketTimeout: 30_000,
  });

  transporter.verify()
    .then(() => console.log(`✅ SMTP verificado: ${SMTP_HOST}:${SMTP_PORT} como ${SMTP_USER}`))
    .catch((err) => console.error('❌ SMTP verify() falló:', err?.message || err));
} else {
  console.warn('✉️  SMTP no configurado. Se omite verificación/envío de correo.');
}

app.post('/api/register', async (req, res) => {
  try {
    let { email, password } = req.body || {};
    if (!email || !password) {
      return res
        .status(400)
        .json({ success: false, message: 'Correo y contraseña son requeridos' });
    }

    email = String(email).trim().toLowerCase();

    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRe.test(email)) {
      return res
        .status(400)
        .json({ success: false, message: 'Correo inválido' });
    }
    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'La contraseña debe tener al menos 8 caracteres',
      });
    }

    const exists = await User.findOne({ email });
    if (exists) {
      return res
        .status(409)
        .json({ success: false, message: 'El email ya está registrado' });
    }

    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({ email, password: hashed });

    (async () => {
      try {
        let html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<title>Bienvenido a Adnova AI</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>@media screen and (max-width:600px){.card{width:100%!important}.btn{display:block!important;width:100%!important}}</style>
</head>
<body style="margin:0;padding:0;background:#0d081c;color:#fff;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td align="center" style="padding:48px 10px">
<table role="presentation" cellpadding="0" cellspacing="0" width="560" class="card" style="max-width:560px;background:#151026;border-radius:16px;box-shadow:0 0 20px #6d3dfc;">
<tr><td style="padding:0 50px 40px">
<h1 style="margin:0 0 24px;font-size:28px;color:#6d3dfc;font-weight:700">¡Bienvenido a Adnova AI!</h1>
<p style="margin:0 0 20px;font-size:16px;line-height:24px">Tu cuenta se creó con éxito.</p>
<p style="margin:0 0 28px;font-size:16px;line-height:24px">Haz clic en el botón para iniciar sesión:</p>
<table role="presentation" align="center" cellpadding="0" cellspacing="0"><tr><td>
<a href="https://ai.adnova.digital/login" class="btn" style="background:#6d3dfc;border-radius:8px;padding:14px 36px;font-size:16px;font-weight:600;color:#fff;text-decoration:none;display:inline-block;">Iniciar sesión</a>
</td></tr></table>
<p style="margin:32px 0 0;font-size:14px;line-height:20px;color:#c4c4c4">Si no solicitaste esta cuenta, ignora este correo.</p>
</td></tr>
<tr><td style="background:#100c1e;padding:18px 40px;border-radius:0 0 16px 16px;text-align:center;font-size:12px;line-height:18px;color:#777">© {{YEAR}} Adnova AI · <a href="https://ai.adnova.digital/politica.html" style="color:#777;text-decoration:underline">Política de privacidad</a></td></tr>
</table></td></tr></table></body></html>`;
        html = html.replace('{{YEAR}}', new Date().getFullYear());

        if (transporter) {
          await transporter.sendMail({
            from: `"Adnova AI" <${FROM}>`,
            to: email,
            subject: 'Activa tu cuenta de Adnova AI',
            text: 'Tu cuenta se creó con éxito. Ingresa en https://ai.adnova.digital/login',
            html,
            replyTo: FROM,
            headers: {
              'X-Entity-Ref-ID': crypto.randomUUID(),
            },
          });
        } else {
          console.warn('✉️  No hay transporter inicializado (SMTP no configurado).');
        }
      } catch (mailErr) {
        console.error('✉️  SMTP fallo (registro OK):', mailErr?.message || mailErr);
      }
    })();

    return res.status(201).json({
      success: true,
      message: 'Usuario registrado',
      confirmUrl: `/confirmation.html?email=${encodeURIComponent(user.email)}`,
    });
  } catch (err) {
    if (err && err.code === 11000) {
      return res
        .status(409)
        .json({ success: false, message: 'El email ya está registrado' });
    }
    console.error('❌ Error al registrar usuario:', err);
    return res
      .status(500)
      .json({ success: false, message: 'Error interno al registrar' });
  }
});

app.post('/api/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email)
    return res
      .status(400)
      .json({ success: false, message: 'Correo requerido' });

  try {
    const user = await User.findOne({ email });
    if (!user) return res.json({ success: true });

    const token = crypto.randomBytes(32).toString('hex');
    const expira = new Date(Date.now() + 60 * 60 * 1000);

    user.resetPasswordToken = token;
    user.resetPasswordExpires = expira;
    await user.save();

    const resetUrl = `https://ai.adnova.digital/reset-password.html?token=${token}`;

    const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<title>Recupera tu contraseña - Adnova AI</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>@media screen and (max-width:600px){.card{width:100%!important}.btn{display:block!important;width:100%!important}}</style>
</head>
<body style="margin:0;padding:0;background:#0d081c;color:#fff;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td align="center" style="padding:48px 10px">
<table role="presentation" cellpadding="0" cellspacing="0" width="560" class="card" style="max-width:560px;background:#151026;border-radius:16px;box-shadow:0 0 20px #6d3dfc;">
<tr><td style="padding:0 50px 40px">
<h1 style="margin:0 0 24px;font-size:26px;color:#6d3dfc;font-weight:700">Recupera tu cuenta</h1>
<p style="margin:0 0 16px;line-height:24px">Hiciste una solicitud para restablecer tu contraseña.</p>
<p style="margin:0 0 28px;line-height:24px">Haz clic en el botón para crear una nueva:</p>
<table role="presentation" align="center" cellpadding="0" cellspacing="0"><tr><td>
  <a href="${resetUrl}" class="btn" style="background:#6d3dfc;border-radius:8px;padding:14px 36px;font-size:16px;font-weight:600;color:#fff;text-decoration:none;display:inline-block;">Restablecer contraseña</a>
</td></tr></table>
<p style="margin:24px 0 0;font-size:14px;color:#c4c4c4">Si no solicitaste este cambio, ignora este correo.</p>
</td></tr>
<tr><td style="background:#100c1e;padding:18px 40px;border-radius:0 0 16px 16px;text-align:center;font-size:12px;line-height:18px;color:#777">© ${new Date().getFullYear()} Adnova AI</td></tr>
</table></td></tr></table>
</body></html>`;

    if (transporter) {
      await transporter.sendMail({
        from: `"Adnova AI" <${FROM}>`,
        to: user.email,
        subject: 'Restablece tu contraseña · Adnova AI',
        text: `Para restablecer tu contraseña visita: ${resetUrl}`,
        html,
        replyTo: FROM,
        headers: { 'X-Entity-Ref-ID': crypto.randomUUID() },
      });
    } else {
      console.warn('✉️  No hay transporter inicializado (SMTP no configurado).');
    }

    return res.json({ success: true });
  } catch (err) {
    console.error('❌ forgot-password:', err);
    res.status(500).json({ success: false, message: 'Error de servidor' });
  }
});

app.post('/api/reset-password', async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) {
    return res
      .status(400)
      .json({ success: false, message: 'Datos incompletos' });
  }
  try {
    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: new Date() },
    });
    if (!user)
      return res
        .status(400)
        .json({ success: false, message: 'Token inválido o expirado' });
    user.password = await bcrypt.hash(password, 10);
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();
    res.json({ success: true });
  } catch (err) {
    console.error('❌ reset-password:', err);
    res.status(500).json({ success: false, message: 'Error de servidor' });
  }
});

// Verifica conexión SMTP en caliente
app.get('/__mail/verify', async (_req, res) => {
  try {
    if (!transporter) return res.status(500).json({ ok:false, error:'transporter no inicializado' });
    await transporter.verify();
    res.json({ ok:true, from: FROM });
  } catch (e) {
    console.error('[_MAIL_VERIFY] ', e);
    res.status(500).json({ ok:false, error: e?.message || e });
  }
});

// Envía un correo de prueba al SMTP_USER
app.get('/__mail/test', async (_req, res) => {
  try {
    if (!transporter) return res.status(500).json({ ok:false, error:'transporter no inicializado' });
    const info = await transporter.sendMail({
      from: `"Adnova AI" <${FROM}>`,
      to: process.env.SMTP_USER,
      subject: 'Prueba SMTP · Adnova AI',
      text: 'Este es un correo de prueba desde /__mail/test',
    });
    res.json({ ok:true, messageId: info?.messageId });
  } catch (e) {
    console.error('[_MAIL_TEST] ', e);
    res.status(500).json({ ok:false, error: e?.message || e });
  }
});

app.post('/api/login', async (req, res, next) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res
      .status(400)
      .json({ success: false, message: 'Correo y contraseña son requeridos' });
  }
  try {
    const user = await User.findOne({ email });
    if (!user)
      return res
        .status(401)
        .json({ success: false, message: 'Usuario no encontrado' });

    const match = await bcrypt.compare(password, user.password);
    if (!match)
      return res
        .status(401)
        .json({ success: false, message: 'Contraseña incorrecta' });

    req.login(user, (err) => {
      if (err) return next(err);
      req.session.userId = user._id;
      if (user.onboardingComplete && user.shopifyConnected) {
        return res.status(200).json({ success: true, redirect: '/dashboard' });
      }
      return res
        .status(200)
        .json({ success: true, redirect: '/onboarding' });
    });
  } catch (err) {
    console.error('❌ Error al hacer login:', err);
    res.status(500).json({ success: false, message: 'Error del servidor' });
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

// Alias simple para /api/me (lo usa /plans/success)
app.get('/api/me', async (req, res) => {
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
        email: u.email
      }
    });
  } catch (e) {
    return res.status(401).json({ authenticated: false });
  }
});


/* =========================
 * Otras APIs internas
 * ========================= */
app.use('/api', userRoutes);
/* ✅ Protegidas */
app.use('/api/audits', sessionGuard, auditsRoutes);
app.use('/api/audit', sessionGuard, auditsRoutes);

app.post('/api/audit/start', sessionGuard, (req, res) =>
  res.redirect(307, '/api/audits/run')
);
app.post('/api/audit/google/start', sessionGuard, (req, res) =>
  res.redirect(307, '/api/audits/run')
);
app.post('/api/audit/meta/start', sessionGuard, (req, res) =>
  res.redirect(307, '/api/audits/run')
);
app.post('/api/audit/shopify/start', sessionGuard, (req, res) =>
  res.redirect(307, '/api/audits/run')
);

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

/* =========================
 * Embebido Shopify
 * ========================= */
app.get('/connector/interface', shopifyCSP, (req, res) => {
  const { shop, host } = req.query;
  if (!shop || !host)
    return res.status(400).send("Faltan parámetros 'shop' o 'host'");
  res.sendFile(path.join(__dirname, '../public/connector/interface.html'));
});

app.get(/^\/apps\/[^/]+\/?.*$/, shopifyCSP, (req, res) => {
  const { shop, host } = req.query;
  const redirectUrl = new URL('/connector/interface', `https://${req.headers.host}`);
  if (shop) redirectUrl.searchParams.set('shop', shop);
  if (host) redirectUrl.searchParams.set('host', host);
  return res.redirect(redirectUrl.toString());
});

/* =========================
 * OAuth Google (login simple)
 * ========================= */
app.get('/auth/google/login', passport.authenticate('google', { scope: ['profile', 'email'] }));
app.get(
  '/auth/google/login/callback',
  passport.authenticate('google', { failureRedirect: '/' }),
  (req, res) => {
    const destino = req.user.onboardingComplete ? '/dashboard' : '/onboarding';
    res.redirect(destino);
  }
);

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

// --- LOGOUT unificado (POST para fetch desde el front y GET para navegación) ---

function destroySessionAndReply(req, res, { redirectTo } = {}) {
  req.session?.destroy?.(() => {
    // borra la cookie de sesión (ajusta el nombre si lo cambiaste en session())
    res.clearCookie('connect.sid', {
      path: '/',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
    });
    if (redirectTo) {
      // sin JS inline (CSP friendly)
      return res.redirect(303, redirectTo);
    }
    return res.json({ ok: true });
  });
}

// Para botones que hacen fetch: POST /api/logout
app.post('/api/logout', (req, res, next) => {
  req.logout?.((err) => {
    if (err) return next(err);
    destroySessionAndReply(req, res);
  });
});

// Para navegación directa (links): GET /logout
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
