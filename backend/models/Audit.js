// backend/models/Audit.js
const mongoose = require('mongoose');

const IssueSchema = new mongoose.Schema({
  id:    { type: String, required: true },               
  area:  { type: String, default: 'otros' },              
  title: { type: String, required: true },
  
  severity: { type: String, enum: ['alta','media','baja','high','medium','low'], required: true },

  evidence:        { type: String, default: '' },
  metrics:         { type: Object, default: {} },
  recommendation:  { type: String, default: '' },
  
  estimatedImpact: { type: String, enum: ['alto','medio','bajo','high','medium','low'], default: 'medio' },
  blockers:        [{ type: String }],
  links:           [{ label: String, url: String }],
}, { _id: false });


const ActionItemSchema = new mongoose.Schema({
  title:       { type: String, default: 'Acción recomendada' },
  description: { type: String, default: '' },
  
  severity:    { type: String, enum: ['alta','media','baja','high','medium','low'], default: 'media' },
  button:      { type: String, default: null },
  estimated:   { type: String, default: null }, 
}, { _id: false });

const AuditSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true, required: true },

  
  type:   { type: String, enum: ['google','meta','shopify','ga'], index: true, required: true },

  generatedAt: { type: Date, default: Date.now, index: true },

  
  summary: { type: String, default: '' },
  resumen: { type: String, default: '' },

  
  issues:       { type: [IssueSchema], default: [] },

  
  actionCenter: { type: [ActionItemSchema], default: [] },

  
  topProducts:    { type: Array, default: [] },
  salesLast30:    { type: Number, default: 0 },
  ordersLast30:   { type: Number, default: 0 },
  avgOrderValue:  { type: Number, default: 0 },
  customerStats:  { type: Object, default: {} },

  
  inputSnapshot:  { type: Object, default: {} },

  version: { type: String, default: 'audits@1.0.0' },
}, { collection: 'audits' });

module.exports = mongoose.models.Audit || mongoose.model('Audit', AuditSchema);
