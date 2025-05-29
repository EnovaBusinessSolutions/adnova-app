// backend/models/User.js
const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: false },
  onboardingComplete: { type: Boolean, default: false },

  // Conexiones externas
  googleAccessToken: { type: String },
  googleRefreshToken: { type: String },
  googleConnected: { type: Boolean, default: false },
  metaConnected: { type: Boolean, default: false },
  metaAccessToken: { type: String },
  shopifyConnected: { type: Boolean, default: false } // 👈 sin coma aquí
});


module.exports = mongoose.model("User", userSchema);
 