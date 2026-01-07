// backend/models/Audit.js
'use strict';

const mongoose = require('mongoose');
const { Schema, model, models, Types } = mongoose;

/* ---------------- helpers ---------------- */
const toSev = (s) => {
  const v = String(s || '').toLowerCase().trim();
  if (v === 'alta' || v === 'high') return 'alta';
  if (v === 'baja' || v === 'low') return 'baja';
  return 'media';
};

// Áreas “oficiales” que usamos en la IA
const OK_AREAS = ['setup', 'performance', 'creative', 'tracking', 'budget', 'bidding', 'otros'];

// permitimos también 'ga' para docs legacy
const OK_TYPES = ['google', 'meta', 'shopify', 'ga', 'ga4'];
const OK_SEV = ['alta', 'media', 'baja'];

const LinkSchema = new Schema(
  {
    label: { type: String, default: '' },
    url: { type: String, default: '' },
  },
  { _id: false }
);

// Referencia a cuenta (Ads y GA4)
const AccountRefSchema = new Schema(
  {
    id: { type: String, default: '' },       // customerId / act_ / propertyId
    name: { type: String, default: '' },     // nombre de cuenta/propiedad
    property: { type: String, default: '' }, // para GA4 (opcional)
  },
  { _id: false }
);

// Referencia a campaña (Google / Meta)
const CampaignRefSchema = new Schema(
  {
    id: { type: String, default: '' },
    name: { type: String, default: '' },
  },
  { _id: false }
);

// Referencia a segmento (ej. canal en GA4)
const SegmentRefSchema = new Schema(
  {
    type: { type: String, default: '' }, // ej. "channel"
    name: { type: String, default: '' }, // ej. "Paid Search"
  },
  { _id: false }
);

const IssueSchema = new Schema(
  {
    id: { type: String, required: true },
    area: { type: String, default: 'otros' }, // el dashboard lo tolera

    title: { type: String, required: true },

    // aceptar legacy y normalizar en pre('save')
    severity: {
      type: String,
      enum: [...OK_SEV, 'high', 'medium', 'low'],
      required: true,
    },

    evidence: { type: String, default: '' },
    metrics: { type: Schema.Types.Mixed, default: {} },
    recommendation: { type: String, default: '' },

    // aceptar legacy y normalizar en pre('save')
    estimatedImpact: {
      type: String,
      enum: ['alto', 'medio', 'bajo', 'high', 'medium', 'low'],
      default: 'medio',
    },

    // Referencias ricas para UI / análisis
    accountRef: { type: AccountRefSchema, default: null },
    campaignRef: { type: CampaignRefSchema, default: null },
    segmentRef: { type: SegmentRefSchema, default: null },

    blockers: { type: [String], default: [] },
    links: { type: [LinkSchema], default: [] },
  },
  { _id: false }
);

/**
 * ✅ NUEVO: estado de notificaciones (email “auditoría lista”)
 * - Sirve para NO duplicar envíos
 * - Nos deja trazabilidad (messageId, to, error)
 */
const NotificationSchema = new Schema(
  {
    auditReadyEmailSentAt: { type: Date, default: null, index: true },
    auditReadyEmailTo: { type: String, default: '' },
    auditReadyEmailMessageId: { type: String, default: '' },

    auditReadyEmailAttempts: { type: Number, default: 0 },
    auditReadyEmailLastError: { type: String, default: '' },
  },
  { _id: false }
);

const AuditSchema = new Schema(
  {
    userId: { type: Types.ObjectId, ref: 'User', index: true, required: true },

    // permite ga y ga4 (ga es legacy)
    type: { type: String, enum: OK_TYPES, index: true, required: true },

    generatedAt: { type: Date, default: Date.now, index: true },

    // De dónde salió la auditoría (onboarding, panel, manual)
    origin: {
      type: String,
      enum: ['manual', 'onboarding', 'panel'],
      default: 'manual',
      index: true,
    },

    // Plan del usuario al momento de generar la auditoría
    plan: { type: String, default: 'gratis', index: true },

    // Máx. de hallazgos que se pidió a la IA para esta ejecución
    maxFindings: { type: Number, default: 5 },

    // compat: algunos flujos usan 'resumen'
    summary: { type: String, default: '' },
    resumen: { type: String, default: '' },

    // misma forma para issues y actionCenter
    issues: { type: [IssueSchema], default: [] },
    actionCenter: { type: [IssueSchema], default: [] },

    // extras/legacy (principalmente Shopify / e-commerce)
    topProducts: { type: Array, default: [] },
    salesLast30: { type: Number, default: 0 },
    ordersLast30: { type: Number, default: 0 },
    avgOrderValue: { type: Number, default: 0 },
    customerStats: { type: Schema.Types.Mixed, default: {} },

    // snapshot de entrada (colecciones crudas)
    inputSnapshot: { type: Schema.Types.Mixed, default: {} },

    // Versión de la “lógica” de auditoría
    version: { type: String, default: 'audits@1.2.0' },

    // NUEVO: resumen de tendencias entre auditoría anterior y actual
    trendSummary: { type: Schema.Types.Mixed, default: null },

    // ✅ NUEVO: notificaciones (para E2E del correo “Auditoría lista”)
    notifications: { type: NotificationSchema, default: () => ({}) },

    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { collection: 'audits' }
);

/* -------------- hooks -------------- */
AuditSchema.pre('save', function (next) {
  this.updatedAt = new Date();

  // sincroniza summary/resumen
  if (!this.summary && typeof this.resumen === 'string') this.summary = this.resumen;
  if (!this.resumen && typeof this.summary === 'string') this.resumen = this.summary;

  const toArea = (a) => {
    const v = String(a || '').toLowerCase().trim();
    return OK_AREAS.includes(v) ? v : 'otros';
  };

  // normaliza severidades/impacto a alta/media/baja y alto/medio/bajo
  const normalizeIssues = (arr = []) =>
    arr.map((it) => {
      const sev = toSev(it?.severity);
      const impSev = toSev(it?.estimatedImpact);
      return {
        ...it,
        area: toArea(it?.area),
        severity: sev,
        estimatedImpact:
          impSev === 'alta' ? 'alto' : impSev === 'baja' ? 'bajo' : 'medio',
      };
    });

  if (Array.isArray(this.issues)) this.issues = normalizeIssues(this.issues);
  if (Array.isArray(this.actionCenter)) this.actionCenter = normalizeIssues(this.actionCenter);

  // ✅ Asegura estructura notificaciones (por si docs legacy no la traen)
  if (!this.notifications) this.notifications = {};
  if (typeof this.notifications.auditReadyEmailAttempts !== 'number') {
    this.notifications.auditReadyEmailAttempts = 0;
  }

  next();
});

/* -------------- índices -------------- */
AuditSchema.index({ userId: 1, type: 1, generatedAt: -1 });

// ✅ Útil para encontrar rápido la “última auditoría no notificada”
AuditSchema.index({
  userId: 1,
  'notifications.auditReadyEmailSentAt': 1,
  generatedAt: -1,
});

module.exports = models.Audit || model('Audit', AuditSchema);
