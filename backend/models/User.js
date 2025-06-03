const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: false },
  onboardingComplete: { type: Boolean, default: false },

  shop: { type: String, required: false, unique: true },
  shopifyAccessToken: { type: String },
  shopifyScopeHash: { type: String },
  shopifyScopeHashUpdatedAt: { type: Number },

  googleAccessToken: { type: String },
  googleRefreshToken: { type: String },
  googleConnected: { type: Boolean, default: false },

  metaConnected: { type: Boolean, default: false },
  metaAccessToken: { type: String }
});

module.exports = mongoose.model("User", userSchema);
