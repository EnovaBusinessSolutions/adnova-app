// backend/auth.js
'use strict';

const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;

const User = require('./models/User');

// Detectar si estamos en desarrollo local
const IS_DEV = process.env.NODE_ENV !== 'production' && (
  !process.env.APP_URL || 
  process.env.APP_URL.includes('localhost') ||
  process.env.DEV_MODE === 'true'
);

const APP_URL = (process.env.APP_URL || 'https://adray.ai').replace(/\/$/, '');

// En desarrollo, usar localhost:3000 para el callback
const DEV_URL = 'http://localhost:3000';
const EFFECTIVE_URL = IS_DEV ? DEV_URL : APP_URL;

// IMPORTANTE: debe coincidir con tu ruta real en backend/index.js:
// app.get('/auth/google/login/callback', ...)
const DEFAULT_GOOGLE_LOGIN_CALLBACK = `${EFFECTIVE_URL}/auth/google/login/callback`;

// Puedes usar esta env si quieres controlarlo desde Render:
// GOOGLE_LOGIN_CALLBACK_URL=https://adray.ai/auth/google/login/callback
const GOOGLE_LOGIN_CALLBACK_URL =
  process.env.GOOGLE_LOGIN_CALLBACK_URL ||
  process.env.GOOGLE_CALLBACK_URL || // compat si ya la tienes
  DEFAULT_GOOGLE_LOGIN_CALLBACK;

// Log para debug
console.log(`[auth.js] IS_DEV=${IS_DEV}, Callback URL: ${GOOGLE_LOGIN_CALLBACK_URL}`);

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

            // Google ya viene verificado por Google
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
          if (trackEvent && user?._id) {
            const now = new Date();

            Promise.resolve()
              .then(() =>
                trackEvent({
                  name: 'user_signed_up',
                  userId: user._id,
                  dedupeKey: `user_signed_up:${user._id}`,
                  props: { method: 'google' },
                  ts: now,
                })
              )
              .catch(() => {});

            // ✅ Track email verified (Google signup => verificado)
            Promise.resolve()
              .then(() =>
                trackEvent({
                  name: 'email_verified',
                  userId: user._id,
                  dedupeKey: `email_verified:${user._id}`,
                  props: { method: 'google', reason: 'google_oauth' },
                  ts: now,
                })
              )
              .catch(() => {});
          }
        } else {
          // ✅ Usuario existente
          const patch = {};
          const shouldTrackEmailVerified = user.emailVerified === false;

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

          // ✅ Si venía sin verificar y ahora quedó verificado por Google, trackearlo (dedupe)
          if (trackEvent && shouldTrackEmailVerified && user?._id) {
            const now = new Date();
            Promise.resolve()
              .then(() =>
                trackEvent({
                  name: 'email_verified',
                  userId: user._id,
                  dedupeKey: `email_verified:${user._id}`,
                  props: { method: 'google', reason: 'google_oauth_existing_user' },
                  ts: now,
                })
              )
              .catch(() => {});
          }
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

          // A) ✅ RAW (1 evento por login) -> para “cuántos logins reales”
          // Importante: SIN dedupeKey => siempre crea un doc nuevo (más simple y correcto).
          Promise.resolve()
            .then(() =>
              trackEvent({
                name: 'user_login', // 👈 alias soportado en tu panel (user_login/login)
                userId: user._id,
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

          // B) ✅ STATE (1 doc por usuario por día) -> “último login” + contador diario
          Promise.resolve()
            .then(() =>
              trackEvent({
                name: 'user_logged_in', // 👈 evento STATE principal
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
                ts: now, // ✅ se actualiza en cada login
                inc: { count: 1 }, // ✅ contador diario
                setOnInsert: { firstTs: now }, // ✅ primer login del día
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
