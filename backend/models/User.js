// backend/models/User.js
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  email:          { type: String, required: true, unique: true, index: true, lowercase: true, trim: true },
  password:       { type: String },

  onboardingComplete: { type: Boolean, default: false },

  shop:                 { type: String },
  shopifyConnected:     { type: Boolean, default: false },
  shopifyAccessToken:   { type: String },
  shopifyScopeHash:     { type: Number },
  shopifyScopeHashUpdatedAt: { type: Number },

  googleAccessToken:  { type: String },
  googleRefreshToken: { type: String },
  googleConnected:    { type: Boolean, default: false },

  metaConnected:    { type: Boolean, default: false },
  metaAccessToken:  { type: String },

  resetPasswordToken:  { type: String },
  resetPasswordExpires:{ type: Date },
  stripeCustomerId: { type: String }, 
  plan: {
    type: String,
    enum: ['gratis', 'emprendedor', 'crecimiento', 'pro', 'enterprise'], 
    default: 'gratis',
    index: true
  },
  planStartedAt: { type: Date, default: Date.now },
  subscription: {
    status:            { type: String, default: 'inactive' }, 
    priceId:           { type: String },
    plan:              { type: String, enum: ['emprendedor','crecimiento','pro','enterprise'] },
    currentPeriodEnd:  { type: Date }
  }

}, { timestamps: true }); 

userSchema.index({ plan: 1 });

module.exports = mongoose.model('User', userSchema);
