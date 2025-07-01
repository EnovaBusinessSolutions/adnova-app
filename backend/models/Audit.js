// backend/models/Audit.js
const { Schema, model, Types } = require('mongoose');

const IssueSchema = new Schema({
  title:         { type: String, required: true },
  description:   { type: String, required: true },
  severity:      { type: String, enum: ['high', 'medium', 'low'], default: 'medium' },
  screenshot:    { type: String },    // URL (opcional)
  recommendation:{ type: String },    // (opcional)
}, { _id: false });

const ActionSchema = new Schema({
  title:        { type: String, required: true },
  description:  { type: String, required: true },
  severity:     { type: String, enum: ['high', 'medium', 'low'], default: 'medium' },
  button:       { type: String, default: 'Revisar' }
}, { _id: false });

const TopProductSchema = new Schema({
  name:     { type: String, required: true },
  sales:    { type: Number, default: 0 },
  revenue:  { type: Number }
}, { _id: false });

const AuditSchema = new Schema({
  userId:      { type: Types.ObjectId, ref: 'User', required: true },
  shopDomain:  { type: String },
  generatedAt: { type: Date, default: Date.now },

  // Métricas generales
  salesLast30:    { type: Number },
  ordersLast30:   { type: Number },
  avgOrderValue:  { type: Number },

  topProducts:    [TopProductSchema], // Array de productos top

  customerStats: {
    newPct:      { type: Number },
    repeatPct:   { type: Number },
  },

  // Action center para dashboard (opcional)
  actionCenter: [ActionSchema],

  // Issues para auditoría detallada
  issues: {
    ux:          [IssueSchema],
    seo:         [IssueSchema],
    performance: [IssueSchema],
    media:       [IssueSchema],
  }
});

module.exports = model('Audit', AuditSchema);
