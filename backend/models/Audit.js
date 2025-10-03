// backend/models/Audit.js
'use strict';

const mongoose = require('mongoose');
const { Schema, model, models, Types } = mongoose;

/* ---------------- helpers ---------------- */
const toSev = (s) => {
  const v = String(s || '').toLowerCase().trim();
  if (v === 'alta' || v === 'high') return 'alta';
  if (v === 'baja' || v === 'low')  return 'baja';
  return 'media';
};

// ⬅️  AÑADIMOS 'ga' PARA EVITAR EL 500 POR ENUM
const OK_TYPES = ['google', 'meta', 'shopify', 'ga', 'ga4'];
const OK_SEV   = ['alta', 'media', 'baja'];

const LinkSchema = new Schema(
  {
    label: { type: String, default: '' },
    url:   { type: String, default: '' },
  },
  { _id: false }
);

const IssueSchema = new Schema(
  {
    id:    { type: String, required: true },
    area:  { type: String, default: 'otros' }, // el dashboard lo tolera
    title: { type: String, required: true },

    // aceptar legacy y normalizar en pre('save')
    severity: { type: String, enum: [...OK_SEV, 'high', 'medium', 'low'], required: true },

    evidence:       { type: String, default: '' },
    metrics:        { type: Schema.Types.Mixed, default: {} },
    recommendation: { type: String, default: '' },

    // aceptar legacy y normalizar en pre('save')
    estimatedImpact:{ type: String, enum: ['alto','medio','bajo','high','medium','low'], default: 'medio' },

    blockers: { type: [String], default: [] },
    links:    { type: [LinkSchema], default: [] },
  },
  { _id: false }
);

const AuditSchema = new Schema(
  {
    userId: { type: Types.ObjectId, ref: 'User', index: true, required: true },

    // permite ga y ga4
    type:   { type: String, enum: OK_TYPES, index: true, required: true },

    generatedAt: { type: Date, default: Date.now, index: true },

    // compat: algunos flujos usan 'resumen'
    summary: { type: String, default: '' },
    resumen: { type: String, default: '' },

    // misma forma para issues y actionCenter
    issues:       { type: [IssueSchema], default: [] },
    actionCenter: { type: [IssueSchema], default: [] },

    // extras/legacy
    topProducts:   { type: Array,              default: [] },
    salesLast30:   { type: Number,             default: 0 },
    ordersLast30:  { type: Number,             default: 0 },
    avgOrderValue: { type: Number,             default: 0 },
    customerStats: { type: Schema.Types.Mixed, default: {} },

    // snapshot de entrada (colecciones crudas)
    inputSnapshot: { type: Schema.Types.Mixed, default: {} },

    version: { type: String, default: 'audits@1.1.1' },

    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { collection: 'audits' }
);

/* -------------- hooks -------------- */
AuditSchema.pre('save', function(next) {
  this.updatedAt = new Date();

  // sincroniza summary/resumen
  if (!this.summary && typeof this.resumen === 'string') this.summary = this.resumen;
  if (!this.resumen && typeof this.summary === 'string') this.resumen = this.summary;

  // normaliza severidades/impacto a alta/media/baja y alto/medio/bajo
  const normalizeIssues = (arr = []) =>
    arr.map((it) => ({
      ...it,
      severity: toSev(it?.severity),
      estimatedImpact:
        toSev(it?.estimatedImpact) === 'alta' ? 'alto' :
        toSev(it?.estimatedImpact) === 'baja' ? 'bajo' : 'medio',
    }));

  if (Array.isArray(this.issues))       this.issues       = normalizeIssues(this.issues);
  if (Array.isArray(this.actionCenter)) this.actionCenter = normalizeIssues(this.actionCenter);

  next();
});

/* -------------- índices -------------- */
AuditSchema.index({ userId: 1, type: 1, generatedAt: -1 });

module.exports = models.Audit || model('Audit', AuditSchema);
