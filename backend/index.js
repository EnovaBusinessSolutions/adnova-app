// backend/index.js
require("dotenv").config();

// Render inyecta RENDER_EXTERNAL_URL: sin esto, OAuth puede apuntar al default (adray.ai) en staging.
(function bootstrapAppUrlFromRender() {
  if (String(process.env.APP_URL || "").trim()) return;
  const renderUrl = String(process.env.RENDER_EXTERNAL_URL || "").trim();
  if (!renderUrl) return;
  const withProto = /^https?:\/\//i.test(renderUrl) ? renderUrl : `https://${renderUrl}`;
  process.env.APP_URL = withProto.replace(/\/$/, "");
})();

// Desarrollo local: si no hay APP_URL ni RENDER_EXTERNAL_URL, evitar fallback duro a adray.ai.
(function bootstrapLocalAppUrl() {
  if (String(process.env.APP_URL || "").trim()) return;
  const port = String(process.env.PORT || "3000").trim() || "3000";
  process.env.APP_URL = `http://localhost:${port}`;
})();

const express = require("express");
const session = require("express-session");
const ConnectMongo = require("connect-mongo"); // â NEW (Node 22 safe)
const MongoStore = ConnectMongo?.default ?? ConnectMongo; // â NEW
const passport = require("passport");
const mongoose = require("mongoose");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const helmet = require("helmet");
const compression = require("compression");

require("./auth"); // inicializa passport (estrategia Google + serialize/deserialize)

const User = require("./models/User");
const { listAuthorizedAnalyticsShopsForUser } = require("./services/analyticsAccess");
const {
  sendVerifyEmail,
  sendWelcomeEmail,
  sendResetPasswordEmail,
} = require("./services/emailService");

// â NEW: Analytics Events (no rompe si falla)
const { trackEvent } = require("./services/trackEvent");

// Turnstile fallback local:
// - if no secret is configured, do not block staging/startup
// - if a secret exists, validate the submitted token against Cloudflare
const TURNSTILE_SECRET = String(
  process.env.TURNSTILE_SECRET ||
  process.env.CLOUDFLARE_TURNSTILE_SECRET ||
  ""
).trim();

function isLocalDevRequest(req) {
  const host = String(req.headers?.host || req.headers?.["x-forwarded-host"] || "").toLowerCase();
  return (
    host.includes("localhost") ||
    host.includes("127.0.0.1") ||
    host.includes("[::1]")
  );
}

function requestBaseUrl(req) {
  const protoHeader = String(req.headers?.["x-forwarded-proto"] || "").split(",")[0].trim();
  const hostHeader = String(req.headers?.["x-forwarded-host"] || req.headers?.host || "").split(",")[0].trim();
  const proto = protoHeader || req.protocol || "http";
  if (!hostHeader) return null;
  return `${proto}://${hostHeader}`;
}

async function verifyTurnstile(token, remoteip) {
  const normalizedToken = String(token || "").trim();

  if (!TURNSTILE_SECRET) {
    return { ok: true, data: { skipped: true, reason: "missing_secret" } };
  }

  if (!normalizedToken) {
    return { ok: false, data: { "error-codes": ["missing-input-response"] } };
  }

  try {
    const body = new URLSearchParams({
      secret: TURNSTILE_SECRET,
      response: normalizedToken,
    });
    if (remoteip) body.set("remoteip", String(remoteip));

    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    const data = await response.json().catch(() => ({}));
    return { ok: Boolean(data?.success), data };
  } catch (error) {
    return {
      ok: false,
      data: { "error-codes": ["turnstile-request-failed"], message: error?.message || String(error) },
    };
  }
}

async function requireTurnstileAlways(req, res, next) {
  if (isLocalDevRequest(req)) return next();
  if (!TURNSTILE_SECRET) return next();

  const token =
    String(req.body?.turnstileToken || "").trim() ||
    String(req.body?.["cf-turnstile-response"] || "").trim() ||
    String(req.headers?.["x-turnstile-token"] || "").trim();

  const { ok, data } = await verifyTurnstile(token, getClientIp(req));
  if (ok) return next();

  return res.status(400).json({
    success: false,
    ok: false,
    requiresCaptcha: true,
    code: "TURNSTILE_REQUIRED_OR_FAILED",
    errorCodes: data?.["error-codes"] || [],
    message: "Verificación requerida. Completa el captcha para continuar.",
  });
}

/* =========================
 * Modelos para Integraciones (Disconnect)
 * (cargan con fallback para NO romper si cambia el schema)
 * ========================= */
let MetaAccount, GoogleAccount, ShopConnections;
try {
  MetaAccount = require("./models/MetaAccount");
} catch (_) {
  MetaAccount = null;
}
try {
  GoogleAccount = require("./models/GoogleAccount");
} catch (_) {
  GoogleAccount = null;
}
try {
  ShopConnections = require("./models/ShopConnections");
} catch (_) {
  ShopConnections = null;
}

// Routers
const googleConnect = require("./routes/googleConnect");
const googleAdsInsightsRouter = require("./routes/googleAdsInsights");
const gaRouter = require("./routes/googleAnalytics");
const metaAuthRoutes = require("./routes/meta");
const privacyRoutes = require("./routes/privacyRoutes");
const mockShopify = require("./routes/mockShopify");
const shopifyRoutes = require("./routes/shopify");
const verifySessionToken = require("../middlewares/verifySessionToken");
const secureRoutes = require("./routes/secure");
const dashboardRoute = require("./api/dashboardRoute");
const { publicCSP, shopifyCSP } = require("../middlewares/csp");
const subscribeRouter = require("./routes/subscribe");
const userRoutes = require("./routes/user");
const auditRunnerRoutes = require("./routes/auditRunner");
const stripeRouter = require("./routes/stripe");
const billingRoutes = require("./routes/billing");
const connector = require("./routes/shopifyConnector");
const webhookRoutes = require("./routes/shopifyConnector/webhooks");
const auditsRoutes = require("./routes/audits");
const pixelAuditor = require("./routes/pixelAuditor");

// â NEW: events router
const eventsRoutes = require("./routes/events");

const adminAnalyticsRoutes = require("./routes/adminAnalytics");

/* =========================
 * AdRay Pipeline Imports
 * ========================= */
const cookieParser = require('cookie-parser');
const prisma = require('./utils/prismaClient');
const collectRoutes = require('./routes/collect');
const adrayWebhookRoutes = require('./routes/adrayWebhooks');
const adrayPlatformRoutes = require('./routes/adrayPlatforms');
const wooOrdersRoutes = require('./routes/wooOrders');
const wordpressPluginRoutes = require('./routes/wordpressPlugin');
const rateLimitCollect = require('./middleware/rateLimitCollect');
const rateLimitRecording = require('./middleware/rateLimitRecording');
const recordingRoutes = require('./routes/recording');

// Meta
const metaInsightsRoutes = require("./routes/metaInsights");
const metaAccountsRoutes = require("./routes/metaAccounts");
const metaTable = require("./routes/metaTable");

// Routers nuevos
const metaPixelsRoutes = require("./routes/metaPixels");
const googleConversionsRoutes = require("./routes/googleConversions");
const pixelsRoutes = require("./routes/pixels");

// â NEW: MCPDATA router
const mcpdataRoutes = require("./routes/mcpdata");

const app = express();

// â Debug de correo (ya usa mailer.js/emailService.js)
app.use("/__mail", require("./routes/mailDebug"));

// â Cron emails (protegido por CRON_KEY)
app.use("/api/cron", require("./routes/cronEmails"));

const PORT = process.env.PORT || 3000;
const APP_URL = (process.env.APP_URL || "https://adray.ai").replace(/\/$/, "");
const LANDING_PUBLIC = path.join(__dirname, "../public/landing");
const LANDING_ADRAY_OUT = path.join(__dirname, "../landing-adray/out");
function hasLandingAdrayBuild() {
  return fs.existsSync(path.join(LANDING_ADRAY_OUT, "index.html"));
}

/* =========================
 * Seguridad y performance
 * ========================= */

app.disable("x-powered-by");

