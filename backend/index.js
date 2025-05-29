// backend/index.js
require('dotenv').config();
const session = require('express-session');
const passport = require('passport');
require('./auth'); // este archivo lo vas a crear también en /backend/
const express = require('express');
const app = express();
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const User = require('./models/User');
const shopifyConnect = require('../routes/shopifyConnect');
const shopifyCallback = require('../routes/shopifyCallback');
const privacyRoutes = require('../routes/privacyRoutes');
const googleConnectRoutes = require('../routes/googleConnect');
const googleAnalyticsRoutes = require('../routes/googleAnalytics');
const metaAuthRoutes = require('./routes/auth/meta');
const userRoutes = require('./routes/user');




const PORT = process.env.PORT || 3000;

// ✅ Conexión a MongoDB usando la variable MONGO_URI
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log("✅ Conectado a MongoDB Atlas"))
.catch((err) => console.error("❌ Error al conectar con MongoDB:", err));

// Middlewares
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, '../public')));
app.use(session({
  secret: 'adnova-secret',
  resave: false,
  saveUninitialized: false
}));
app.use(passport.initialize());
app.use(passport.session());

// 🔐 Middlewares para proteger rutas
function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  return res.redirect('/');
}

function ensureNotOnboarded(req, res, next) {
  if (req.isAuthenticated() && !req.user.onboardingComplete) {
    return next();
  }
  return res.redirect('/dashboard');
}

// Página principal
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Registro de usuarios
app.post('/api/register', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Correo y contraseña son requeridos' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({ email, password: hashedPassword });
    res.status(201).json({ success: true, message: 'Usuario registrado con éxito' });
  } catch (err) {
    console.error("❌ Error al registrar usuario:", err);
    res.status(400).json({ success: false, message: 'No se pudo registrar el usuario' });
  }
});

// Login de usuarios (con integración de sesión)
app.post('/api/login', async (req, res, next) => {
  const { email, password } = req.body;
  console.log('Login recibido:', email);

  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Correo y contraseña son requeridos' });
  }

  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ success: false, message: 'Usuario no encontrado' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Contraseña incorrecta' });
    }

    // 🔑 Aquí se activa la sesión con Passport
    req.login(user, (err) => {
      if (err) {
        console.error("❌ Error al iniciar sesión con Passport:", err);
        return next(err);
      }

      req.session.userId = user._id;

      return res.status(200).json({
        success: true,
        redirect: user.onboardingComplete ? '/dashboard' : '/onboarding'
      });
    });

  } catch (err) {
    console.error("❌ Error al hacer login:", err);
    res.status(500).json({ success: false, message: 'Error del servidor' });
  }
});


// Ruta para marcar onboarding como completado
app.post('/api/complete-onboarding', async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ success: false, message: 'No autenticado' });
  }

  try {
    await User.findByIdAndUpdate(req.user._id, { onboardingComplete: true });
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Error al completar onboarding:", err);
    res.status(500).json({ success: false, message: 'Error al actualizar usuario' });
  }
});

// Rutas API externas
app.use('/api/shopify', shopifyConnect);
app.use('/api/shopify', shopifyCallback);
app.use('/', privacyRoutes);
app.use('/', googleConnectRoutes);
app.use('/', googleAnalyticsRoutes);
app.use('/auth/meta', metaAuthRoutes);
app.use('/api', userRoutes);



const fs = require('fs');

app.get("/onboarding", ensureNotOnboarded, (req, res) => {
  const filePath = path.join(__dirname, '../public/onboarding.html');

  fs.readFile(filePath, 'utf8', (err, html) => {
    if (err) {
      console.error("❌ Error al leer onboarding.html:", err);
      return res.status(500).send("Error al cargar la página de onboarding.");
    }

    const updatedHtml = html.replace('USER_ID_REAL', req.user._id.toString());
    res.send(updatedHtml);
  });
});


app.get("/dashboard", ensureAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/dashboard.html'));
});

app.get("/configuracion", (req, res) => {
  res.sendFile(path.join(__dirname, '../public/configuracion.html'));
});

app.get("/audit", (req, res) => {
  res.sendFile(path.join(__dirname, '../public/audit.html'));
});

app.get("/pixel-verifier", (req, res) => {
  res.sendFile(path.join(__dirname, '../public/pixel-verifier.html'));
});

// Ruta para iniciar sesión con Google
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

// Ruta de callback de Google
app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/' }),
  (req, res) => {
    const redirectUrl = req.user.onboardingComplete ? '/dashboard' : '/onboarding';
    res.redirect(redirectUrl);
  }
);

app.get('/api/user', (req, res) => {
  if (req.isAuthenticated()) {
    res.json({
      _id: req.user._id,
      email: req.user.email,
      onboardingComplete: req.user.onboardingComplete,
      googleConnected: req.user.googleConnected || false,
      metaConnected: req.user.metaConnected || false,
      shopifyConnected: req.user.shopifyConnected || false
    });
  } else {
    res.status(401).json({ message: 'No autenticado' });
  }
});

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

// Ruta 404
app.use((req, res) => {
  res.status(404).send('Página no encontrada');
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`✅ Servidor corriendo en http://localhost:${PORT}`);
});
