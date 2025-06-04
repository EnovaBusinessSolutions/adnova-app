const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: false },
  onboardingComplete: { type: Boolean, default: false },

  // ** shop ya existía para guardar "mi-tienda.myshopify.com" **
  shop: { type: String, required: false /* quitar unique */, },
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