// HTTPS redirect — Render termina SSL en el edge y reenvía via x-forwarded-proto.
// Excluye:
//   - /connector/*                  (embedded Shopify iframe ya va sobre HTTPS del admin)
//   - /.well-known/*, /mcp*, /oauth/*, /register, /authorize, /token
//     Rutas del flujo OAuth/MCP. Un 301 en respuesta a un POST (ej. DCR
//     /register o /oauth/token) hace que el cliente descarte el body y
//     reintente como GET, rompiendo el handshake en silencio. Si el edge
//     por alguna razón no setea x-forwarded-proto en estas peticiones,
//     preferimos atenderlas tal cual antes que un 301 que rompe el flujo.
app.use((req, res, next) => {
  if (
    process.env.NODE_ENV === 'production' &&
    req.headers['x-forwarded-proto'] !== 'https' &&
    !req.path.startsWith('/connector') &&
    !req.path.startsWith('/.well-known/') &&
    !req.path.startsWith('/mcp') &&
    !req.path.startsWith('/oauth/') &&
    req.path !== '/register' &&
    req.path !== '/authorize' &&
    req.path !== '/token'
  ) {
    return res.redirect(301, 'https://' + req.headers.host + req.originalUrl);
  }
  next();
});

// CSP: relaxed for analytics API routes (SSE + fetch from React dashboard)
app.use((req, res, next) => {
  if (req.path.startsWith('/api/analytics') || req.path.startsWith('/api/feed')) {
    res.setHeader("Content-Security-Policy", "default-src 'self' * 'unsafe-inline' 'unsafe-eval' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' *; style-src 'self' 'unsafe-inline' *; connect-src 'self' *; font-src 'self' *; img-src 'self' data: *;");
  }
  next();
});

app.use(
  helmet({
    // IMPORTANTE para apps embebidas de Shopify
    frameguard: false,
    contentSecurityPolicy: false,

    // esto lo puedes dejar
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);
app.use(
  compression({
    filter: (req, res) => {
      // SSE must stay uncompressed or proxies/browsers may buffer the stream.
      if (req.path.startsWith('/api/feed')) return false;
      return compression.filter(req, res);
    },
  })
);

/* =========================
 * CORS
 * ========================= */
const APP_ORIGIN = (() => {
  try { return new URL(APP_URL).origin; } catch { return null; }
})();
const RENDER_EXTERNAL_ORIGIN = (() => {
  const raw = String(process.env.RENDER_EXTERNAL_URL || '').trim();
  if (!raw) return null;
  try { return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).origin; } catch { return null; }
})();

const ALLOWED_ORIGINS = [
  'https://adray.ai',
  'https://adray-app-staging-german.onrender.com',
  'https://admin.shopify.com',
  'http://localhost:3000', // â Allow local frontend
  /^https?:\/\/[^/]+\.myshopify\.com$/i,
    /^https?:\/\/[^/]+\.ngrok-free\.dev$/i,
    /^https?:\/\/[^/]+\.ngrok-free\.app$/i,
    /^https?:\/\/[^/]+\.loca\.lt$/i,
  APP_ORIGIN,
  RENDER_EXTERNAL_ORIGIN,
].filter(Boolean);


const corsOptions = {
  origin: (origin, cb) => {
    // Permitir solicitudes de pixel /collect (aceptar cualquier origen dinĂĄmicamente)
    return cb(null, true); 
  },
  credentials: true,
};

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));

/* =========================
 * Alto rendimiento: pixel /collect y script pĂşblico antes de sesiĂłn
 * (mantiene rateLimitCollect de main para la seĂąal / anti-abuso)
 * ========================= */
// BRI: session capture ingest — mounted under /collect/x so ad-blockers treat it
// the same as the trusted /collect endpoint.
// Must be registered BEFORE /collect so its 10mb body limit applies first —
// Express does prefix matching and runs middleware in registration order.
app.use(
  "/collect/x",
  cookieParser(),
  express.json({ limit: "10mb" }),
  rateLimitRecording,
  recordingRoutes
);

app.use(
  "/collect",
  cookieParser(),
  express.json({ limit: "1mb" }),
  express.urlencoded({ extended: true }),
  rateLimitCollect,
  collectRoutes
);

// Ad-blocker bypass alias — same handler, less obvious path.
// Used by the first-party pixel to avoid EasyList /collect rules.
app.use(
  "/m/s",
  cookieParser(),
  express.json({ limit: "1mb" }),
  express.urlencoded({ extended: true }),
  rateLimitCollect,
  collectRoutes
);
// Sweep also accessible internally via /collect/x/sweep (no sessionGuard)
// The route handler itself validates x-adray-internal header

app.get("/adray-pixel.js", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.setHeader("Content-Type", "text/javascript; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  return res.sendFile(path.join(__dirname, "../public/adray-pixel.js"));
});

// Session replay engine (served with neutral name to avoid ad-blocker false positives)
app.get("/static/dom-observer.min.js", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.setHeader("Content-Type", "text/javascript; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=604800, immutable");
  return res.sendFile(path.join(__dirname, "../node_modules/rrweb/dist/rrweb-all.min.js"));
});

// rrweb-player for dashboard (self-hosted to avoid CDN ad-blocker blocks)
app.get("/static/rp.js", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "text/javascript; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=604800, immutable");
  return res.sendFile(path.join(__dirname, "../node_modules/rrweb-player/dist/index.js"));
});
app.get("/static/rp.css", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "text/css; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=604800, immutable");
  return res.sendFile(path.join(__dirname, "../node_modules/rrweb-player/dist/style.css"));
});

/* =========================
 * SesiĂłn y Passport
 * (ANTES de Stripe, webhooks y APIs)
 * ========================= */
app.set("trust proxy", 1);

const SESSION_COOKIE_NAME = "adray.sid"; // â NEW (nombre propio)

// â OpciĂłn A: Session cookie (sin maxAge/expires) + store en Mongo (estable en prod)
app.use(
  session({
    name: SESSION_COOKIE_NAME, // â NEW
    secret: process.env.SESSION_SECRET || "adnova_secret",
    resave: false,
    saveUninitialized: false,

    store: MongoStore.create({
      mongoUrl: process.env.MONGO_URI,
      collectionName: "sessions",
      ttl: 60 * 60 * 24 * 7, // 7 dĂ­as server-side
      // opcional pero recomendado:
      autoRemove: "native",
    }),

    cookie: {
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,

      // â CLAVE OPCIĂN A:
      // NO maxAge
      // NO expires
      // => el navegador borra la cookie al cerrarse
    },
  })
);

app.use(passport.initialize());
app.use(passport.session());

function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  return res.redirect("/login");
}
function ensureNotOnboarded(req, res, next) {
  if (!(req.isAuthenticated && req.isAuthenticated()))
    return res.redirect("/login");
  if (!req.user?.onboardingComplete) return next();
  return res.redirect("/dashboard");
}
function sessionGuard(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  return res.status(401).json({ error: "No hay sesiĂłn" });
}

function isIframeRequest(req) {
  const dest = (req.get("sec-fetch-dest") || "").toLowerCase();
  return dest === "iframe" || req.query.embedded === "1";
}

