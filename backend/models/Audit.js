// backend/models/Audit.js
const mongoose = require('mongoose');

const IssueSchema = new mongoose.Schema({
  id:    { type: String, required: true },                // slug único
  area:  { type: String, default: 'otros' },              // relajamos: permite ux, seo, tracking, etc.
  title: { type: String, required: true },
  // aceptamos ambas convenciones (es/en) para no romper
  severity: { type: String, enum: ['alta','media','baja','high','medium','low'], required: true },

  evidence:        { type: String, default: '' },
  metrics:         { type: Object, default: {} },
  recommendation:  { type: String, default: '' },
  // aceptamos ambas aquí también
  estimatedImpact: { type: String, enum: ['alto','medio','bajo','high','medium','low'], default: 'medio' },
  blockers:        [{ type: String }],
  links:           [{ label: String, url: String }],
}, { _id: false });

/**
 * ActionCenter NO usa IssueSchema (no tiene id/area obligatorios).
 */
const ActionItemSchema = new mongoose.Schema({
  title:       { type: String, default: 'Acción recomendada' },
  description: { type: String, default: '' },
  // aceptamos ambas convenciones
  severity:    { type: String, enum: ['alta','media','baja','high','medium','low'], default: 'media' },
  button:      { type: String, default: null },
  estimated:   { type: String, default: null }, // o estimatedImpact si lo quieres duplicar
}, { _id: false });

const AuditSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true, required: true },

  // tipos que usamos en rutas
  type:   { type: String, enum: ['google','meta','shopify','ga'], index: true, required: true },

  generatedAt: { type: Date, default: Date.now, index: true },

  /**
   * Compatibilidad: algunas rutas usan "resumen", otras "summary".
   * Guardamos ambas para no romper nada; el front puede leer la que esté.
   */
  summary: { type: String, default: '' },
  resumen: { type: String, default: '' },

  // LISTA PLANA de issues normalizados
  issues:       { type: [IssueSchema], default: [] },

  // Centro de acciones simplificado
  actionCenter: { type: [ActionItemSchema], default: [] },

  // Datos extra opcionales
  topProducts:    { type: Array, default: [] },
  salesLast30:    { type: Number, default: 0 },
  ordersLast30:   { type: Number, default: 0 },
  avgOrderValue:  { type: Number, default: 0 },
  customerStats:  { type: Object, default: {} },

  // si quieres guardar el snapshot crudo o agregados para IA
  inputSnapshot:  { type: Object, default: {} },

  version: { type: String, default: 'audits@1.0.0' },
}, { collection: 'audits' });

module.exports = mongoose.models.Audit || mongoose.model('Audit', AuditSchema);
