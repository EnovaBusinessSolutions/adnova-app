// backend/index.js
require('dotenv').config();

const express    = require('express');
const session    = require('express-session');
const passport   = require('passport');
const mongoose   = require('mongoose');
const cors       = require('cors');
const path       = require('path');
const fs         = require('fs');
const bcrypt     = require('bcrypt');
const bodyParser = require('body-parser');
const crypto     = require('crypto');

require('./auth'); // configuración de Passport (GoogleStrategy, serialize/deserialize)

const User            = require('./models/User');
const googleConnect   = require('./routes/googleConnect');
const googleAnalytics = require('./routes/googleAnalytics');
const metaAuthRoutes  = require('./routes/meta');
const privacyRoutes   = require('./routes/privacyRoutes');
const userRoutes      = require('./routes/user');
const mockShopify     = require('./routes/mockShopify');
const shopifyRoutes   = require('./routes/shopify');
const verifyShopifyToken = require('../middlewares/verifyShopifyToken');

const app   = express();
const PORT  = process.env.PORT || 3000;

/* ===== Conexión a MongoDB ===== */
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('✅ Conectado a MongoDB Atlas'))
.catch(err => console.error('❌ Error al conectar con MongoDB:', err));

/* ===== Middlewares globales ===== */
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, '../public')));

// Necesario para cookies “Secure” detrás de Render u otro proxy
app.set('trust proxy', 1);

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      sameSite: 'none',
      secure: true,
    },
  })
);

app.use(passport.initialize());
app.use(passport.session());

/* ===== Helpers de autenticación ===== */
function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  // Si no está autenticado, al login (register.html)
  return res.redirect('/');
}

function ensureNotOnboarded(req, res, next) {
  if (req.isAuthenticated() && !req.user.onboardingComplete) {
    return next();
  }
  // Si ya completó onboarding, redirige al dashboard
  return res.redirect('/dashboard');
}

/* ===== Rutas públicas ===== */

// 1) Página raíz: mostrar register.html (login + registro)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/register.html'));
});

/* ===== Registro ===== */
app.post('/api/register', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res
      .status(400)
      .json({ success: false, message: 'Correo y contraseña son requeridos' });
  }

  try {
    const hashed = await bcrypt.hash(password, 10);
    await User.create({ email, password: hashed });
    return res
      .status(201)
      .json({ success: true, message: 'Usuario registrado con éxito' });
  } catch (err) {
    console.error('❌ Error al registrar usuario:', err.stack || err);
    return res
      .status(400)
      .json({ success: false, message: 'No se pudo registrar el usuario' });
  }
});

/* ===== Login ===== */
app.post('/api/login', async (req, res, next) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res
      .status(400)
      .json({ success: false, message: 'Correo y contraseña son requeridos' });
  }

  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res
        .status(401)
        .json({ success: false, message: 'Usuario no encontrado' });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res
        .status(401)
        .json({ success: false, message: 'Contraseña incorrecta' });
    }

    req.login(user, (err) => {
      if (err) return next(err);
      // Guardar userId en sesión por si se necesita en otros lugares
      req.session.userId = user._id;
      // Devuelve JSON con ruta a la que redirigir en frontend
      return res.status(200).json({
        success: true,
        redirect: user.onboardingComplete ? '/dashboard' : '/onboarding',
      });
    });
  } catch (err) {
    console.error('❌ Error al hacer login:', err.stack || err);
    return res.status(500).json({ success: false, message: 'Error del servidor' });
  }
});

/* ===== Onboarding (GET /onboarding) ===== */
app.get('/onboarding', ensureNotOnboarded, (req, res) => {
  const filePath = path.join(__dirname, '../public/onboarding.html');
  fs.readFile(filePath, 'utf8', (err, html) => {
    if (err) {
      console.error('❌ Error al leer onboarding.html:', err.stack || err);
      return res.status(500).send('Error al cargar la página de onboarding.');
    }

    // Reemplazar USER_ID_REAL e INSTALL_LINK_PLACEHOLDER dentro del HTML
    const updatedHtml = html
      .replace('USER_ID_REAL', req.user._id.toString())
      .replace(
        'INSTALL_LINK_PLACEHOLDER',
        process.env.CUSTOM_APP_INSTALL_LINK || ''
      );
    return res.send(updatedHtml);
  });
});