// â Debe estar ANTES de cualquier uso
function topLevelRedirect(res, url, label = "Continuar con Shopify") {
  return res
    .status(200)
    .type("html")
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
      Shopify requiere abrir esta pĂĄgina <b>fuera del iframe</b>. Da clic para continuar.
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
// Si SĂ existe, dĂŠjalo asĂ­:
app.get(["/connector/auth", "/connector/auth/callback"], (req, res, next) => {
  if (isIframeRequest(req)) {
    const url = new URL(req.originalUrl, APP_URL);
    return topLevelRedirect(res, url.toString());
  }
  return next();
});

/* =========================
 * â PARSERS ESPECIALES (ANTES del JSON global)
 * - Shopify webhooks: RAW
 * - Stripe webhook: RAW (firma)
 * ========================= */

// 1) Shopify Connector Webhooks: RAW
app.use("/connector/webhooks", express.raw({ type: "*/*" }), webhookRoutes);    
app.use("/webhooks/shopify", express.raw({ type: "*/*" }), adrayWebhookRoutes);
// 2) Stripe: RAW **solo** en /api/stripe/webhook; JSON normal para el resto
app.use("/api/stripe", (req, res, next) => {
  if (req.path === "/webhook") {
    return express.raw({ type: "application/json" })(req, res, next);
  }
  return next();
});

// Parsers globales (despuĂŠs de RAW especiales)
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

/* =========================
 * Auth bĂĄsica (email/pass)
 * ========================= */

app.post("/api/register", requireTurnstileAlways, async (req, res) => {
  try {
    let { name, email, password } = req.body || {};

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "Nombre, correo y contraseĂąa son requeridos",
      });
    }

    name = String(name).trim();
    email = String(email).trim().toLowerCase();

    if (name.length < 2 || name.length > 60) {
      return res.status(400).json({
        success: false,
        message: "El nombre debe tener entre 2 y 60 caracteres",
      });
    }

    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRe.test(email)) {
      return res.status(400).json({ success: false, message: "Correo invĂĄlido" });
    }
    if (String(password).length < 8) {
      return res.status(400).json({
        success: false,
        message: "La contraseĂąa debe tener al menos 8 caracteres",
      });
    }

    const exists = await User.findOne({ email });
    if (exists) {
      return res
        .status(409)
        .json({ success: false, message: "El email ya estĂĄ registrado" });
    }

    const hashed = await bcrypt.hash(password, 10);

    const verifyToken = makeVerifyToken();
    const verifyTokenHash = hashToken(verifyToken);
    const verifyExpires = new Date(
      Date.now() + VERIFY_TTL_HOURS * 60 * 60 * 1000
    );

    const user = await User.create({
      name,
      email,
      password: hashed,

      emailVerified: false,
      verifyEmailTokenHash: verifyTokenHash,
      verifyEmailExpires: verifyExpires,
    });

    try {
      await trackEvent({
        name: "user_signed_up",
        userId: user._id,
        dedupeKey: `user_signed_up:${user._id}`,
        props: { method: "email" },
      });
    } catch {}

    try {
      await sendVerifyEmail({
        userId: user._id,
        toEmail: user.email,
        token: verifyToken,
        name: user.name,
        baseUrl: isLocalDevRequest(req) ? requestBaseUrl(req) : undefined,
      });
    } catch (mailErr) {
      console.error(
        "âď¸  Email verificaciĂłn fallĂł (registro OK):",
        mailErr?.message || mailErr
      );
    }

    return res.status(201).json({
      success: true,
      message: "Usuario registrado. Revisa tu correo para verificar tu cuenta.",
      confirmUrl: `/confirmation?email=${encodeURIComponent(user.email)}`,
    });
  } catch (err) {
    if (err && err.code === 11000) {
      return res
        .status(409)
        .json({ success: false, message: "El email ya estĂĄ registrado" });
    }
    console.error("â Error al registrar usuario:", err);
    return res
      .status(500)
      .json({ success: false, message: "Error interno al registrar" });
  }
});


/* =========================
 * â FORGOT PASSWORD (E2E)
 * ========================= */
const RESET_TTL_MINUTES = Number(process.env.RESET_PASSWORD_TTL_MINUTES || 30);

function makeResetToken() {
  return crypto.randomBytes(32).toString("hex");
}

app.post("/api/forgot-password", requireTurnstileAlways, async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();

    const safeOk = () => res.json({ ok: true });

    if (!email) return safeOk();

    const user = await User.findOne({ email })
      .select("_id email name emailVerified")
      .lean();

    if (!user) return safeOk();
    if (user.emailVerified === false) return safeOk();

    const resetToken = makeResetToken();
    const resetTokenHash = hashToken(resetToken);
    const resetExpires = new Date(Date.now() + RESET_TTL_MINUTES * 60 * 1000);

    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          resetPasswordTokenHash: resetTokenHash,
          resetPasswordExpires: resetExpires,
        },
      }
    );

    try {
      await sendResetPasswordEmail({
        userId: user._id,
        toEmail: user.email,
        name: user.name || (user.email ? user.email.split("@")[0] : "Usuario"),
        token: resetToken,
      });
    } catch (mailErr) {
      console.error(
        "âď¸ Reset email fallĂł (forgot OK):",
        mailErr?.message || mailErr
      );
    }

    return safeOk();
  } catch (e) {
    console.error("â /api/forgot-password:", e);
    return res.json({ ok: true });
  }
});

app.post(["/api/login", "/api/auth/login", "/login"], async (req, res, next) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");

    if (!email || !password) {
      return res
        .status(400)
        .json({ success: false, message: "Ingresa tu correo y contraseĂąa." });
    }

    const risk = riskGet(req, email);
    if (risk.requiresCaptcha && !isLocalDevRequest(req)) {
      const token =
        String(req.body?.turnstileToken || "").trim() ||
        String(req.body?.["cf-turnstile-response"] || "").trim() ||
        String(req.headers?.["x-turnstile-token"] || "").trim();

      const { ok, data } = await verifyTurnstile(token, getClientIp(req));
      if (!ok) {
        return res.status(400).json({
          success: false,
          ok: false,
          requiresCaptcha: true,
          code: "TURNSTILE_REQUIRED_OR_FAILED",
          errorCodes: data?.["error-codes"] || [],
          message: "VerificaciĂłn requerida. Completa el captcha para continuar.",
        });
      }
    }

    const user = await User.findOne({ email }).select("+password +emailVerified");

    if (!user || !user.password) {
      const rr = riskFail(req, email);
      return res.status(401).json({
        success: false,
        message: "Correo o contraseĂąa incorrectos.",
        requiresCaptcha: rr.requiresCaptcha,
      });
    }

    if (user.emailVerified === false) {
      return res.status(403).json({
        success: false,
        message: "Tu correo aĂşn no estĂĄ verificado. Revisa tu bandeja de entrada.",
      });
    }

    const okPass = await bcrypt.compare(password, user.password);
    if (!okPass) {
      const rr = riskFail(req, email);
      return res.status(401).json({
        success: false,
        message: "Correo o contraseĂąa incorrectos.",
        requiresCaptcha: rr.requiresCaptcha,
      });
    }

    riskClear(req, email);

    req.login(user, async (err) => {
      if (err) return next(err);

      try {
        await trackEvent({
          name: "user_logged_in",
          userId: user._id,
          ts: new Date(),
          props: { method: "email" },
        });
      } catch {}

      const redirect = user.onboardingComplete ? "/dashboard" : "/onboarding";
      return res.json({ success: true, redirect });
    });
  } catch (err) {
    console.error("â /api/login error:", err);
    return res.status(500).json({ success: false, message: "Error del servidor" });
  }
});

app.get("/api/auth/verify-email", async (req, res) => {
  try {
    const token = String(req.query.token || "").trim();
    if (!token) return res.status(400).send("Token faltante");

    const tokenHash = hashToken(token);

    const user = await User.findOne({
      verifyEmailTokenHash: tokenHash,
      verifyEmailExpires: { $gt: new Date() },
    });

    if (!user) {
      return res
        .status(400)
        .send(
          "El enlace de verificaciĂłn es invĂĄlido o expirĂł. Solicita uno nuevo."
        );
    }

    user.emailVerified = true;
    user.verifyEmailTokenHash = undefined;
    user.verifyEmailExpires = undefined;
    await user.save();

    try {
      await trackEvent({
        name: "email_verified",
        userId: user._id,
        dedupeKey: `email_verified:${user._id}`,
        ts: new Date(),
        props: { method: "email_link" },
      });
    } catch {}

    return res.redirect(302, "/login?verified=1");
  } catch (err) {
    console.error("â verify-email:", err);
    return res.status(500).send("Error al verificar el correo");
  }
});

// â AdRay Analytics & Realtime Feed (Phase 2)
// sessionGuard removed for dashboard demo/access
app.use("/api/analytics", require("./routes/analytics"));
app.use("/api/feed", require("./routes/feed"));
// BRI: authenticated recording API (presigned URLs, metadata)
app.use("/api/recording", recordingRoutes);
app.use('/api', wooOrdersRoutes);
app.use('/api/platform-connections', require('./routes/platformConnections'));
app.use('/wp-plugin', wordpressPluginRoutes);

// AdRay collect ya estĂĄ montado arriba (con rateLimitCollect). SeĂąal interna y plataformas (main):
app.use('/api/internal/daily-signal', require('./routes/internalDailySignal'));
// IMPORTANT: /api/secure uses JWT session token (not cookie session) — must be before sessionGuard
app.use("/api/secure", verifySessionToken, secureRoutes);
app.use("/api", sessionGuard, adrayPlatformRoutes);
/* =========================
 * Pixel auditor (usa JSON)
 * ========================= */
app.use("/api", pixelAuditor);

