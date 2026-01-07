// backend/auth.js
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;

const User = require('./models/User');

// Email service
const { sendWelcomeEmail } = require('./services/emailService');

const APP_URL = (process.env.APP_URL || 'https://adray.ai').replace(/\/$/, '');

// IMPORTANTE: debe coincidir con tu ruta real en backend/index.js:
// app.get('/auth/google/login/callback', ...)
const DEFAULT_GOOGLE_LOGIN_CALLBACK = `${APP_URL}/auth/google/login/callback`;

// Puedes usar esta env si quieres controlarlo desde Render:
// GOOGLE_LOGIN_CALLBACK_URL=https://adray.ai/auth/google/login/callback
const GOOGLE_LOGIN_CALLBACK_URL =
  process.env.GOOGLE_LOGIN_CALLBACK_URL ||
  process.env.GOOGLE_CALLBACK_URL || // por compatibilidad si ya la tienes
  DEFAULT_GOOGLE_LOGIN_CALLBACK;

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: GOOGLE_LOGIN_CALLBACK_URL,

      // ✅ para poder setear flags en req.session dentro del strategy
      passReqToCallback: true,
    },
    async (req, accessToken, refreshToken, profile, done) => {
      try {
        // ✅ Email robusto
        const email =
          (profile && profile.emails && profile.emails[0] && profile.emails[0].value
            ? String(profile.emails[0].value)
            : '') || '';

        const normalizedEmail = email.trim().toLowerCase();

        // ✅ Nombre robusto
        const name =
          (profile && profile.displayName ? String(profile.displayName) : '') ||
          (profile && profile.name && profile.name.givenName
            ? String(profile.name.givenName)
            : '') ||
          'Usuario';

        // Si no hay email, NO intentes enviar welcome ni crear usuario (evita "No recipients defined")
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

          user = await User.create({
            googleId: profile.id,
            name,
            email: normalizedEmail,

            // ✅ si tu schema lo soporta:
            emailVerified: true,

            // Evita guardar password vacío si tu lógica no lo necesita
            password: '',

            onboardingComplete: false,
          });

          console.log('🆕 Usuario de Google creado en MongoDB:', normalizedEmail);
        } else {
          // Si existía pero no tenía googleId/emailVerified, lo actualizamos suavemente
          const patch = {};
          if (!user.googleId) patch.googleId = profile.id;
          if (user.emailVerified === false) patch.emailVerified = true;
          if (!user.name && name) patch.name = name;

          if (Object.keys(patch).length) {
            await User.updateOne({ _id: user._id }, { $set: patch });
          }

          console.log('✅ Usuario de Google ya registrado:', normalizedEmail);
        }

        // ✅ Bandera para enviar welcome justo en el callback route (entre Google → onboarding)
        // La idea es: index.js (callback) lee esto, manda email, borra flag y redirige.
        if (req?.session) {
          req.session.googleWelcome = {
            shouldSend: isNewUser === true,
            toEmail: normalizedEmail,
            name,
            ts: Date.now(),
          };
        }

        return done(null, user);
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

// ✅ Helper opcional para usar en index.js callback
// (si ya lo implementaste allá, puedes ignorarlo)
module.exports.consumeGoogleWelcomeFlagAndSend = async (req) => {
  try {
    const flag = req?.session?.googleWelcome;
    if (!flag || !flag.shouldSend) return { sent: false, reason: 'no-flag' };

    const toEmail = String(flag.toEmail || '').trim();
    const name = String(flag.name || 'Usuario').trim();

    // Evita el error "No recipients defined"
    if (!toEmail) return { sent: false, reason: 'missing-toEmail' };

    await sendWelcomeEmail({ toEmail, name });

    // Limpia flag para no duplicar
    req.session.googleWelcome = { shouldSend: false };

    console.log('✅ Welcome email enviado a:', toEmail);
    return { sent: true };
  } catch (e) {
    console.error('❌ Welcome email (Google) falló:', e?.message || e);
    return { sent: false, reason: 'send-failed' };
  }
};
