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

// Auth strategies
require('./auth');

// Models & routes
const User = require('./models/User');
const googleConnect = require('./routes/googleConnect');
const googleAnalytics = require('./routes/googleAnalytics');
const metaAuthRoutes = require('./routes/meta');
const privacyRoutes = require('./routes/privacyRoutes');
const mockShopify = require('./routes/mockShopify');
const shopifyRoutes = require('./routes/shopify');
const verifyShopifyToken = require('../middlewares/verifyShopifyToken');
const connector = require('./routes/shopifyConnector');
const webhookRoutes = require('./routes/shopifyConnector/webhooks');
const verifySessionToken = require('../middlewares/verifySessionToken');
const secureRoutes = require('./routes/secure');
const dashboardRoute = require('./api/dashboardRoute');
const { publicCSP, shopifyCSP } = require('../middlewares/csp');
const subscribeRouter = require('./routes/subscribe');
const userRoutes = require('./routes/user');
const auditsRoutes = require('./routes/audits'); // <-- NUEVO (unificado)

// Meta endpoints (dashboard)
const metaInsightsRoutes = require('./routes/metaInsights');
const metaAccountsRoutes = require('./routes/metaAccounts');

const app = express();
const PORT = process.env.PORT || 3000;

/* ----------------------------- C O R S ----------------------------- */
app.use(
  cors({
    origin: [
      'https://ai.adnova.digital',
      /\.myshopify\.com$/,
      'https://admin.shopify.com',
      // Dev / Vite / local preview
      'http://localhost:3000',
      'http://localhost:5173',
      'http://127.0.0.1:5173',
    ],
    credentials: true,
  })
);
app.options(/.*/, cors());

/* ------------- Webhooks (raw) ANTES de cualquier body parser -------- */
app.use('/connector/webhooks', express.raw({ type: 'application/json' }), webhookRoutes);

/* ------------------------- Body parsers ---------------------------- */
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

/* ------------------------------ CSP ------------------------------- */
app.use(publicCSP);

/* ----------------------------- Mongo ------------------------------ */
mongoose
  .connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('✅ Conectado a MongoDB Atlas'))
  .catch((err) => console.error('❌ Error al conectar con MongoDB:', err));

/* ------------------------ Sesión / Passport ------------------------ */
app.set('trust proxy', 1);
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      secure: process.env.NODE_ENV === 'production',
      // domain: '.adnova.digital',
    },
  })
);
app.use(passport.initialize());
app.use(passport.session());

/* ------------------------------ Guards ----------------------------- */
function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  return res.redirect('/login');
}
function ensureNotOnboarded(req, res, next) {
  if (!(req.isAuthenticated && req.isAuthenticated())) return res.redirect('/login');
  if (!req.user?.onboardingComplete) return next();
  return res.redirect('/dashboard');
}
function sessionGuard(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  return res.status(401).json({ error: 'No hay sesión' });
}

/* --------- Dashboard (submódulo build Vite con fallback legacy) ---- */
const DASHBOARD_DIST = path.join(__dirname, '../dashboard-src/dist');
const LEGACY_DASH = path.join(__dirname, '../public/dashboard');
const HAS_DASHBOARD_DIST = fs.existsSync(path.join(DASHBOARD_DIST, 'index.html'));

if (HAS_DASHBOARD_DIST) {
  app.use('/assets', express.static(path.join(DASHBOARD_DIST, 'assets'), { immutable: true, maxAge: '1y' }));
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

/* ================== RUTAS DE AUTH / PÚBLICAS (ADELANTADAS) ========= */
app.use('/auth/google', googleConnect);
app.use('/auth/meta', metaAuthRoutes);
app.use('/', privacyRoutes);
app.use('/', googleAnalytics);

/* ------------------------ Home / Login ----------------------------- */
app.get('/', (req, res) => {
  const { shop } = req.query;
  if (shop) return res.redirect(`/connector?shop=${shop}`);
  if (req.isAuthenticated && req.isAuthenticated()) {
    return req.user.onboardingComplete ? res.redirect('/dashboard') : res.redirect('/onboarding');
  }
  return res.sendFile(path.join(__dirname, '../public/landing/index.html'));
});

app.get('/login', (_req, res) => {
  res.sendFile(path.join(__dirname, '../public/login.html'));
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

/* -------------------------- SMTP/Nodemailer ------------------------ */
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: true,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});
transporter.verify((err) => {
  if (err) console.error('❌ SMTP error:', err);
  else console.log('✅ SMTP listo para enviar correo');
});

/* --------------------------- Auth/Usuario -------------------------- */
app.post('/api/register', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Correo y contraseña son requeridos' });
  }
  try {
    const hashed = await bcrypt.hash(password, 10);
    await User.create({ email, password: hashed });

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

    await transporter.sendMail({
      from: process.env.SMTP_FROM,
      to: email,
      subject: 'Activa tu cuenta de Adnova AI',
      text: 'Tu cuenta se creó con éxito. Ingresa en https://ai.adnova.digital/login',
      html,
    });

    res.status(201).json({ success: true, message: 'Usuario registrado y correo enviado' });
  } catch (err) {
    console.error('❌ Error al registrar usuario:', err);
    res.status(400).json({ success: false, message: 'No se pudo registrar el usuario' });
  }
});

