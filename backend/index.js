// backend/index.js
require('dotenv').config();

const express  = require('express');
const session  = require('express-session');
const passport = require('passport');
const mongoose = require('mongoose');
const cors     = require('cors');
const path     = require('path');
const fs       = require('fs');
const bcrypt   = require('bcrypt');
const bodyParser = require('body-parser');

require('./auth');                 // tu configuración de Passport
const User = require('./models/User');           // ✅  esta es la buena
const googleConnect  = require('./routes/googleConnect');
const googleAnalytics= require('./routes/googleAnalytics');
const metaAuthRoutes = require('./routes/meta');
const privacyRoutes  = require('./routes/privacyRoutes');
const userRoutes     = require('./routes/user');
const mockShopify    = require('./routes/mockShopify');
const shopifyRoutes  = require('./routes/shopify');   // ← NUEVO router único
const verifyShopifyToken = require('../middlewares/verifyShopifyToken');


const app  = express();
const PORT = process.env.PORT || 3000;

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

/* ---- Cookies seguras detrás de Render ---- */
app.set('trust proxy', 1);   // importante para cookies Secure

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { sameSite: 'none', secure: true }
}));

app.use(passport.initialize());
app.use(passport.session());

/* ===== Helpers de autenticación ===== */
function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.redirect('/');
}

function ensureNotOnboarded(req, res, next) {
  if (req.isAuthenticated() && !req.user.onboardingComplete) return next();
  res.redirect('/dashboard');
}

/* ===== Rutas públicas ===== */
app.get('/', (req, res) =>
  res.sendFile(path.join(__dirname, '../public/index.html'))
);

/* ===== Registro ===== */
app.post('/api/register', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ success: false, message: 'Correo y contraseña son requeridos' });

  try {
    const hashed = await bcrypt.hash(password, 10);
    await User.create({ email, password: hashed });
    res.status(201).json({ success: true, message: 'Usuario registrado con éxito' });
  } catch (err) {
    console.error('❌ Error al registrar usuario:', err);
    res.status(400).json({ success: false, message: 'No se pudo registrar el usuario' });
  }
});

/* ===== Login ===== */
app.post('/api/login', async (req, res, next) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ success: false, message: 'Correo y contraseña son requeridos' });

  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ success: false, message: 'Usuario no encontrado' });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ success: false, message: 'Contraseña incorrecta' });

    req.login(user, err => {
      if (err) return next(err);
      req.session.userId = user._id;
      res.status(200).json({
        success: true,
        redirect: user.onboardingComplete ? '/dashboard' : '/onboarding'
      });
    });
  } catch (err) {
    console.error('❌ Error al hacer login:', err);
    res.status(500).json({ success: false, message: 'Error del servidor' });
  }
});

/* ===== Completar onboarding ===== */
app.get("/onboarding", ensureNotOnboarded, (req, res) => {
  const filePath = path.join(__dirname, "../public/onboarding.html");

  fs.readFile(filePath, "utf8", (err, html) => {
    if (err) {
      console.error("❌ Error al leer onboarding.html:", err);
      return res.status(500).send("Error al cargar la página de onboarding.");
    }

    // ▸ Sustituir marcador de USER_ID y del INSTALL_LINK
    const updatedHtml = html
      .replace("USER_ID_REAL", req.user._id.toString())
      .replace(
        "INSTALL_LINK_PLACEHOLDER",
        process.env.CUSTOM_APP_INSTALL_LINK || ""
      );

    res.send(updatedHtml);
  });
});

/* ===== Marcar onboarding como completo ===== */
app.post('/api/complete-onboarding', async (req, res) => {
  try {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ success: false, message: 'No autenticado' });
    }

    await User.findByIdAndUpdate(req.user._id, {
      onboardingComplete: true,
    });

    res.json({ success: true });
  } catch (err) {
    console.error('❌ Error al completar onboarding:', err);
    res.status(500).json({ success: false, message: 'Error del servidor' });
  }
});


/* ===== Rutas externas / integraciones ===== */
app.use('/api/shopify', shopifyRoutes);          // ← único router de Shopify
app.use('/',        privacyRoutes);
app.use('/',        googleConnect);
app.use('/',        googleAnalytics);
app.use('/auth/meta', metaAuthRoutes);
app.use('/api',    userRoutes);
app.use('/api',    mockShopify);

/* ===== Vistas protegidas ===== */
app.get('/onboarding', ensureNotOnboarded, (req, res) => {
  const file = path.join(__dirname, '../public/onboarding.html');
  fs.readFile(file, 'utf8', (err, html) => {
    if (err) return res.status(500).send('Error al cargar onboarding');
    res.send(html.replace('USER_ID_REAL', req.user._id.toString()));
  });
});

app.get('/dashboard',      ensureAuthenticated, (r, s) =>
  s.sendFile(path.join(__dirname, '../public/dashboard.html'))
);
app.get('/configuracion',  (r, s) =>
  s.sendFile(path.join(__dirname, '../public/configuracion.html'))
);
app.get('/audit',          (r, s) =>
  s.sendFile(path.join(__dirname, '../public/audit.html'))
);
app.get('/pixel-verifier', (r, s) =>
  s.sendFile(path.join(__dirname, '../public/pixel-verifier.html'))
);

/* ===== Google OAuth ===== */
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
    res.redirect(req.user.onboardingComplete ? '/dashboard' : '/onboarding');
  }
);

/* ===== Logout ===== */
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

app.get('/api/test-shopify-token', verifyShopifyToken, (req, res) => {
  res.json({
    success: true,
    shop: req.shopifySession.dest,
    message: '✅ Token válido y verificado',
  });
});

/* ===== 404 ===== */
app.use((req, res) => res.status(404).send('Página no encontrada'));

/* ===== Server ===== */
app.listen(PORT, () =>
  console.log(`✅ Servidor corriendo en http://localhost:${PORT}`)
);
