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

            // Google ya viene verificado por Google (no tiene sentido bloquearlo)
            emailVerified: true,

            // Si tu login email/pass usa "password", dejarlo vacío está OK
            // (o puedes omitirlo, pero lo dejamos por compat con tu código)
            password: '',

            onboardingComplete: false,

            // ✅ CLAVE E2E: control del welcome
            welcomeEmailSent: false,
            welcomeEmailSentAt: null,
          });

          console.log('🆕 Usuario de Google creado en MongoDB:', normalizedEmail);
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
            // mantenemos el objeto user "actual" en memoria
            user = await User.findById(user._id);
          }

          console.log('✅ Usuario de Google ya registrado:', normalizedEmail);
        }

        // ✅ Extra: bandera “transiente” por si la quieres leer en index.js
        user._isNewUser = isNewUser;

        /**
         * ✅ ESTE es el cambio clave:
         * Mandamos "info.isNewUser" como 3er argumento de done()
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
