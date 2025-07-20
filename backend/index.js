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
const axios = require('axios');
const qs    = require('querystring');
const nodemailer = require('nodemailer');
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT), 
  secure: true,        
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

transporter.verify((err) => {
  if (err) console.error('❌ SMTP error:', err);
  else     console.log('✅ SMTP listo para enviar correo');
});

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
const connector = require('./routes/shopifyConnector');
const webhookRoutes   = require('./routes/shopifyConnector/webhooks');
const verifySessionToken = require('../middlewares/verifySessionToken');
const secureRoutes     = require('./routes/secure'); 
const dashboardRoute = require('./api/dashboardRoute'); 
const auditRoute     = require('./api/auditRoute'); 
const { publicCSP, shopifyCSP } = require('../middlewares/csp');  // ruta relativa correcta
const subscribeRouter = require('./routes/subscribe'); // <--- AGREGAR ESTA LÍNEA




const app = express();
app.use(publicCSP);  
const PORT = process.env.PORT || 3000;
const SHOPIFY_HANDLE = process.env.SHOPIFY_APP_HANDLE;



app.get("/connector/interface", shopifyCSP, (req, res) => {
  const { shop, host } = req.query;
  if (!shop || !host) return res.status(400).send("Faltan parámetros 'shop' o 'host'");

  res.sendFile(path.join(__dirname, "../public/connector/interface.html"));
});

mongoose
  .connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log('✅ Conectado a MongoDB Atlas'))
  .catch((err) => console.error('❌ Error al conectar con MongoDB:', err));

app.use(
  '/connector/webhooks',
  express.raw({ type: 'application/json' }), 
  webhookRoutes
);

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

app.use('/connector', shopifyCSP, connector);

app.use(cors({
  origin: [
    'https://ai.adnova.digital',
    /\.myshopify\.com$/, 
    'https://admin.shopify.com'
  ],
  credentials: true
}));


app.use(express.json());

/* ---------- STATIC FILES ---------- */
app.use('/assets',
  express.static(path.join(__dirname, '../public/dashboard/assets')));

//  👇 Agrega esta línea
app.use('/assets',
  express.static(path.join(__dirname, '../public/landing/assets')));

  app.use('/assets',
  express.static(path.join(__dirname, '../public/support/assets')));

app.use(express.static(path.join(__dirname, '../public')));

function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) return next();
  // sin sesión -> ve al formulario de login
  res.redirect('/login');
}
function ensureNotOnboarded(req, res, next) {
  if (req.isAuthenticated() && !req.user.onboardingComplete) return next();
  res.redirect('/dashboard');
}

// RUTAS

app.get('/', (req, res) => {
  const { shop } = req.query;

  // si viene de Shopify embed, redirige al conector
  if (shop) {
    return res.redirect(`/connector?shop=${shop}`);
  }

  // si el usuario YA está autenticado
  if (req.isAuthenticated && req.isAuthenticated()) {
    return req.user.onboardingComplete ? res.redirect('/dashboard')
                                        : res.redirect('/onboarding');
  }

  // visitante anónimo -> muestra la nueva landing
  return res.sendFile(path.join(__dirname, '../public/landing/index.html'));
});

// ---------- LOGIN TRADICIONAL ----------
app.get('/login', (_req, res) => {
  // tu página de login original (public/index.html)
  res.sendFile(path.join(__dirname, '../public/login.html'));
});


