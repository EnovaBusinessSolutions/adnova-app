// backend/index.js

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
const axios = require('axios');
const qs    = require('querystring');
require('dotenv').config();

require('./auth')

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

mongoose
  .connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log('✅ Conectado a MongoDB Atlas'))
  .catch((err) => console.error('❌ Error al conectar con MongoDB:', err));

// +++ MIDDLEWARES +++
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, '../public')));

app.set('trust proxy', 1);
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      secure: process.env.NODE_ENV === 'production',
    },
  })
);

app.use(passport.initialize());
app.use(passport.session());

// Funciones de control (si las usas globalmente)
function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.redirect('/');
}
function ensureNotOnboarded(req, res, next) {
  if (req.isAuthenticated() && !req.user.onboardingComplete) return next();
  res.redirect('/dashboard');
}

// RUTAS

app.get('/', (req, res) => {
  const { shop, host } = req.query;

  // Si viene desde la instalación (Shopify test automático)
  if (shop && host) {
    return res.redirect(`/auth/shopify?shop=${shop}&host=${host}`);
  }

  // Si no viene desde la instalación → servir index normal
  return res.sendFile(path.join(__dirname, '../public/index.html'));
});

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
    res.status(201).json({ success: true, message: 'Usuario registrado con éxito' });
  } catch (err) {
    console.error('❌ Error al registrar usuario:', err.stack || err);
    res.status(400).json({ success: false, message: 'No se pudo registrar el usuario' });
  }
});

app.post('/api/login', async (req, res, next) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res
      .status(400)
      .json({ success: false, message: 'Correo y contraseña son requeridos' });
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
        return res.status(200).json({
          success: true,
          redirect: '/dashboard',
        });
      }
      return res.status(200).json({
        success: true,
        redirect: '/onboarding',
      });
    });
  } catch (err) {
    console.error('❌ Error al hacer login:', err.stack || err);
    res.status(500).json({ success: false, message: 'Error del servidor' });
  }
});

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
    updatedHtml = updatedHtml.replace(
      'SHOPIFY_CONNECTED_FLAG',
      alreadyConnectedShopify ? 'true' : 'false'
    );

    updatedHtml = updatedHtml.replace(
      'GOOGLE_CONNECTED_FLAG',
      user.googleConnected ? 'true' : 'false'
    );

    res.send(updatedHtml);
  });
});

app.post('/api/complete-onboarding', async (req, res) => {
  try {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ success: false, message: 'No autenticado' });
    }
    const result = await User.findByIdAndUpdate(req.user._id, {
      onboardingComplete: true,
    });
    if (!result) {
      console.warn(
        '⚠️ No se encontró el usuario para completar onboarding:',
        req.user._id
      );
      return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('❌ Error al completar onboarding:', err.stack || err);
    res.status(500).json({ success: false, message: 'Error del servidor' });
  }
});

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
      shopifyConnected: req.user.shopifyConnected,
    },
  });
});

// Webhook verificado correctamente
app.post('/webhooks/shop/redact', express.raw({ type: 'application/json' }), (req, res) => {
  const hmac = req.get('X-Shopify-Hmac-Sha256');
  const digest = crypto
    .createHmac('sha256', process.env.SHOPIFY_API_SECRET)
    .update(req.body, 'utf8')
    .digest('base64');

  if (crypto.timingSafeEqual(Buffer.from(hmac, 'utf8'), Buffer.from(digest, 'utf8'))) {
    console.log('✅ Webhook shop/redact verificado');
    return res.status(200).send('OK');
  } else {
    console.warn('⚠️ Webhook shop/redact no verificado');
    return res.status(401).send('Firma inválida');
  }
});


// Rutas externas y de API
app.use('/api/shopify', shopifyRoutes);
app.use('/', privacyRoutes);
app.use('/auth/google', googleConnect);
app.use('/', googleAnalytics);
app.use('/auth/meta', metaAuthRoutes);
app.use('/api', userRoutes);
app.use('/api', mockShopify);

