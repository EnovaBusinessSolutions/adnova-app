'use strict';
const mongoose = require('mongoose');
const { Schema, model } = mongoose;

const schema = new Schema({
  user:   { type: Schema.Types.ObjectId, ref: 'User', index: true, required: true },
  rfc:    { type: String, trim: true, required: true },             // RFC del cliente
  name:   { type: String, trim: true, required: true },             // Razón social o nombre
  email:  { type: String, trim: true },                             
  cfdiUse:{ type: String, trim: true, default: process.env.FACTURAPI_DEFAULT_USE || 'G03' }, // Uso CFDI
  taxRegime: { type: String, trim: true }, // opcional si tu cliente lo pide
  zip: { type: String, trim: true },        // CP fiscal (recomendado por SAT)
  isCompany: { type: Boolean, default: false },                      // para saber si es empresa
  // auditoría
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = model('TaxProfile', schema);
