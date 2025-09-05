// backend/models/GoogleAccount.js
const mongoose = require('mongoose');

const GoogleAccountSchema = new mongoose.Schema({
  user:           { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true, unique: true },
  email:          { type: String, index: true },
  access_token:   { type: String, required: true, select: false },
  refresh_token:  { type: String, select: false },
  expires_at:     { type: Date },
  scopes:         { type: [String], default: [] },

  // datos opcionales de producto
  ga_property_id: { type: String },
  ads_customer_id:{ type: String },

  // tu configuración de onboarding
  objective:      { type: String, enum: ['ventas','alcance','leads'], default: null },

}, { timestamps: true });

module.exports = mongoose.model('GoogleAccount', GoogleAccountSchema);