app.get('/dashboard', ensureAuthenticated, (r, s) => {
  s.sendFile(path.join(__dirname, '../public/dashboard.html'));
});
app.get('/configuracion', (r, s) =>
  s.sendFile(path.join(__dirname, '../public/configuracion.html'))
);
app.get('/pixel-verifier', (r, s) =>
  s.sendFile(path.join(__dirname, '../public/pixel-verifier.html'))
);

app.get(
  '/auth/google/login',
  passport.authenticate('google', {
    scope: [
      'profile',
      'email',
    ],
  })
);

app.get(
  '/auth/google/login/callback',
  passport.authenticate('google', { failureRedirect: '/' }),
  (req, res) => {
    const destino = req.user.onboardingComplete ? '/dashboard' : '/onboarding';
    res.redirect(destino);
  }
);

// 1) Dispara el OAuth únicamente para Analytics & Ads
app.get('/auth/google/connect', (req, res) => {
  // 1A) Si no está logueado en tu app, no puede conectar Analytics → redirigir al login
  if (!req.isAuthenticated()) {
    return res.redirect('/');
  }

  // 1B) Armar la URL de autorización de Google SOLO para los scopes de Analytics/Ads
  const params = new URLSearchParams({
    client_id:     process.env.GOOGLE_CLIENT_ID,
    redirect_uri:  process.env.GOOGLE_CONNECT_CALLBACK_URL, 
    response_type: 'code',
    access_type:   'offline',
    scope: [
      'https://www.googleapis.com/auth/analytics.readonly',
      'https://www.googleapis.com/auth/adwords'
    ].join(' '),
    state:         req.sessionID // opcional, ayuda a checar CSRF
  });

  // Redirigimos al diálogo de Google
  return res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});


// 2) Callback de Google tras aceptar Analytics/Ads
app.get('/auth/google/connect/callback', async (req, res) => {
  // 2A) Validar que el usuario siga logueado
  if (!req.isAuthenticated()) {
    return res.redirect('/');
  }

  const { code } = req.query;
  if (!code) {
    // Si Google devolvió error o usuario canceló, volvemos a onboarding con query “?google=fail”
    return res.redirect('/onboarding?google=fail');
  }

  try {
    // 2B) Intercambiar el “code” por tokens en Google
    const tokenRes = await axios.post(
      'https://oauth2.googleapis.com/token',
      qs.stringify({
        code,
        client_id:     process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri:  process.env.GOOGLE_CONNECT_CALLBACK_URL,
        grant_type:    'authorization_code'
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const { access_token, refresh_token, id_token } = tokenRes.data;

    // 2C) (Opcional) Decodificamos el id_token para obtener el email de Google
    let decodedEmail = '';
    if (id_token) {
      const payload = JSON.parse(
        Buffer.from(id_token.split('.')[1], 'base64').toString()
      );
      decodedEmail = payload.email || '';
    }

    // 2D) Actualizamos SOLO el documento existente en Mongo
    const updateData = {
      googleConnected:    true,
      googleAccessToken:  access_token,
      googleRefreshToken: refresh_token
    };
    if (decodedEmail) {
      updateData.googleEmail = decodedEmail;
    }

    await User.findByIdAndUpdate(req.user._id, updateData);
    console.log('✅ Google Analytics/Ads conectado para usuario:', req.user._id);

    // 2E) Volvemos a /onboarding para que la UI se pinte como “Connected”
    return res.redirect('/onboarding');
  } catch (err) {
    console.error(
      '❌ Error intercambiando tokens de Analytics/Ads:',
      err.response?.data || err.message
    );
    return res.redirect('/onboarding?google=error');
  }
});

app.get('/logout', (req, res) => {
  req.logout((err) => {
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

// Aquí sí usamos el middleware importado arriba
app.get('/api/test-shopify-token', verifyShopifyToken, (req, res) => {
  res.json({
    success: true,
    shop: req.shop,
    message: '✅ Token válido y verificado',
  });
});

app.use((req, res) => res.status(404).send('Página no encontrada'));

app.listen(PORT, () =>
  console.log(`✅ Servidor corriendo en http://localhost:${PORT}`)
);