// Router de Stripe (ya con sesiĂłn/passport disponibles)
// Nota: para /api/stripe/webhook el body ya fue preparado por el middleware anterior
app.use("/api/stripe", stripeRouter);

/* =========================
 * CSP (orden importante)
 * ========================= */
app.use(publicCSP);
app.use(shopifyCSP);

/* robots.txt simple */
app.get("/robots.txt", (_req, res) => {
  res.type("text/plain").send("User-agent: *\nDisallow:");
});

/* =========================
 * MongoDB
 * ========================= */
if (!process.env.MONGO_URI) {
  console.warn("â ď¸  MONGO_URI no estĂĄ configurado");
}
mongoose
  .connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("â Conectado a MongoDB Atlas"))
  .catch((err) => console.error("â Error al conectar con MongoDB:", err));

/* =========================
 * PostgreSQL (Prisma)
 * ========================= */
prisma.$connect()
  .then(() => console.log("â Conectado a PostgreSQL (Prisma)"))
  .catch((err) => console.error("â Error con PostgreSQL (Prisma):", err));

/* =========================
 * Rutas utilitarias pĂşblicas
 * ========================= */
app.get("/agendar", (_req, res) => {
  const file = path.join(__dirname, "../public/agendar.html");
  let html = fs.readFileSync(file, "utf8");

  const bookingUrl = process.env.BOOKING_URL || "";
  html = html.replace(/{{BOOKING_URL}}/g, bookingUrl);

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});

app.get("/api/public-config", (_req, res) => {
  res.json({ bookingUrl: process.env.BOOKING_URL || "" });
});

/* =========================
 * Static / dashboard
 * ========================= */
const DASHBOARD_DIST = path.join(__dirname, "../dashboard-src/dist");
const LEGACY_DASH = path.join(__dirname, "../public/dashboard");
const HAS_DASHBOARD_DIST = fs.existsSync(path.join(DASHBOARD_DIST, "index.html"));

const DASH_DEBUG = process.env.DASH_DEBUG === "1";

function logDash(req, label, extra) {
  if (!DASH_DEBUG) return;
  const ua = String(req.headers["user-agent"] || "").slice(0, 120);
  const ref = String(req.headers["referer"] || "").slice(0, 160);
  const msg =
    `[${label}] ${new Date().toISOString()} ` +
    `${req.method} ${req.originalUrl} ` +
    `ua="${ua}" ref="${ref}"` +
    (extra ? ` ${extra}` : "");
  console.log(msg);
}

function isStartHit(req) {
  const p = String(req.path || req.originalUrl || "");
  return p.endsWith("/start") || p.includes("/start?");
}

function serveDashboardSPA({ app, rootDir, label }) {
  app.use("/dashboard", ensureAuthenticated, (req, _res, next) => {
    logDash(req, "DASH_REQ");
    if (isStartHit(req)) logDash(req, "START_HIT");
    return next();
  });

  app.use(
    "/assets",
    express.static(path.join(rootDir, "assets"), {
      immutable: true,
      maxAge: "1y",
    })
  );

  app.use("/dashboard", ensureAuthenticated, express.static(rootDir));

  app.get(/^\/dashboard(?:\/.*)?$/, ensureAuthenticated, (req, res) => {
    if (isStartHit(req)) {
      logDash(req, "START_FALLBACK", `-> index.html (${label})`);
    } else {
      logDash(req, "DASH_FALLBACK", `-> index.html (${label})`);
    }
    return res.sendFile(path.join(rootDir, "index.html"));
  });

  console.log(`â Dashboard servido desde: ${label}`);
}

if (HAS_DASHBOARD_DIST) {
  serveDashboardSPA({
    app,
    rootDir: DASHBOARD_DIST,
    label: "dashboard-src/dist",
  });
} else {
  serveDashboardSPA({
    app,
    rootDir: LEGACY_DASH,
    label: "public/dashboard (fallback)",
  });

  console.warn(
    "â ď¸ dashboard-src/dist no encontrado. Usando fallback /public/dashboard"
  );
}

/* =========================
 * Rutas de autenticaciĂłn e integraciones
 * ========================= */
app.use("/auth/google", googleConnect);
app.use("/auth/meta", metaAuthRoutes);
app.use("/", privacyRoutes);

// Google Analytics (GA4)
app.use("/api/google/analytics", gaRouter);

// â GA4 Auth (nuevo)
app.use(require("./routes/googleGa4Auth"));

app.use("/api/google/ads/insights", sessionGuard, googleAdsInsightsRouter);
app.use("/api/google/ads", sessionGuard, googleAdsInsightsRouter);

app.use("/api/onboarding/status", sessionGuard, require("./routes/onboardingStatus"));

app.use('/api/onboarding', require('./routes/onboardingReset'));

app.use('/api/pixel-setup', sessionGuard, require('./routes/pixelSetup'));

app.use('/api/mcpjobs', sessionGuard, require('./routes/mcpjobs'));

app.use('/api/mcp/context', require('./routes/mcpContext'));


app.use('/api/daily-signal-delivery', sessionGuard, require('./routes/dailySignalDelivery'));

// MCP Server (Phase 1) - protocol endpoint + OAuth + REST mirror
const { mountMcpRoutes } = require('./mcp/transport');
mountMcpRoutes(app);
const oauthRouter = require('./mcp/auth/oauth-server');
app.use('/oauth', oauthRouter);
app.use('/gpt/v1', require('./mcp/rest/router'));

// Some MCP clients probe `/register` at the root before checking
// `registration_endpoint`, so mount the DCR handler there too.
if (oauthRouter.dynamicClientRegistrationHandler) {
  app.post('/register', express.json(), oauthRouter.dynamicClientRegistrationHandler);
}

// Claude.ai (and some other MCP clients) hit /authorize and /token at the root
// instead of the /oauth/* paths advertised in the metadata. Redirect transparently
// so they work without requiring a change on the client side.
app.get('/authorize', (req, res) => {
  const qs = new URLSearchParams(req.query).toString();
  res.redirect(302, `/oauth/authorize${qs ? '?' + qs : ''}`);
});
// 307 preserves method + body so the client re-POSTs to /oauth/token.
app.post('/token', (req, res) => {
  const qs = new URLSearchParams(req.query).toString();
  res.redirect(307, `/oauth/token${qs ? '?' + qs : ''}`);
});

