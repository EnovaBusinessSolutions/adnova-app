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


/* ---------- REGISTRO Y ENVÍO DE CORREO ---------- */
app.post('/api/register', async (req, res) => {
  const { email, password } = req.body;

  // Validación básica
  if (!email || !password) {
    return res
      .status(400)
      .json({ success: false, message: 'Correo y contraseña son requeridos' });
  }

  try {
    /* 1) Guardar el usuario en MongoDB */
    const hashed = await bcrypt.hash(password, 10);
    await User.create({ email, password: hashed });

    /* 2) Plantilla HTML del correo */
    let html = `
<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>Bienvenido a Adnova AI</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <!-- Inter font for modern look -->
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@600;700&display=swap" rel="stylesheet">
  <style>
    body {
      margin: 0;
      padding: 0;
      background: #0a0a12;
      color: #F4F2FF;
      font-family: 'Inter', Arial, Helvetica, sans-serif;
      font-size: 16px;
      line-height: 1.6;
      -webkit-text-size-adjust: none;
    }
    .card {
      max-width: 410px;
      background: rgba(16, 14, 26, 0.98);
      border-radius: 22px;
      box-shadow: 0 0 32px 0 #a96bff2d;
      margin: 0 auto;
      padding: 0;
    }
    .card-content {
      padding: 0 38px 38px 38px;
    }
    h1 {
      margin: 0 0 24px 0;
      font-size: 2rem;
      font-weight: 800;
      color: #A96BFF;
      letter-spacing: -1px;
      text-align: center;
    }
    p {
      margin: 0 0 18px 0;
      color: #F4F2FF;
      font-size: 1.04rem;
      line-height: 1.6;
      text-align: center;
    }
    .btn {
      background: linear-gradient(90deg, #A96BFF 0%, #9333ea 100%);
      border-radius: 10px;
      padding: 0.9rem 2.6rem;
      font-size: 1.1rem;
      font-weight: 700;
      color: #fff !important;
      text-decoration: none;
      display: inline-block;
      margin: 0 auto;
      box-shadow: 0 2px 8px #A96BFF20;
      border: none;
      transition: opacity 0.16s;
    }
    .btn:hover {
      opacity: 0.93;
    }
    .footer {
      background: #18132a;
      padding: 18px 36px 15px 36px;
      border-radius: 0 0 22px 22px;
      text-align: center;
      font-size: 0.97rem;
      color: #B6A7E8;
    }
    .footer a {
      color: #A96BFF;
      text-decoration: underline;
      font-weight: 600;
      transition: color 0.17s;
    }
    .footer a:hover {
      color: #fff;
    }
    @media screen and (max-width:600px){
      .card{width:97vw!important;max-width:98vw!important;}
      .card-content{padding:0 1.1rem 1.7rem 1.1rem;}
      h1{font-size:1.25rem;}
      .footer{font-size:0.89rem;padding:1.1rem 0.3rem 1rem 0.3rem;}
      .btn{width:100%;padding:0.85rem 0;}
    }
  </style>
</head>

<body>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a12;margin:0;padding:0;">
    <tr>
      <td align="center" style="padding:54px 8px;">
        <table role="presentation" cellpadding="0" cellspacing="0" class="card" width="410">
          <tr>
            <td class="card-content">
              <h1>¡Bienvenido a Adnova AI!</h1>
              <p>Tu cuenta se creó con éxito.</p>
              <p>Haz clic en el botón para iniciar sesión:</p>
              <table role="presentation" align="center" cellpadding="0" cellspacing="0" style="margin: 0 auto;">
                <tr>
                  <td align="center">
                    <a href="https://ai.adnova.digital/login"
                       class="btn" target="_blank">
                      Iniciar sesión
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:32px 0 0 0; font-size:0.98rem; color:#B6A7E8;">
                Si no solicitaste esta cuenta, ignora este correo.
              </p>
            </td>
          </tr>
          <tr>
            <td class="footer">
              © {{YEAR}} Adnova AI ·
              <a href="https://ai.adnova.digital/politica.html" target="_blank">Política de privacidad</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `;

    /* 3) Sustituir el año dinámicamente */
    html = html.replace('{{YEAR}}', new Date().getFullYear());

    /* 4) Enviar el correo */
    await transporter.sendMail({
      from:    process.env.SMTP_FROM,                 // Ej.: "Adnova AI <no-reply@tudominio.com>"
      to:      email,
      subject: 'Activa tu cuenta de Adnova AI',
      text:    'Tu cuenta se creó con éxito. Ingresa en https://ai.adnova.digital/login',
      html
    });

    /* 5) Responder al front */
    res.status(201).json({
      success: true,
      message: 'Usuario registrado y correo enviado'
    });

  } catch (err) {
    console.error('❌ Error al registrar usuario:', err);
    res.status(400).json({
      success: false,
      message: 'No se pudo registrar el usuario'
    });
  }
});
/* ---------- FIN REGISTRO ---------- */

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
