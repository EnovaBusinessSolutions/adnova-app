// models/Audit.js
const mongoose = require('mongoose');

const IssueSchema = new mongoose.Schema({
  id: { type: String, required: true },     // slug único
  area: { type: String, enum: ['setup','performance','creative','tracking','budget','bidding'], required: true },
  title: { type: String, required: true },
  severity: { type: String, enum: ['alta','media','baja'], required: true },
  evidence: { type: String, default: '' },
  metrics: { type: Object, default: {} },
  recommendation: { type: String, default: '' },
  estimatedImpact: { type: String, enum: ['alto','medio','bajo'], default: 'medio' },
  blockers: [{ type: String }],
  links: [{ label: String, url: String }],
}, { _id: false });

const AuditSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, index: true, required: true },
  type: { type: String, enum: ['google','meta','shopify','ga'], required: true },
  generatedAt: { type: Date, default: Date.now, index: true },
  summary: { type: String, default: '' },
  issues: { type: [IssueSchema], default: [] },
  actionCenter: { type: [IssueSchema], default: [] }, // top 3
  topProducts: { type: Array, default: [] },
  inputSnapshot: { type: Object, default: {} },       // datos crudos usados
  version: { type: String, default: 'audits@1.0.0' },
}, { collection: 'audits' });

module.exports = mongoose.models.Audit || mongoose.model('Audit', AuditSchema);