// OAuth 2.0 Authorization Server Metadata (RFC 8414)
// Required by the MCP spec for remote servers so clients (Claude, ChatGPT, etc.)
// can auto-discover the authorization and token endpoints.
app.get('/.well-known/oauth-authorization-server', (req, res) => {
  // Host-aware base. We previously used APP_URL, but that forced every client to
  // follow endpoints on a single host. Claude.ai's infra cannot reach the legacy
  // apex A-record for adray.ai (216.24.57.1); it only reaches Render's
  // CF-anycast subdomains. By reflecting the Host the client actually hit, the
  // full OAuth flow stays on that same (reachable) host.
  const base = `${req.protocol}://${req.get('host')}`;
  res.json({
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    revocation_endpoint: `${base}/oauth/revoke`,
    registration_endpoint: `${base}/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
    scopes_supported: ['read:ads_performance', 'read:shopify_orders'],
  });
});

// OAuth 2.0 Protected Resource Metadata (RFC 9728)
// Required by the MCP spec (2025-06-18+) for Claude.ai and other remote MCP
// clients to discover which authorization server protects this MCP endpoint.
app.get('/.well-known/oauth-protected-resource', (req, res) => {
  // Host-aware: mirror the host the client actually reached. See the note on
  // /.well-known/oauth-authorization-server above for why.
  const base = `${req.protocol}://${req.get('host')}`;
  res.json({
    resource: `${base}/mcp`,
    authorization_servers: [base],
    bearer_methods_supported: ['header'],
    scopes_supported: ['read:ads_performance', 'read:shopify_orders'],
  });
});

/* =========================
 * â Integraciones: DISCONNECT (E2E)
 * ========================= */

const emptyArr = () => [];

app.post("/api/integrations/disconnect/google", sessionGuard, async (req, res) => {
  try {
    // â FIX CRĂTICO: quitamos el typo ";a"
    const uid = req.user._id;

    if (GoogleAccount) {
      await GoogleAccount.updateOne(
        { $or: [{ user: uid }, { userId: uid }] },
        {
          $set: {
            accessToken: null,
            refreshToken: null,
            expiresAt: null,
            scope: emptyArr(),

            managerCustomerId: null,
            loginCustomerId: null,
            defaultCustomerId: null,
            customers: emptyArr(),
            ad_accounts: emptyArr(),
            selectedCustomerIds: emptyArr(),
            lastAdsDiscoveryError: null,

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

    await User.updateOne(
      { _id: uid },
      {
        $set: {
          googleConnected: false,
          selectedGoogleAccounts: emptyArr(),
          selectedGAProperties: emptyArr(),
        },
        $unset: {
          googleAccessToken: "",
          googleRefreshToken: "",
        },
      }
    );

    await User.updateOne(
      { _id: uid },
      {
        $set: {
          "preferences.googleAds.auditAccountIds": emptyArr(),
          "preferences.googleAnalytics.auditPropertyIds": emptyArr(),
        },
      }
    );

    return res.json({ ok: true });
  } catch (e) {
    console.error("[disconnect/google] error:", e);
    return res.status(500).json({ ok: false, error: "DISCONNECT_GOOGLE_FAILED" });
  }
});

app.post("/api/integrations/google/disconnect", sessionGuard, (req, res) =>
  res.redirect(307, "/api/integrations/disconnect/google")
);

app.post("/api/integrations/disconnect/meta", sessionGuard, async (req, res) => {
  try {
    const uid = req.user._id;

    if (MetaAccount) {
      await MetaAccount.updateOne(
        { $or: [{ user: uid }, { userId: uid }] },
        {
          $set: {
            longLivedToken: null,
            longlivedToken: null,
            access_token: null,
            accessToken: null,
            token: null,

            expiresAt: null,
            expires_at: null,

            ad_accounts: emptyArr(),
            adAccounts: emptyArr(),
            selectedAccountIds: emptyArr(),
            defaultAccountId: null,

            scopes: emptyArr(),
            fb_user_id: null,

            updatedAt: new Date(),
          },
        },
        { upsert: false }
      );
    }

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
          metaAccessToken: "",
          metaTokenExpiresAt: "",
          metaDefaultAccountId: "",
        },
      }
    );

    return res.json({ ok: true });
  } catch (e) {
    console.error("[disconnect/meta] error:", e);
    return res.status(500).json({ ok: false, error: "DISCONNECT_META_FAILED" });
  }
});

app.post("/api/integrations/meta/disconnect", sessionGuard, (req, res) =>
  res.redirect(307, "/api/integrations/disconnect/meta")
);

app.post("/api/integrations/disconnect/shopify", sessionGuard, async (req, res) => {
  try {
    const uid = req.user._id;

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

    await User.updateOne(
      { _id: uid },
      {
        $set: { shopifyConnected: false },
        $unset: {
          shop: "",
          shopifyAccessToken: "",
        },
      }
    );

    return res.json({ ok: true });
  } catch (e) {
    console.error("[disconnect/shopify] error:", e);
    return res.status(500).json({ ok: false, error: "DISCONNECT_SHOPIFY_FAILED" });
  }
});

app.post("/api/integrations/shopify/disconnect", sessionGuard, (req, res) =>
  res.redirect(307, "/api/integrations/disconnect/shopify")
);

// â AuditorĂ­as
app.use("/api/audits", sessionGuard, auditRunnerRoutes);
app.use("/api/audits", sessionGuard, auditsRoutes);
app.use("/api/audit", sessionGuard, auditRunnerRoutes);
app.use("/api/dashboard/audits", sessionGuard, auditsRoutes);

app.post("/api/audit/start", sessionGuard, (req, res) =>
  res.redirect(307, "/api/audits/start")
);
app.post("/api/audit/google/start", sessionGuard, (req, res) =>
  res.redirect(307, "/api/audits/start")
);
app.post("/api/audit/meta/start", sessionGuard, (req, res) =>
  res.redirect(307, "/api/audits/start")
);
app.post("/api/audit/shopify/start", sessionGuard, (req, res) =>
  res.redirect(307, "/api/audits/start")
);
app.post("/api/dashboard/audit", sessionGuard, (req, res) => {
  return res.redirect(307, "/api/audits/start");
});

// Stripe / Facturapi / Billing
app.use("/api/facturapi", require("./routes/facturapi"));
app.use("/api/billing", billingRoutes);

// Meta Ads
app.use("/api/meta/insights", sessionGuard, metaInsightsRoutes);
app.use("/api/meta/accounts", sessionGuard, metaAccountsRoutes);
app.use("/api/meta", metaTable);

// Montaje (semĂĄntico)
app.use("/api/meta", sessionGuard, metaPixelsRoutes);
app.use("/api/google", sessionGuard, googleConversionsRoutes);

// Central (select/status/confirm)
app.use("/api/pixels", sessionGuard, pixelsRoutes);

// â MCPDATA (marketing-only, sin tokens) â requiere sesiĂłn
app.use("/api/mcpdata", sessionGuard, mcpdataRoutes);

// Shopify
const verifyShopifyToken = require("../middlewares/verifyShopifyToken"); // (por ahora no usado)

// â SERVIR assets del conector ANTES del router
const CONNECTOR_PUBLIC = path.join(__dirname, "../public/connector");

// â Evitar cachĂŠ en assets crĂ­ticos del connector para desarrollo/staging
app.use(
  "/connector",
  (req, res, next) => {
    // Si estamos en desarrollo o staging, deshabilitar cachĂŠ
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    next();
  },
  express.static(CONNECTOR_PUBLIC, {
    index: false,
    maxAge: "0",
  }),
  connector
);

app.use("/api/shopify", shopifyRoutes);
app.use("/api", mockShopify);

/* =========================
 * PĂĄginas pĂşblicas y flujo de app
 * ========================= */
app.get("/", (req, res) => {
  const { shop } = req.query;
  if (shop) {
    const qs = new URLSearchParams(req.query).toString();
    return res.redirect(`/connector?${qs}`);
  }
  if (req.isAuthenticated && req.isAuthenticated()) {
    return req.user.onboardingComplete
      ? res.redirect("/dashboard")
      : res.redirect("/onboarding");
  }
  const landingIndex = hasLandingAdrayBuild()
    ? path.join(LANDING_ADRAY_OUT, "index.html")
    : path.join(LANDING_PUBLIC, "index.html");
  return res.sendFile(landingIndex);
});

// Compat: la landing antigua (saas-landing) exponĂ­a /start
app.get("/start", (_req, res) => res.redirect(302, "/"));

app.get(["/login", "/getstarted", "/confirmation"], (req, res) => {
  if (isLocalDevRequest(req)) {
    const fileByRoute = {
      "/login": "../public/login.html",
      "/getstarted": "../public/register.html",
      "/confirmation": "../public/confirmation.html",
    };
    const target = fileByRoute[req.path];
    if (target) return res.sendFile(path.join(__dirname, target));
  }

  res.sendFile(path.join(__dirname, "../public/login-v2/index.html"));
});

app.get("/onboarding", ensureNotOnboarded, async (req, res) => {
  const filePath = path.join(__dirname, "../public/onboarding.html");
  const user = await User.findById(req.user._id).lean();
  const alreadyConnectedShopify = user?.shopifyConnected || false;

  fs.readFile(filePath, "utf8", (err, html) => {
    if (err) {
      console.error("â Error al leer onboarding.html:", err.stack || err);
      return res.status(500).send("Error al cargar la pĂĄgina de onboarding.");
    }
    let updatedHtml = html.replace("USER_ID_REAL", req.user._id.toString());
    updatedHtml = updatedHtml.replace(
      "SHOPIFY_CONNECTED_FLAG",
      alreadyConnectedShopify ? "true" : "false"
    );
    updatedHtml = updatedHtml.replace(
      "GOOGLE_CONNECTED_FLAG",
      user?.googleConnected ? "true" : "false"
    );
    res.send(updatedHtml);
  });
});

app.post("/api/complete-onboarding", async (req, res) => {
  try {
    if (!req.isAuthenticated()) {
      return res
        .status(401)
        .json({ success: false, message: "No autenticado" });
    }
    const result = await User.findByIdAndUpdate(req.user._id, {
      onboardingComplete: true,
    });
    if (!result)
      return res
        .status(404)
        .json({ success: false, message: "Usuario no encontrado" });
    res.json({ success: true });
  } catch (err) {
    console.error("â Error al completar onboarding:", err.stack || err);
    res.status(500).json({ success: false, message: "Error del servidor" });
  }
});

// =========================
// Email verification helpers
// =========================
const VERIFY_TTL_HOURS = Number(process.env.VERIFY_EMAIL_TTL_HOURS || 24);

function makeVerifyToken() {
  return crypto.randomBytes(32).toString("hex");
}

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

// =========================
// Intercom helpers (E2E)
// =========================
const INTERCOM_APP_ID = process.env.INTERCOM_APP_ID || "sqexnuzh";
const INTERCOM_IDENTITY_SECRET = process.env.INTERCOM_IDENTITY_SECRET || "";
if (!INTERCOM_IDENTITY_SECRET) {
  console.warn(
    "[Intercom] WARNING: INTERCOM_IDENTITY_SECRET not set. " +
    "User payloads will ship without user_hash. " +
    "If Intercom workspace has Identity Verification = Enforced, sessions will fail."
  );
}

function toUnixSeconds(d) {
  const t = d ? new Date(d).getTime() : Date.now();
  return Math.floor(t / 1000);
}

function intercomUserHash(userId) {
  try {
    if (!INTERCOM_IDENTITY_SECRET) return null;
    return crypto
      .createHmac("sha256", INTERCOM_IDENTITY_SECRET)
      .update(String(userId))
      .digest("hex");
  } catch {
    return null;
  }
}

function buildIntercomPayload(u) {
  if (!u) return null;
  const user_id = String(u._id);
  return {
    app_id: INTERCOM_APP_ID,
    user_id,
    email: u.email || null,
    name: u.name || null,
    created_at: toUnixSeconds(u.createdAt),
    user_hash: intercomUserHash(user_id),
  };
}

/* =========================
 * Turnstile Risk Store (Login)
 * ========================= */
const LOGIN_RISK_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_RISK_MAX_FAILS = Number(process.env.LOGIN_RISK_MAX_FAILS || 3);

const loginRiskStore = new Map();

function getClientIp(req) {
  const xf = (req.headers["x-forwarded-for"] || "").toString();
  const ip = (xf.split(",")[0] || req.ip || "").trim();
  return ip || "unknown";
}

function riskKey(req, email) {
  return `${getClientIp(req)}::${String(email || "").toLowerCase().trim()}`;
}

function riskGet(req, email) {
  const key = riskKey(req, email);
  const v = loginRiskStore.get(key);
  if (v && v.expiresAt <= Date.now()) {
    loginRiskStore.delete(key);
    return { fails: 0, requiresCaptcha: false };
  }
  const fails = v?.fails || 0;
  return { fails, requiresCaptcha: fails >= LOGIN_RISK_MAX_FAILS };
}

function riskFail(req, email) {
  const key = riskKey(req, email);
  const now = Date.now();
  const prev = loginRiskStore.get(key);

  if (prev && prev.expiresAt <= now) {
    loginRiskStore.delete(key);
  }

  const current = loginRiskStore.get(key);
  const fails = (current?.fails || 0) + 1;

  loginRiskStore.set(key, { fails, expiresAt: now + LOGIN_RISK_WINDOW_MS });

  return { fails, requiresCaptcha: fails >= LOGIN_RISK_MAX_FAILS };
}

function riskClear(req, email) {
  loginRiskStore.delete(riskKey(req, email));
}



app.get("/api/session", async (req, res) => {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    return res.status(401).json({ authenticated: false });
  }

  try {
    const u = await User.findById(req.user._id)
      .select(
        "name email shop onboardingComplete googleConnected metaConnected shopifyConnected googleObjective metaObjective plan subscription createdAt"
      )
      .lean();

    if (!u) return res.status(401).json({ authenticated: false });

    const analyticsAccess = await listAuthorizedAnalyticsShopsForUser(u._id).catch(
      (error) => {
        console.warn("/api/session analytics access lookup failed:", error?.message || error);
        return null;
      }
    );

    return res.json({
      authenticated: true,
      user: {
        _id: u._id,
        name: u.name || null,
        email: u.email,
        shop: u.shop,
        onboardingComplete: !!u.onboardingComplete,

        googleConnected: !!u.googleConnected,
        metaConnected: !!u.metaConnected,
        shopifyConnected: !!u.shopifyConnected,

        googleObjective: u.googleObjective || null,
        metaObjective: u.metaObjective || null,

        createdAt: u.createdAt || null,
        plan: u.plan || "gratis",
        subscription: u.subscription || null,
      },

      intercom: buildIntercomPayload(u),
      authorizedAnalyticsShops: Array.isArray(analyticsAccess?.shops)
        ? analyticsAccess.shops
        : [],
      defaultAnalyticsShop: analyticsAccess?.defaultShop || null,
      defaultAnalyticsShopSource: analyticsAccess?.defaultShopSource || null,
      analyticsAccessDebug: analyticsAccess?.debug || null,
    });
  } catch (e) {
    console.error("/api/session error:", e);
    return res.status(401).json({ authenticated: false });
  }
});

async function sendAuthMe(req, res) {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    return res.status(401).json({ ok: false, error: "UNAUTHENTICATED" });
  }

  try {
    const u = await User.findById(req.user._id)
      .select("name email plan subscription createdAt onboardingComplete")
      .lean();

    if (!u) return res.status(401).json({ ok: false, error: "UNAUTHENTICATED" });

    const data = {
      _id: String(u._id),
      id: String(u._id),
      email: u.email || null,
      name: u.name || null,
      onboardingComplete: !!u.onboardingComplete,
      plan: u.plan || "gratis",
      createdAt: u.createdAt || null,
    };

    return res.json({
      ok: true,
      data,
      user: data,
      authenticated: true,
      plan: u.plan || "gratis",
      subscription: u.subscription || null,
      intercom: buildIntercomPayload(u),
    });
  } catch (e) {
    console.error("[api/auth/me] error:", e);
    return res.status(500).json({ ok: false, error: "ME_FAILED" });
  }
}

app.get("/api/auth/me", sendAuthMe);
app.get("/api/users/me", sendAuthMe);
app.get("/api/user/me", sendAuthMe);

app.get("/api/saas/ping", sessionGuard, (req, res) => {
  res.json({ ok: true, user: req.user?.email });
});
app.use("/api/saas/shopify", sessionGuard, require("./routes/shopifyMatch"));

app.get("/api/me", async (req, res) => {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    return res.status(401).json({ authenticated: false });
  }

  try {
    const u = await User.findById(req.user._id)
      .select("name email plan subscription createdAt onboardingComplete")
      .lean();

    if (!u) return res.status(401).json({ authenticated: false });

    const data = {
      _id: String(u._id),
      id: String(u._id),
      email: u.email || null,
      name: u.name || null,
      onboardingComplete: !!u.onboardingComplete,
      plan: u.plan || "gratis",
      createdAt: u.createdAt || null,
    };

    return res.json({
      ok: true,
      data,
      authenticated: true,
      user: {
        _id: u._id,
        name: u.name || null,
        email: u.email,
        onboardingComplete: !!u.onboardingComplete,
        createdAt: u.createdAt || null,
      },
      plan: u.plan || "gratis",
      subscription: u.subscription || null,
      intercom: buildIntercomPayload(u),
    });
  } catch (e) {
    console.error("/api/me error", e);
    return res.status(500).json({ authenticated: false, error: "internal" });
  }
});

