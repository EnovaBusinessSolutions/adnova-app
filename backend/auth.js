const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const User = require('./models/User');

/**
 * auth.js
 * - Google OAuth: crea o vincula usuario por email
 * - Marca si es "nuevo" para que index.js pueda mandar Welcome Email una sola vez
 */

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      // OJO: tu index.js usa /auth/google/login/callback
      // Asegúrate que GOOGLE_CALLBACK_URL apunte a: https://adray.ai/auth/google/login/callback
      callbackURL: process.env.GOOGLE_CALLBACK_URL || '/auth/google/login/callback',
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const rawEmail = profile?.emails?.[0]?.value || '';
        const email = String(rawEmail).trim().toLowerCase();
        const googleId = String(profile?.id || '').trim();

        if (!email || !googleId) {
          console.error('❌ Google auth: faltó email o googleId', { email, googleId });
          return done(null, false, { message: 'No se pudo obtener el email de Google' });
        }

        let user = null;
        let isNewUser = false;

        // 1) Prioridad: si ya existe por googleId
        user = await User.findOne({ googleId });

        if (!user) {
          // 2) Si no existe por googleId, buscamos por email
          user = await User.findOne({ email });

          if (user) {
            // ✅ Caso: usuario ya existía (ej. registro con password) y ahora conecta Google
            // Vinculamos googleId para que a futuro se autentique por googleId
            user.googleId = googleId;

            // Si tu schema tiene emailVerified, Google ya valida email:
            if (typeof user.emailVerified === 'boolean') {
              user.emailVerified = true;
            }

            // También puedes actualizar nombre si está vacío
            if (!user.name && profile?.displayName) {
              user.name = profile.displayName;
            }

            await user.save();
            isNewUser = false;

            console.log('🔗 Usuario existente vinculado a Google:', email);
          } else {
            // ✅ Caso: usuario nuevo creado por Google
            const name = profile?.displayName || email.split('@')[0] || 'Usuario';

            user = await User.create({
              googleId,
              name,
              email,
              onboardingComplete: false,

              // Si existe en tu schema, marcar como verificado
              ...(User.schema?.paths?.emailVerified ? { emailVerified: true } : {}),
            });

            isNewUser = true;
            console.log('🆕 Usuario de Google creado en MongoDB:', email);
          }
        } else {
          console.log('✅ Usuario Google encontrado por googleId:', email);
        }

        // ✅ Para que index.js pueda detectar si es nuevo
        user._isNewUser = isNewUser;

        // Passport permite pasar "info" como 3er argumento:
        return done(null, user, { isNewUser });
      } catch (err) {
        console.error('❌ Error al autenticar con Google:', err);
        return done(err, null);
      }
    }
  )
);

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

module.exports.ensureAuthenticated = (req, res, next) => {
  if (req.isAuthenticated && req.isAuthenticated()) {
    return next();
  }
  return res.status(401).send('Necesitas iniciar sesión');
};
