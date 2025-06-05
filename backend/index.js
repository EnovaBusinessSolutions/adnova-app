// index.js (SIN CAMBIOS)
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
const bodyParser = require('body-parser');

require('./auth');
const User = require('./models/User');

const googleConnect = require('./routes/googleConnect');
const googleAnalytics = require('./routes/googleAnalytics');
const metaAuthRoutes = require('./routes/meta');
const privacyRoutes = require('./routes/privacyRoutes');
const userRoutes = require('./routes/user');
const mockShopify = require('./routes/mockShopify');
const shopifyRoutes = require('./routes/shopify');
const verifyShopifyToken = require('../middlewares/verifyShopifyToken');

const app = express();
const PORT = process.env.PORT || 3000;

mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
  .then(() => console.log('✅ Conectado a MongoDB Atlas'))
  .catch(err => console.error('❌ Error al conectar con MongoDB:', err));

// +++ MIDDLEWARES +++
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, '../public')));

app.set('trust proxy', 1);
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    secure: process.env.NODE_ENV === 'production'
  }
}));

app.use(passport.initialize());
app.use(passport.session());

// +++ FUNCIONES DE CONTROL DE ACCESO +++
function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.redirect('/');
}

function ensureNotOnboarded(req, res, next) {
  if (req.isAuthenticated() && !req.user.onboardingComplete) return next();
  res.redirect('/dashboard');
}

// +++ RUTAS +++

// Página de inicio (login)
app.get('/', (req, res) =>
  res.sendFile(path.join(__dirname, '../public/index.html'))
);

// Registro de usuario
app.post('/api/register', async (req, res) => {
  // … contenido omitido para brevedad …
});

// Login de usuario
app.post('/api/login', async (req, res, next) => {
  // … contenido omitido para brevedad …
});

// Onboarding (solo usuarios autenticados que aún no completaron onboarding)
app.get("/onboarding", ensureNotOnboarded, async (req, res) => {
  const filePath = path.join(__dirname, "../public/onboarding.html");

  // 1) Buscamos en BD para saber si ya tenía shopifyConnected = true
  const user = await User.findById(req.user._id).lean();
  const alreadyConnectedShopify = user.shopifyConnected || false;

  fs.readFile(filePath, "utf8", (err, html) => {
    if (err) {
      console.error("❌ Error al leer onboarding.html:", err);
      return res.status(500).send("Error al cargar la página de onboarding.");
    }

    let updatedHtml = html.replace("USER_ID_REAL", req.user._id.toString());
    updatedHtml = updatedHtml.replace(
      "SHOPIFY_CONNECTED_FLAG",
      alreadyConnectedShopify ? "true" : "false"
    );

    res.send(updatedHtml);
  });
});

// Finalizar onboarding
app.post('/api/complete-onboarding', async (req, res) => {
  // … contenido omitido para brevedad …
});

// ++++++++++++++++++++++++++++++
// RUTA NUEVA: /api/session
// Devuelve si hay sesión activa y datos mínimos del usuario
// ++++++++++++++++++++++++++++++
app.get('/api/session', (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ authenticated: false });
  }
  return res.json({
    authenticated: true,
    user: {
      _id: req.user._id,
      email: req.user.email,
      onboardingComplete: req.user.onboardingComplete,
      googleConnected: req.user.googleConnected,
      metaConnected: req.user.metaConnected,
      shopifyConnected: req.user.shopifyConnected
    }
  });
});

// Rutas externas y de API
app.use('/api/shopify', shopifyRoutes);
app.use('/', privacyRoutes);
app.use('/', googleConnect);
app.use('/', googleAnalytics);
app.use('/auth/meta', metaAuthRoutes);
app.use('/api', userRoutes);
app.use('/api', mockShopify);

// Dashboard (solo para usuarios autenticados)
app.get('/dashboard', ensureAuthenticated, (r, s) => {
  s.sendFile(path.join(__dirname, '../public/dashboard.html'));
});
app.get('/configuracion', (r, s) =>
  s.sendFile(path.join(__dirname, '../public/configuracion.html'))
);
app.get('/pixel-verifier', (r, s) =>
  s.sendFile(path.join(__dirname, '../public/pixel-verifier.html'))
);

// Google OAuth
app.get('/auth/google',
  passport.authenticate('google', {
    scope: [
      'profile',
      'email',
      'https://www.googleapis.com/auth/analytics.readonly',
      'https://www.googleapis.com/auth/adwords'
    ]
  })
);
app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/' }),
  (req, res) => {
    const redirectPath = req.user.onboardingComplete ? '/dashboard' : '/onboarding';
    res.redirect(redirectPath);
  }
);

// Logout
app.get('/logout', (req, res) => {
  req.logout(err => {
    if (err) {
      console.error('Error al cerrar sesión:', err);
      return res.redirect('/');
    }
    req.session.destroy(() => {
      res.clearCookie('connect.sid');
      res.redirect('/');
    });
  });
});

// Validación de token de Shopify
app.get('/api/test-shopify-token', verifyShopifyToken, (req, res) => {
  res.json({
    success: true,
    shop: req.shop,
    message: '✅ Token válido y verificado',
  });
});

// 404 por defecto
app.use((req, res) => res.status(404).send('Página no encontrada'));

// Iniciar servidor
app.listen(PORT, () =>
  console.log(`✅ Servidor corriendo en http://localhost:${PORT}`)
);