app.use("/api", userRoutes);

// â NEW: events endpoint (/api/events) (requiere sesiĂłn)
app.use("/api", eventsRoutes);

// â NEW: admin analytics (panel interno)
app.use("/api/admin/analytics", adminAnalyticsRoutes);

app.use("/api/dashboard", dashboardRoute);
app.use("/api/shopConnection", require("./routes/shopConnection"));
app.use("/api", subscribeRouter);

// Next export estático: en disco es .../__next.segmento/__PAGE__.txt pero el runtime
// del cliente pide .../__next.segmento.__PAGE__.txt → 404 RSC y hidratación #418.
function* landingExportPlainFolderChains(rest) {
  const s = String(rest || "");
  if (!s.includes(".")) {
    yield [s];
    return;
  }
  const dot = s.indexOf(".");
  const left = s.slice(0, dot);
  const right = s.slice(dot + 1);
  for (const tail of landingExportPlainFolderChains(right)) {
    yield [left, ...tail];
  }
}
function* landingExportPageFolderChains(inner) {
  const s = String(inner || "");
  yield [`__next.${s}`];
  if (!s.includes(".")) return;
  const dot = s.indexOf(".");
  const left = s.slice(0, dot);
  const right = s.slice(dot + 1);
  for (const tail of landingExportPlainFolderChains(right)) {
    yield [`__next.${left}`, ...tail];
  }
}
function sendLandingExportedPageTxt(req, res, next) {
  const pathname = String(req.path || "");
  if (!pathname.includes("__PAGE__.txt")) return next();
  const m = pathname.match(/^\/(?:landing\/)?(.+)\/__next\.(.+)\.__PAGE__\.txt$/);
  if (!m) return next();
  const base = m[1];
  const inner = m[2];
  const baseDir = path.join(LANDING_PUBLIC, ...base.split("/").filter(Boolean));
  for (const parts of landingExportPageFolderChains(inner)) {
    const filePath = path.join(baseDir, ...parts, "__PAGE__.txt");
    try {
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        return res.sendFile(filePath, {
          maxAge: process.env.NODE_ENV === "production" ? "1d" : 0,
        });
      }
    } catch {
      /* ignore */
    }
  }
  next();
}