app.post('/api/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ success: false, message: 'Correo requerido' });

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
<html lang="es"><head><meta charset="utf-8"><title>Recupera tu contraseña - Adnova AI</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0;padding:0;background:#0a0a12;color:#F4F2FF;font-family:'Inter',Arial,Helvetica,sans-serif;font-size:16px;line-height:1.6}
.card{max-width:410px;background:rgba(16,14,26,.98);border-radius:22px;box-shadow:0 0 32px 0 #a96bff2d;margin:0 auto;padding:0}
.card-content{padding:0 38px 38px 38px}h1{margin:0 0 24px 0;font-size:2rem;font-weight:800;color:#A96BFF;letter-spacing:-1px;text-align:center}
p{margin:0 0 18px 0;color:#F4F2FF;font-size:1.04rem;line-height:1.6;text-align:center}
.btn{background:linear-gradient(90deg,#A96BFF 0%,#9333ea 100%);border-radius:10px;padding:.9rem 2.6rem;font-size:1.1rem;font-weight:700;color:#fff!important;text-decoration:none;display:inline-block;margin:0 auto;box-shadow:0 2px 8px #A96BFF20;border:none;transition:opacity .16s}
.btn:hover{opacity:.93}.footer{background:#18132a;padding:18px 36px 15px 36px;border-radius:0 0 22px 22px;text-align:center;font-size:.97rem;color:#B6A7E8}
.footer a{color:#A96BFF;text-decoration:underline;font-weight:600;transition:color .17s}.footer a:hover{color:#fff}
@media screen and (max-width:600px){.card{width:97vw!important;max-width:98vw!important}.card-content{padding:0 1.1rem 1.7rem 1.1rem}h1{font-size:1.25rem}.footer{font-size:.89rem;padding:1.1rem .3rem 1rem .3rem}.btn{width:100%;padding:.85rem 0}}</style>
</head>
<body>...${''}</body></html>`;

    await transporter.sendMail({
      from: process.env.SMTP_FROM,
      to: user.email,
      subject: 'Restablece tu contraseña · Adnova AI',
      text: `Haz clic aquí para cambiar tu contraseña: ${resetUrl}`,
      html,
    });

    res.json({ success: true });
  } catch (err) {
    console.error('❌ forgot-password:', err);
    res.status(500).json({ success: false, message: 'Error de servidor' });
  }
});

app.post('/api/reset-password', async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) {
    return res.status(400).json({ success: false, message: 'Datos incompletos' });
  }
  try {
    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: new Date() },
    });
    if (!user) return res.status(400).json({ success: false, message: 'Token inválido o expirado' });
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

app.post('/api/login', async (req, res, next) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Correo y contraseña son requeridos' });
  }
  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ success: false, message: 'Usuario no encontrado' });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ success: false, message: 'Contraseña incorrecta' });

    req.login(user, (err) => {
      if (err) return next(err);
      req.session.userId = user._id;
      if (user.onboardingComplete && user.shopifyConnected) {
        return res.status(200).json({ success: true, redirect: '/dashboard' });
      }
      return res.status(200).json({ success: true, redirect: '/onboarding' });
    });
  } catch (err) {
    console.error('❌ Error al hacer login:', err.stack || err);
    res.status(500).json({ success: false, message: 'Error del servidor' });
  }
});

/* --------------------------- Onboarding ---------------------------- */
app.get('/onboarding', ensureNotOnboarded, async (req, res) => {
  const filePath = path.join(__dirname, '../public/onboarding.html');
  const user = await User.findById(req.user._id).lean();
  const alreadyConnectedShopify = user.shopifyConnected || false;

  fs.readFile(filePath, 'utf8', (err, html) => {
    if (err) {
      console.error('❌ Error al leer onboarding.html:', err.stack || err);
      return res.status(500).send('Error al cargar la página de onboarding.');
    }
    let updatedHtml = html.replace('USER_ID_REAL', req.user._id.toString());
    updatedHtml = updatedHtml.replace('SHOPIFY_CONNECTED_FLAG', alreadyConnectedShopify ? 'true' : 'false');
    updatedHtml = updatedHtml.replace('GOOGLE_CONNECTED_FLAG', user.googleConnected ? 'true' : 'false');
    res.send(updatedHtml);
  });
});

app.post('/api/complete-onboarding', async (req, res) => {
  try {
    if (!req.isAuthenticated()) return res.status(401).json({ success: false, message: 'No autenticado' });
    const result = await User.findByIdAndUpdate(req.user._id, { onboardingComplete: true });
    if (!result) return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
    res.json({ success: true });
  } catch (err) {
    console.error('❌ Error al completar onboarding:', err.stack || err);
    res.status(500).json({ success: false, message: 'Error del servidor' });
  }
});

/* ------------------------------ APIs ------------------------------- */
// SIEMPRE leer el usuario fresco de DB para evitar flags desactualizados
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

// Rutas públicas / auth adicionales
app.use('/api/shopify', shopifyRoutes);
app.use('/api', mockShopify);
app.use('/api', userRoutes);

// --- Auditorías unificadas ---
app.use('/api/audits', sessionGuard, auditsRoutes); // ✅ protegido
app.use('/api/audit', sessionGuard, auditsRoutes);  // ✅ compat legacy (front viejo)

// Compatibilidad adicional con /api/audit/*start (onboarding3.js legacy)
app.post('/api/audit/start', sessionGuard, (req, res) => res.redirect(307, '/api/audits/run'));
app.post('/api/audit/google/start', sessionGuard, (req, res) => res.redirect(307, '/api/audits/run'));
app.post('/api/audit/meta/start', sessionGuard, (req, res) => res.redirect(307, '/api/audits/run'));
app.post('/api/audit/shopify/start', sessionGuard, (req, res) => res.redirect(307, '/api/audits/run'));

// (si aún necesitas api/auditRoute para otras cosas, puede quedar montado también)
app.use('/api/secure', verifySessionToken, secureRoutes);
app.use('/api/dashboard', dashboardRoute);
app.use('/api/shopConnection', require('./routes/shopConnection'));
app.use('/api', subscribeRouter);
app.use('/api', require('./routes/objectives'));

// Google Ads insights — PROTEGIDO POR SESIÓN
const googleAdsInsightsRouter = require('./routes/googleAdsInsights');
app.use('/api/google/ads/insights', sessionGuard, googleAdsInsightsRouter);
app.use('/api/google/ads', sessionGuard, (req, _res, next) => {
  req.url = `/insights${req.url === '/' ? '' : req.url}`;
  next();
}, googleAdsInsightsRouter);

// Meta endpoints consumidos por dashboard
app.use('/api/meta/insights', sessionGuard, metaInsightsRoutes);
app.use('/api/meta/accounts', sessionGuard, metaAccountsRoutes);

/* ------------------------- OAuth Google (opcional) ------------------ */
app.get('/auth/google/login',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);
app.get('/auth/google/login/callback',
  passport.authenticate('google', { failureRedirect: '/' }),
  (req, res) => {
    const destino = req.user.onboardingComplete ? '/dashboard' : '/onboarding';
    res.redirect(destino);
  }
);

/* -------------------- Static público (sitio) ----------------------- */
app.use('/assets', express.static(path.join(__dirname, '../public/landing/assets')));
app.use('/assets', express.static(path.join(__dirname, '../public/support/assets')));
app.use('/assets', express.static(path.join(__dirname, '../public/plans/assets')));
app.use(express.static(path.join(__dirname, '../public')));

/* --------------------- Rutas específicas --------------------------- */
app.get('/connector/interface', shopifyCSP, (req, res) => {
  const { shop, host } = req.query;
  if (!shop || !host) return res.status(400).send("Faltan parámetros 'shop' o 'host'");
  res.sendFile(path.join(__dirname, '../public/connector/interface.html'));
});

/* ------------------------- Shopify app proxy ----------------------- */
app.get(/^\/apps\/[^/]+\/?.*$/, shopifyCSP, (req, res) => {
  const { shop, host } = req.query;
  const redirectUrl = new URL('/connector/interface', `https://${req.headers.host}`);
  if (shop) redirectUrl.searchParams.set('shop', shop);
  if (host) redirectUrl.searchParams.set('host', host);
  return res.redirect(redirectUrl.toString());
});

/* ----------------------------- Logout ------------------------------ */
app.get('/logout', (req, res) => {
  req.logout((err) => {
    if (err) {
      console.error('Error al cerrar sesión:', err);
      return res.send(`
        <script>
          localStorage.removeItem('sessionToken');
          sessionStorage.removeItem('sessionToken');
          window.location.href = '/';
        </script>
      `);
    }
    req.session.destroy(() => {
      res.clearCookie('connect.sid', { path: '/' });
      return res.send(`
        <script>
          localStorage.removeItem('sessionToken');
          sessionStorage.removeItem('sessionToken');
          window.location.href = '/';
        </script>
      `);
    });
  });
});

/* ------------------------ 404 & errores ---------------------------- */
app.use((req, res) => res.status(404).send('Página no encontrada'));
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal Server Error' });
});

/* ----------------------------- Start ------------------------------- */
app.listen(PORT, () => {
  console.log(`✅ Servidor corriendo en http://localhost:${PORT}`);
});
