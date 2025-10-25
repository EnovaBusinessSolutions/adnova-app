'use strict';
const mongoose = require('mongoose');
const { Schema, model } = mongoose;

const TaxProfileSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', index: true, required: true, unique: true },
  rfc: { type: String, required: true, uppercase: true, trim: true },
  legal_name: { type: String, required: true, trim: true },
  tax_regime: { type: String, required: true }, // c_RegimenFiscal del receptor
  zip: { type: String, required: true },
  cfdi_use: { type: String, default: process.env.FACTURAPI_DEFAULT_USE || 'G03' },
  facturapi_customer_id: { type: String },
}, { timestamps: true });

module.exports = model('TaxProfile', TaxProfileSchema);
