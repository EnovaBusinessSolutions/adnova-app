// backend/models/MetaAccount.js
const mongoose = require('mongoose');

const MetaAccountSchema = new mongoose.Schema({
  user:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true, required: true },
  fb_user_id:{ type: String, index: true },
  name:      { type: String },
  email:     { type: String },

  access_token: { type: String, required: true, select: false },
  expires_at:   { type: Date },

  // NEW
  scopes:    [{ type: String }],
  objective: { type: String, enum: ['ventas','alcance','leads'], default: null },
  ad_accounts: [{ id: String, name: String }],
  pages:       [{ id: String, name: String }]
}, { timestamps: true });

MetaAccountSchema.index({ user: 1 }, { unique: true });

module.exports = mongoose.model('MetaAccount', MetaAccountSchema);