// EstĂĄticos (pĂşblicos)
// Landing Next: el export usa rutas absolutas /landing/_next/..., /landing/images/...
// (assetPrefix). Montar explícitamente bajo /landing para que no dependa del fallthrough
// entre varios express.static.
app.use(sendLandingExportedPageTxt);
app.use(
  "/landing",
  express.static(LANDING_PUBLIC, {
    maxAge: process.env.NODE_ENV === "production" ? "1d" : 0,
  })
);
// Misma carpeta en raíz: /pricing, /_next/... sin prefijo /landing (por si el HTML lo pide así)
app.use(
  express.static(LANDING_PUBLIC, {
    maxAge: process.env.NODE_ENV === "production" ? "1d" : 0,
  })
);
app.use("/assets", express.static(path.join(__dirname, "../public/landing/assets")));
app.use("/assets", express.static(path.join(__dirname, "../public/support/assets")));
app.use("/assets", express.static(path.join(__dirname, "../public/plans/assets")));
app.use("/assets", express.static(path.join(__dirname, "../public/bookcall/assets")));
app.use(express.static(path.join(__dirname, "../public")));

// â Embedded entry: Shopify Admin abre /apps/<handle>
app.get(/^\/apps\/[^/]+\/?.*$/, shopifyCSP, (req, res) => {
  const shop = String(req.query.shop || "").trim();
  const host = String(req.query.host || "").trim();

  if (!shop) {
    return res.status(400).type("text/plain").send("Missing shop");
  }

  const target = new URL("/connector/interface", APP_URL);
  target.searchParams.set("shop", shop);
  if (host) target.searchParams.set("host", host);

  return res.redirect(302, target.toString());
});

/* =========================
 * OAuth Google (login simple) â E2E (WELCOME REAL)
 * ========================= */
// Build a host-aware Google callback URL. Claude.ai / ChatGPT / Gemini
// connectors land on mcp-staging.adray.ai (or mcp.adray.ai). If Google
// comes back to a different host than where the user started, the
// session cookie (host-only) is lost and the OAuth handshake breaks. By
// reflecting req.get('host') here, Google returns to the same subdomain
// the user started on and the session survives.
function googleLoginCallbackUrl(req) {
  const proto = req.protocol; // honors trust proxy -> https in prod
  const host = req.get("host");
  return `${proto}://${host}/auth/google/login/callback`;
}

// Encode/decode a safe, same-origin returnTo path through Google's
// `state` parameter. State survives the round-trip to Google, which is
// required because the Express session cookie doesn't transfer across
// the Google hop when APP_URL and the host the user started on differ
// (which they do for the mcp subdomains).
function encodeGoogleState(returnTo) {
  if (!returnTo) return undefined;
  try {
    return Buffer.from(JSON.stringify({ rt: returnTo }), "utf8").toString(
      "base64url"
    );
  } catch {
    return undefined;
  }
}

function decodeGoogleState(stateParam) {
  if (!stateParam || typeof stateParam !== "string") return null;
  try {
    const decoded = Buffer.from(stateParam, "base64url").toString("utf8");
    const parsed = JSON.parse(decoded);
    const rt = parsed?.rt;
    if (typeof rt !== "string") return null;
    if (!rt.startsWith("/")) return null;
    if (rt.startsWith("//") || rt.startsWith("/\\")) return null;
    return rt;
  } catch {
    return null;
  }
}

app.get("/auth/google/login", (req, res, next) => {
  const raw = String(
    req.query.returnTo || req.query.return_to || req.query.next || ""
  );
  let safeReturnTo = null;
  if (raw) {
    try {
      const decoded = decodeURIComponent(raw);
      if (
        decoded.startsWith("/") &&
        !decoded.startsWith("//") &&
        !decoded.startsWith("/\\")
      ) {
        safeReturnTo = decoded;
      }
    } catch {
      // ignore malformed returnTo
    }
  }

  passport.authenticate("google", {
    scope: ["profile", "email"],
    prompt: "select_account",
    callbackURL: googleLoginCallbackUrl(req),
    state: encodeGoogleState(safeReturnTo),
  })(req, res, next);
});

app.get("/auth/google/login/callback", (req, res, next) => {
  const returnTo = decodeGoogleState(req.query.state);

  passport.authenticate(
    "google",
    {
      failureRedirect: "/login",
      callbackURL: googleLoginCallbackUrl(req),
    },
    async (err, user, info) => {
      try {
        if (err) return next(err);
        if (!user) return res.redirect("/login");

        req.logIn(user, async (loginErr) => {
          if (loginErr) return next(loginErr);

          try {
            await trackEvent({
              name: "user_logged_in",
              userId: user._id,
              ts: new Date(),
              props: { method: "google" },
            });
          } catch {}

          const isNew = info?.isNewUser === true || user?._isNewUser === true;

          if (isNew) {
            try {
              await trackEvent({
                name: "user_signed_up",
                userId: user._id,
                dedupeKey: `user_signed_up:${user._id}`,
                props: { method: "google" },
              });
            } catch {}

            try {
              const u = await User.findById(user._id)
                .select("email name welcomeEmailSent")
                .lean();

              const toEmail = String(u?.email || "").trim().toLowerCase();
              const name =
                String(u?.name || "").trim() ||
                (toEmail ? toEmail.split("@")[0] : "") ||
                "Usuario";

              if (!toEmail) {
                console.warn("[google-callback] Welcome NO enviado: missing email");
              } else if (u?.welcomeEmailSent === true) {
                console.log("[google-callback] Welcome NO enviado: already-sent");
              } else {
                Promise.resolve()
                  .then(() => sendWelcomeEmail({ userId: user._id, toEmail, name }))
                  .then(() =>
                    User.updateOne(
                      { _id: user._id },
                      { $set: { welcomeEmailSent: true, welcomeEmailSentAt: new Date() } }
                    )
                  )
                  .then(() => console.log("[google-callback] Welcome enviado â", toEmail))
                  .catch((e) =>
                    console.error("[google-callback] Welcome fallĂł:", e?.message || e)
                  );
              }
            } catch (e) {
              console.error(
                "[google-callback] Error preparando welcome:",
                e?.message || e
              );
            }
          } else {
            console.log("[google-callback] Welcome NO enviado: not-new-user");
          }

          const destino =
            returnTo ||
            (user.onboardingComplete ? "/dashboard" : "/onboarding");
          return res.redirect(destino);
        });
      } catch (e) {
        return next(e);
      }
    }
  )(req, res, next);
});

/* =========================
 * Debug / DiagnĂłstico
 * ========================= */
const PUBLIC_DIR = path.join(__dirname, "../public");

app.get("/__ping", (_req, res) => {
  const successExists = fs.existsSync(path.join(PUBLIC_DIR, "plans", "success.html"));
  const cancelExists = fs.existsSync(path.join(PUBLIC_DIR, "plans", "cancel.html"));
  res.json({
    ok: true,
    cwd: __dirname,
    successHtml: successExists,
    cancelHtml: cancelExists,
    publicDir: PUBLIC_DIR,
  });
});