/* ===== Marcar onboarding como completo ===== */
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

    if (!result) {
      console.warn(
        '⚠️ No se encontró el usuario para completar onboarding:',
        req.user._id
      );
      return res
        .status(404)
        .json({ success: false, message: 'Usuario no encontrado' });
    }

    return res.json({ success: true });
  } catch (err) {
    console.error('❌ Error al completar onboarding:', err.stack || err);
    return res.status(500).json({ success: false, message: 'Error del servidor' });
  }
});

/* ===== Verificación de Webhooks Shopify ===== */
app.post(
  '/webhooks',
  express.raw({ type: 'application/json' }),
  (req, res) => {
    const hmac = req.get('X-Shopify-Hmac-Sha256');
    const body = req.body;
    const generatedHash = crypto
      .createHmac('sha256', process.env.SHOPIFY_API_SECRET)
      .update(body, 'utf8')
      .digest('base64');

    if (
      crypto.timingSafeEqual(
        Buffer.from(hmac, 'utf8'),
        Buffer.from(generatedHash, 'utf8')
      )
    ) {
      console.log('✅ Webhook verificado');
      return res.status(200).send('Webhook recibido');
    } else {
      console.warn('⚠️ Webhook NO verificado');
      return res.status(401).send('Firma no válida');
    }
  }
);

/* ===== Rutas externas / integraciones ===== */
app.use('/api/shopify', shopifyRoutes);
app.use('/', privacyRoutes);
app.use('/', googleConnect);
app.use('/', googleAnalytics);
app.use('/auth/meta', metaAuthRoutes);
app.use('/api', userRoutes);
app.use('/api', mockShopify);

/* ===== Dashboard y otras vistas protegidas ===== */
app.get(
  '/dashboard',
  ensureAuthenticated,
  (req, res) => {
    res.sendFile(path.join(__dirname, '../public/dashboard.html'));
  }
);
app.get('/configuracion', (req, res) =>
  res.sendFile(path.join(__dirname, '../public/configuracion.html'))
);
app.get('/audit', (req, res) =>
  res.sendFile(path.join(__dirname, '../public/audit.html'))
);
app.get('/pixel-verifier', (req, res) =>
  res.sendFile(path.join(__dirname, '../public/pixel-verifier.html'))
);

/* ===== Google OAuth ===== */
app.get(
  '/auth/google',
  passport.authenticate('google', {
    scope: [
      'profile',
      'email',
      'https://www.googleapis.com/auth/analytics.readonly',
      'https://www.googleapis.com/auth/adwords',
    ],
  })
);

app.get(
  '/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/' }),
  (req, res) => {
    // Una vez que Google autenticó correctamente,
    // redirige a /dashboard o a /onboarding (sin .html)
    const redirectPath = req.user.onboardingComplete
      ? '/dashboard'
      : '/onboarding';
    return res.redirect(redirectPath);
  }
);

/* ===== Logout ===== */
app.get('/logout', (req, res) => {
  req.logout((err) => {
    if (err) {
      console.error('Error al cerrar sesión:', err);
      return res.redirect('/');
    }
    req.session.destroy(() => {
      res.clearCookie('connect.sid');
      return res.redirect('/');
    });
  });
});

/* ===== Ruta de prueba para Shopify Token ===== */
app.get(
  '/api/test-shopify-token',
  verifyShopifyToken,
  (req, res) => {
    res.json({
      success: true,
      shop: req.shopifySession.dest,
      message: '✅ Token válido y verificado',
    });
  }
);

/* ===== 404 ===== */
app.use((req, res) => res.status(404).send('Página no encontrada'));

/* ===== Server ===== */
app.listen(PORT, () =>
  console.log(`✅ Servidor corriendo en http://localhost:${PORT}`)
);
