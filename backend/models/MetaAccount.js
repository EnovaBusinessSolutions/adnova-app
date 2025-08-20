// backend/models/MetaAccount.js
const mongoose = require('mongoose');

const MetaAccountSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true, default: null },
    fb_user_id: { type: String, required: true, index: true },
    name: String,
    email: String,
    access_token: { type: String, required: true },
    expires_at: Date,
  },
  { timestamps: true }
);

MetaAccountSchema.index({ user: 1, fb_user_id: 1 }, { unique: true });

module.exports = mongoose.model('MetaAccount', MetaAccountSchema);