app.get("/__ls-public", (_req, res) => {
  const dir = path.join(PUBLIC_DIR, "plans");
  fs.readdir(dir, (err, files) => {
    res.json({ dir, exists: !err, files: files || [], error: err?.message });
  });
});

// --- LOGOUT unificado --- //
function destroySessionAndReply(req, res, { redirectTo } = {}) {
  req.session?.destroy?.(() => {
    res.clearCookie(SESSION_COOKIE_NAME, {
      path: "/",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
    });
    if (redirectTo) {
      return res.redirect(303, redirectTo);
    }
    return res.json({ ok: true });
  });
}

app.post("/api/logout", (req, res, next) => {
  req.logout?.(async (err) => {
    if (err) return next(err);

    try {
      await trackEvent({
        name: "user_logged_out",
        userId: req.user?._id,
        ts: new Date(),
      });
    } catch {}

    destroySessionAndReply(req, res);
  });
});

app.get("/logout", (req, res, next) => {
  req.logout?.((err) => {
    if (err) return next(err);
    destroySessionAndReply(req, res, { redirectTo: "/login" });
  });
});

/* =========================
 * Rutas ĂŠxito/cancel Stripe
 * ========================= */
app.get("/plans/success", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "plans", "success.html"));
});
app.get("/plans/cancel", (_req, res) => {
  const candidate = path.join(PUBLIC_DIR, "plans", "cancel.html");
  if (fs.existsSync(candidate)) return res.sendFile(candidate);
  res.redirect("/plans");
});

/* =========================
 * Short public MCP links
 * ========================= */
app.get("/s/:token", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0, s-maxage=0");
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");
    res.set("Surrogate-Control", "no-store");
    res.set("Vary", "Accept-Encoding");

    const token = String(req.params?.token || "").trim();
    if (!token) {
      return res.status(400).type("text/plain").send("Missing token");
    }

    const providerRaw = String(req.query?.provider || "chatgpt").trim().toLowerCase();
    const provider =
      providerRaw === "claude" || providerRaw === "gemini" || providerRaw === "chatgpt"
        ? providerRaw
        : "chatgpt";

    const user = await User.findOne({
      mcpShareToken: token,
      mcpShareEnabled: true,
    }).select(
      [
        "mcpShareToken",
        "mcpShareEnabled",
        "mcpShareProvider",
        "mcpShareVersionedUrl",
        "mcpShareShortUrl",
      ].join(" ")
    ).lean();

    if (!user) {
      return res.status(404).type("text/plain").send("Short link not found");
    }

    const storedVersionedUrl = String(user?.mcpShareVersionedUrl || "").trim();
    if (storedVersionedUrl) {
      try {
        const target = new URL(storedVersionedUrl);

        if (!target.searchParams.get("provider")) {
          target.searchParams.set("provider", provider);
        } else if (provider && target.searchParams.get("provider") !== provider) {
          target.searchParams.set("provider", provider);
        }

        return res.redirect(302, target.toString());
      } catch (e) {
        console.error("[short-mcp-link] invalid stored versioned url:", e);
      }
    }

    const fallback = new URL(`/api/mcp/context/shared/${encodeURIComponent(token)}`, APP_URL);
    fallback.searchParams.set("provider", provider);

    return res.redirect(302, fallback.toString());
  } catch (err) {
    console.error("[short-mcp-link] error:", err);
    return res.status(500).type("text/plain").send("Short link failed");
  }
});

app.use("/api", (req, res) => {
  res.status(404).json({ ok: false, error: "Not Found", path: req.originalUrl });
});

/* =========================
 * 404 y errores
 * ========================= */
app.use((req, res) => res.status(404).send("PĂĄgina no encontrada"));
app.use((err, _req, res, _next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal Server Error" });
});

app.listen(PORT, () => {
  console.log(`✓ Servidor corriendo en http://localhost:${PORT}`);
});

// ── Recording sweep: auto-finalize recordings stuck in RECORDING/FINALIZING ──
// Runs every 10 minutes internally so no manual dashboard visit is required.
(function startRecordingSweep() {
  const SWEEP_INTERVAL_MS = 10 * 60 * 1000;
  const sweepUrl = `http://localhost:${PORT}/collect/x/sweep`;
  const secret = process.env.INTERNAL_CRON_SECRET || 'adray-internal';

  async function runSweep() {
    try {
      const r = await fetch(sweepUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-adray-internal': secret },
        // Large limit so a backlog of stuck recordings drains in one pass
        body: JSON.stringify({ limit: 1000 }),
      });
      const data = await r.json().catch(() => ({}));
      if (data.swept > 0) console.log(`[recordingSweep] Swept ${data.swept} stuck recordings`);
    } catch (e) {
      console.warn('[recordingSweep] Sweep failed:', e.message);
    }
  }

  // First sweep after 2 minutes (let server fully boot), then every 10 min
  setTimeout(() => { runSweep(); setInterval(runSweep, SWEEP_INTERVAL_MS); }, 2 * 60 * 1000);
})();

// ── SessionPacket backfill: build packets for READY recordings that pre-date ──
// ── the build-packet pipeline, so /bri shows Sessions for every recording. ──
// Runs 3 min after boot (letting the sweep start first) then every 15 min.
// Uses the INLINE builder (/build-packets-now) so it works even when the
// BullMQ worker is busy draining finalize jobs. No LLM calls here —
// analyze-session is enqueued for the worker to pick up asynchronously.
(function startPacketBackfill() {
  const BACKFILL_INTERVAL_MS = 15 * 60 * 1000;
  const backfillUrl = `http://localhost:${PORT}/collect/x/build-packets-now`;
  const secret = process.env.INTERNAL_CRON_SECRET || 'adray-internal';

  async function runBackfill() {
    try {
      const r = await fetch(backfillUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-adray-internal': secret },
        // 50 per run — each involves an R2 download. Larger backlogs drain
        // across subsequent runs.
        body: JSON.stringify({ limit: 50 }),
      });
      const data = await r.json().catch(() => ({}));
      if (data.built > 0 || data.failed > 0) {
        console.log(`[packetBackfill] built=${data.built} failed=${data.failed} candidates=${data.candidates} alreadyHavePacket=${data.alreadyHavePacket}`);
      }
    } catch (e) {
      console.warn('[packetBackfill] Backfill failed:', e.message);
    }
  }

  setTimeout(() => { runBackfill(); setInterval(runBackfill, BACKFILL_INTERVAL_MS); }, 3 * 60 * 1000);
})();

// ── AI analysis backfill: run sessionAnalyst INLINE on packets without   ──
// ── aiAnalysis, so /bri eventually shows archetype/narrative on every    ──
// ── row even when the BullMQ worker drops analyze-session jobs.          ──
// Uses /analyze-pending which has a deterministic path + fallback, so it
// works without OPENROUTER_API_KEY. First pass 5 min after boot, then 10 min.
(function startAnalysisBackfill() {
  const ANALYZE_INTERVAL_MS = 10 * 60 * 1000;
  const analyzeUrl = `http://localhost:${PORT}/collect/x/analyze-pending`;
  const secret = process.env.INTERNAL_CRON_SECRET || 'adray-internal';

  async function runAnalyze() {
    try {
      const r = await fetch(analyzeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-adray-internal': secret },
        body: JSON.stringify({ limit: 20 }),
      });
      const data = await r.json().catch(() => ({}));
      if (data.analyzed > 0 || data.failed > 0) {
        console.log(`[analysisBackfill] analyzed=${data.analyzed} failed=${data.failed} candidates=${data.candidates}`);
      }
    } catch (e) {
      console.warn('[analysisBackfill] Analyze failed:', e.message);
    }
  }

  setTimeout(() => { runAnalyze(); setInterval(runAnalyze, ANALYZE_INTERVAL_MS); }, 5 * 60 * 1000);
})();

// ── Inline Recording Worker ────────────────────────────────────────
// Runs the recording worker in the same process as the web server.
// Set RECORDING_WORKER_INLINE=false to disable (e.g. when running a dedicated worker service).
if (process.env.RECORDING_WORKER_INLINE !== 'false') {
  try {
    require('./workers/recordingWorker');
    console.log('[recording-worker] Started inline');
  } catch (err) {
    console.error('[recording-worker] Failed to start inline:', err.message);
  }
}
