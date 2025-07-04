// backend/models/Audit.js
const { Schema, model, Types } = require('mongoose');

/* -------------------------------------------------------------------------- */
/*  Sub-schemas                                                               */
/* -------------------------------------------------------------------------- */
const IssueSchema = new Schema(
  {
    title:          { type: String, required: true },
    description:    { type: String, required: true },
    severity:       { type: String, enum: ['high', 'medium', 'low'], default: 'medium' },
    screenshot:     { type: String },   // URL (opcional)
    recommendation: { type: String }    // Texto (opcional)
  },
  { _id: false }
);

const ActionSchema = new Schema(
  {
    title:       { type: String, required: true },
    description: { type: String, required: true },
    severity:    { type: String, enum: ['high', 'medium', 'low'], default: 'medium' },
    button:      { type: String, default: 'Revisar' }
  },
  { _id: false }
);

const TopProductSchema = new Schema(
  {
    name:    { type: String, required: true },
    sales:   { type: Number, default: 0 },
    revenue: { type: Number }
  },
  { _id: false }
);

/* -------------------------------------------------------------------------- */
/*  Audit schema (principal)                                                  */
/* -------------------------------------------------------------------------- */
const AuditSchema = new Schema(
  {
    /* --- metadatos ------------------------------------------------------- */
    userId:     { type: Types.ObjectId, ref: 'User', required: true },
    shopDomain: { type: String },
    generatedAt:{ type: Date, default: Date.now },

    /* --- KPIs generales -------------------------------------------------- */
    salesLast30:   { type: Number },
    ordersLast30:  { type: Number },
    avgOrderValue: { type: Number },

    topProducts: [TopProductSchema],

    customerStats: {
      newPct:    { type: Number },
      repeatPct: { type: Number }
    },

    /* --- Centro de acciones (dashboard) ---------------------------------- */
    actionCenter: [ActionSchema],

    /* --- Issues (auditoría detallada) ------------------------------------ */
    issues: {
      /* NUEVO formato (GraphQL/IA 2024) */
      productos: [
        {
          nombre:     { type: String, required: true },
          hallazgos:  [IssueSchema]
        }
      ],

      /* Formato legacy (seguirán llegando mientras existan auditorías viejas) */
      ux:          [IssueSchema],
      seo:         [IssueSchema],
      performance: [IssueSchema],
      media:       [IssueSchema]
    }
  },
  /* ---------------------------------------------------------------------- */
  /*  Opciones del schema                                                   */
  /* ---------------------------------------------------------------------- */
  {
    strict: false,          // No descartes campos futuros
    timestamps: false       // Ya usamos generatedAt manual
  }
);

module.exports = model('Audit', AuditSchema);