app.post('/api/register', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ success:false, message:'Correo y contraseña son requeridos' });
  }

  try {
    // 1- Guardar usuario
    const hashed = await bcrypt.hash(password, 10);
    await User.create({ email, password: hashed });

    // 2- Plantilla del correo
    const html = `
<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>Bienvenido a Adnova AI</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    @media screen and (max-width:600px){
      .card{width:100%!important}.btn{display:block!important;width:100%!important}
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#0d081c;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center" style="padding:40px 10px;">
      <table role="presentation" width="600" class="card" cellpadding="0" cellspacing="0"
             style="max-width:600px;background:#151026;border-radius:16px;
                    box-shadow:0 0 20px #6d3dfc;font-family:Arial,Helvetica,sans-serif;">
        <tr>
          <td align="center" style="padding:40px 0 10px">
            <img src="https://ai.adnova.digital/assets/logo-mail.png" width="120" alt="Adnova AI">
          </td>
        </tr>
        <tr>
          <td style="padding:0 50px 40px;color:#fff;font-size:16px;line-height:24px">
            <h1 style="margin:0 0 20px;font-size:26px;color:#6d3dfc;font-weight:700">
              ¡Bienvenido a Adnova AI!
            </h1>
            <p>Tu cuenta se creó con éxito.</p>
            <p>Haz clic en el botón para iniciar sesión:</p>
            <table role="presentation" align="center"><tr><td>
              <a href="https://ai.adnova.digital/login"
                 class="btn"
                 style="background:linear-gradient(90deg,#8548ff 0%,#5223ff 100%);
                        color:#fff;text-decoration:none;padding:14px 34px;border-radius:6px;
                        font-weight:600;display:inline-block;font-size:16px">
                Iniciar sesión
              </a>
            </td></tr></table>
            <p style="margin:32px 0 0;color:#c4c4c4;font-size:14px">
              Si no solicitaste esta cuenta, ignora este correo.
            </p>
          </td>
        </tr>
        <tr>
          <td style="background:#100c1e;padding:20px 40px;border-radius:0 0 16px 16px;
                     color:#777;font-size:12px;line-height:18px;text-align:center">
            © ${new Date().getFullYear()} Adnova AI ·
            <a href="https://ai.adnova.digital/politica.html"
               style="color:#777;text-decoration:underline">Política de privacidad</a>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

    // 3- Enviar correo (una sola vez)
    await transporter.sendMail({
      from:    process.env.SMTP_FROM,  // "Adnova AI <no-reply@…>"
      to:      email,
      subject: 'Activa tu cuenta de Adnova AI',
      text:    'Tu cuenta se creó con éxito. Ingresa en https://ai.adnova.digital/login',
      html
    });

    // 4- Respuesta al frontend
    res.status(201).json({ success:true, message:'Usuario registrado y correo enviado' });

  } catch (err) {
    console.error('❌ Error al registrar usuario:', err);
    res.status(400).json({ success:false, message:'No se pudo registrar el usuario' });
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
      shop: req.user.shop,   
      onboardingComplete: req.user.onboardingComplete,
      googleConnected: req.user.googleConnected,
      metaConnected: req.user.metaConnected,
      shopifyConnected: req.user.shopifyConnected,
    },
  });
});

function sessionGuard(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  return res.status(401).json({ error: 'No hay sesión' });
}

app.get('/api/saas/ping', sessionGuard, (req, res) => {
  res.json({ ok: true, user: req.user?.email });
});

app.use('/api/saas/shopify', sessionGuard, require('./routes/shopifyMatch'));

app.use('/api/shopify', shopifyRoutes);
app.use('/', privacyRoutes);
app.use('/auth/google', googleConnect);
app.use('/', googleAnalytics);
app.use('/auth/meta', metaAuthRoutes);
app.use('/api', userRoutes);
app.use('/api', mockShopify);
app.use('/api/secure', verifySessionToken, secureRoutes);
app.use('/api/dashboard', dashboardRoute);
app.use('/api/audit',      auditRoute);
app.use('/api/shopConnection', require('./routes/shopConnection'));
app.use('/api', subscribeRouter); // <--- AGREGAR ESTA LÍNEA


// === Nuevo dashboard SPA (React + Vite) ===
app.get(
  [
    '/dashboard', '/dashboard/',
    '/audit', '/audit/',
    '/google-ads', '/google-ads/',
    '/google-analytics', '/google-analytics/',
    '/configuracion', '/configuracion/',
    '/pixel-verifier', '/pixel-verifier/'
  ],
  ensureAuthenticated,
  (_req, res) => {
    res.sendFile(
      path.join(__dirname, '../public/dashboard/dashboard.html')
    );
  }
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

app.get('/auth/google/connect', (req, res) => {
  if (!req.isAuthenticated()) {
    return res.redirect('/');
  }

  const params = new URLSearchParams({
    client_id:     process.env.GOOGLE_CLIENT_ID,
    redirect_uri:  process.env.GOOGLE_CONNECT_CALLBACK_URL, 
    response_type: 'code',
    access_type:   'offline',
    scope: [
      'https://www.googleapis.com/auth/analytics.readonly',
      'https://www.googleapis.com/auth/adwords'
    ].join(' '),
    state:         req.sessionID 
  });

  return res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});


app.get('/auth/google/connect/callback', async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.redirect('/');
  }

  const { code } = req.query;
  if (!code) {
    return res.redirect('/onboarding?google=fail');
  }

  try {
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

    let decodedEmail = '';
    if (id_token) {
      const payload = JSON.parse(
        Buffer.from(id_token.split('.')[1], 'base64').toString()
      );
      decodedEmail = payload.email || '';
    }

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
  req.logout(err => {
    if (err) {
      console.error('Error al cerrar sesión:', err);
      return res.send(
        `<script>
          localStorage.removeItem('sessionToken');
          sessionStorage.removeItem('sessionToken');
          window.location.href = '/';
        </script>`
      );
    }

    req.session.destroy(() => {
      res.clearCookie('connect.sid', { path: '/' });

      return res.send(
        `<script>
          localStorage.removeItem('sessionToken');
          sessionStorage.removeItem('sessionToken');
          window.location.href = '/';
        </script>`
      );
    });
  });
});

app.get('/api/test-shopify-token', verifyShopifyToken, (req, res) => {
  res.json({
    success: true,
    shop: req.shop,
    message: '✅ Token válido y verificado',
  });
});

app.get(/^\/apps\/[^\/]+\/?.*$/, shopifyCSP, (req, res) => {
  const { shop, host } = req.query;
  const redirectUrl = new URL('/connector/interface', `https://${req.headers.host}`);
  if (shop) redirectUrl.searchParams.set('shop', shop);
  if (host) redirectUrl.searchParams.set('host', host);
  return res.redirect(redirectUrl.toString());
});

app.use((req, res) => res.status(404).send('Página no encontrada'));

app.listen(PORT, () =>
  console.log(`✅ Servidor corriendo en http://localhost:${PORT}`)
);
