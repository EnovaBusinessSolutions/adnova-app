const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const User = require('./models/User'); // 👈 importante

passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: "https://adnova-app.onrender.com/auth/google/callback"
}, async (accessToken, refreshToken, profile, done) => {
  try {
    const email = profile.emails[0].value;
    let user = await User.findOne({ email });

    if (!user) {
      user = await User.create({
        googleId: profile.id,
        email,
        password: '', // no tiene password
        onboardingComplete: false
      });
      console.log('🆕 Usuario de Google creado en MongoDB:', email);
    } else {
      console.log('✅ Usuario de Google ya registrado:', email);
    }

    return done(null, user);
  } catch (err) {
    console.error('❌ Error al autenticar con Google:', err);
    return done(err, null);
  }
}));

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
