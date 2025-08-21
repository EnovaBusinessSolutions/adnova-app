// backend/models/MetaAccount.js
const mongoose = require('mongoose');

const MetaAccountSchema = new mongoose.Schema(
  {
    user:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true, required: true },
    fb_user_id: { type: String, index: true },             // <-- ya no required
    name:       { type: String },
    email:      { type: String },
    access_token: { type: String, required: true, select: false }, // <-- protegido
    expires_at: { type: Date },
  },
  { timestamps: true }
);

// Si SOLO quieres 1 Meta por usuario:
MetaAccountSchema.index({ user: 1 }, { unique: true });

module.exports = mongoose.model('MetaAccount', MetaAccountSchema);
