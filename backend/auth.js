// backend/auth.js
'use strict';

const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;

const User = require('./models/User');

// ✅ NEW: Analytics Events (no rompe si falta/si falla)
let trackEvent = null;
try {
  ({ trackEvent } = require('./services/trackEvent'));
} catch (_) {
  trackEvent = null;
}

const APP_URL = (process.env.APP_URL || 'https://adray.ai').replace(/\/$/, '');

// IMPORTANTE: debe coincidir con tu ruta real en backend/index.js:
// app.get('/auth/google/login/callback', ...)
const DEFAULT_GOOGLE_LOGIN_CALLBACK = `${APP_URL}/auth/google/login/callback`;

// Puedes usar esta env si quieres controlarlo desde Render:
// GOOGLE_LOGIN_CALLBACK_URL=https://adray.ai/auth/google/login/callback
const GOOGLE_LOGIN_CALLBACK_URL =
  process.env.GOOGLE_LOGIN_CALLBACK_URL ||
  process.env.GOOGLE_CALLBACK_URL || // compat si ya la tienes
  DEFAULT_GOOGLE_LOGIN_CALLBACK;

/**
 * Helpers
 */
function getUtcYmd(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function safeIp(req) {
  try {
    const xf = req?.headers?.['x-forwarded-for'];
    if (typeof xf === 'string' && xf.trim()) return xf.split(',')[0].trim();
    if (Array.isArray(xf) && xf.length) return String(xf[0]).trim();
  } catch {}
  return (req?.ip ? String(req.ip) : '') || '';
}

function safeUa(req) {
  try {
    return (req?.headers?.['user-agent'] ? String(req.headers['user-agent']) : '') || '';
  } catch {
    return '';
  }
}

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: GOOGLE_LOGIN_CALLBACK_URL,
      passReqToCallback: true,
    },
    async (req, accessToken, refreshToken, profile, done) => {
      try {
        // ✅ Email robusto
        const email =
          (profile?.emails?.[0]?.value ? String(profile.emails[0].value) : '') || '';
        const normalizedEmail = email.trim().toLowerCase();

        // ✅ Nombre robusto
        const name =
          (profile?.displayName ? String(profile.displayName) : '') ||
          (profile?.name?.givenName ? String(profile.name.givenName) : '') ||
          'Usuario';

        // Si no hay email, no podemos crear usuario ni enviar correo
        if (!normalizedEmail) {
          console.error('[auth.js][google] Google profile sin email. Profile:', {
            id: profile?.id,
            emails: profile?.emails,
            displayName: profile?.displayName,
          });
          return done(new Error('Google no devolvió email para este usuario.'), null);
        }

        let user = await User.findOne({ email: normalizedEmail });
        let isNewUser = false;

        if (!user) {
          isNewUser = true;

          // ✅ Usuario nuevo por Google
          user = await User.create({
            googleId: profile.id,
            name,
            email: normalizedEmail,

            // Google ya viene verificado por Google (no tiene sentido bloquearlo)
            emailVerified: true,

            // Si tu login email/pass usa "password", dejarlo vacío está OK
            password: '',

            // ✅ Mantengo esto TAL CUAL para NO romper tu flujo actual:
            // (tu index.js redirige a /dashboard si onboardingComplete=true)
            onboardingComplete: true,

            // ✅ CLAVE E2E: control del welcome
            welcomeEmailSent: false,
            welcomeEmailSentAt: null,
          });

          console.log('🆕 Usuario de Google creado en MongoDB:', normalizedEmail);

          // ✅ Track signup (dedupe por usuario)
          if (trackEvent) {
            Promise.resolve()
              .then(() =>
                trackEvent({
                  name: 'user_signed_up',
                  userId: user._id,
                  dedupeKey: `user_signed_up:${user._id}`,
                  props: { method: 'google' },
                  ts: new Date(),
                })
              )
              .catch(() => {});
          }
        } else {
          // ✅ Usuario existente
          const patch = {};

          if (!user.googleId) patch.googleId = profile.id;
          if (user.emailVerified === false) patch.emailVerified = true;
          if (!user.name && name) patch.name = name;

          /**
           * 🔥 MUY IMPORTANTE:
           * Para usuarios ya existentes (legacy) NO queremos que se dispare welcome “retroactivo”.
           * Si el campo no existe en Mongo (undefined), lo marcamos como ya enviado.
           */
          if (typeof user.welcomeEmailSent === 'undefined') {
            patch.welcomeEmailSent = true;
            patch.welcomeEmailSentAt = new Date();
          }

          if (Object.keys(patch).length) {
            await User.updateOne({ _id: user._id }, { $set: patch });
            user = await User.findById(user._id);
          }

          console.log('✅ Usuario de Google ya registrado:', normalizedEmail);
        }

        /**
         * ==========================================================
         * ✅ TRACK LOGIN (2 capas)
         *   A) RAW: cada inicio de sesión (métrica real de "logins")
         *   B) STATE: dedupe por día, pero actualiza hora + count (live)
         * ==========================================================
         */
        if (trackEvent && user?._id) {
          const now = new Date();
          const ymd = getUtcYmd(now);

          const sessionId =
            (req && req.sessionID ? String(req.sessionID) : '') || null;

          const ip = safeIp(req) || null;
          const ua = safeUa(req) || null;

          // A) ✅ RAW (1 evento por login) -> para “cuántos logins por día”
          // dedupeKey único por sesión/instante para no colisionar.
          // Nota: si tu trackEvent no requiere dedupeKey, igual está OK mandarlo.
          const rawDedupe =
            `user_login:${user._id}:${now.getTime()}:${Math.random().toString(16).slice(2)}`;

          Promise.resolve()
            .then(() =>
              trackEvent({
                name: 'user_login', // 👈 evento RAW nuevo
                userId: user._id,
                dedupeKey: rawDedupe,
                props: {
                  method: 'google',
                  source: 'app',
                  sessionId,
                  ip,
                  ua,
                },
                ts: now,
              })
            )
            .catch(() => {});

          // B) ✅ STATE (1 doc por usuario por día) -> “último login” + live refresh
          // Mantiene tu dedupeKey actual pero ahora mandamos:
          // - ts: last login at
          // - inc: { count: 1 } para contar logins del día sin duplicar docs
          // - props.lastLoginAt para UI/CRM si lo quieres directo
          Promise.resolve()
            .then(() =>
              trackEvent({
                name: 'user_logged_in', // 👈 evento STATE (el que ya tienes)
                userId: user._id,
                dedupeKey: `user_logged_in:${user._id}:${ymd}`,
                props: {
                  method: 'google',
                  source: 'app',
                  sessionId,
                  ip,
                  ua,
                  ymd,
                  lastLoginAt: now.toISOString(),
                },
                ts: now,                 // 👈 queremos que este se vaya actualizando
                inc: { count: 1 },       // 👈 contador diario (requiere soporte en trackEvent)
                setOnInsert: { firstTs: now }, // 👈 primer login del día (requiere soporte)
              })
            )
            .catch(() => {});
        }

        // ✅ Extra: bandera “transiente” por si la quieres leer en index.js
        user._isNewUser = isNewUser;

        /**
         * ✅ Mandamos "info.isNewUser" como 3er argumento de done()
         * para que tu callback route en index.js lo reciba.
         */
        return done(null, user, { isNewUser });
      } catch (err) {
        console.error('❌ Error al autenticar con Google:', err);
        return done(err, null);
      }
    }
  )
);

// Serialización / sesión
passport.serializeUser((user, done) => {
  done(null, user._id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (err) {
    done(err, null);
  }
});

// Guard (por si lo usas en rutas)
module.exports.ensureAuthenticated = (req, res, next) => {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  return res.status(401).send('Necesitas iniciar sesión');
};
