// backend/models/CreativeSnapshot.js
'use strict';

const mongoose = require('mongoose');
const { Schema, model, Types } = mongoose;

/**
 * Sub-schema para métricas de un período
 */
const MetricsSchema = new Schema({
  spend:        { type: Number, default: 0 },
  impressions:  { type: Number, default: 0 },
  reach:        { type: Number, default: 0 },
  clicks:       { type: Number, default: 0 },
  ctr:          { type: Number, default: 0 },
  cpc:          { type: Number, default: null },
  cpm:          { type: Number, default: null },
  purchases:    { type: Number, default: 0 },
  revenue:      { type: Number, default: 0 },
  roas:         { type: Number, default: null },
  cpa:          { type: Number, default: null },
  leads:        { type: Number, default: 0 },
  cpl:          { type: Number, default: null },
  frequency:    { type: Number, default: null },
  thumbstop:    { type: Number, default: null },   // 3-sec video view rate
  holdRate:     { type: Number, default: null },   // avg video watch %
  hookRate:     { type: Number, default: null },   // clicks after 3-sec
}, { _id: false });

/**
 * Sub-schema para scores calculados
 */
const ScoresSchema = new Schema({
  value:        { type: Number, default: 0 },      // 0-100 (performance)
  risk:         { type: Number, default: 0 },      // 0-100 (fatigue/decay)
  alignment:    { type: Number, default: 50 },     // 0-100 (message alignment - MVP=50)
  total:        { type: Number, default: 0 },      // weighted average
}, { _id: false });

/**
 * Sub-schema para recomendaciones
 */
const RecommendationSchema = new Schema({
  id:           { type: String, required: true },
  category:     { type: String, enum: ['scale', 'optimize', 'alert', 'info'], default: 'info' },
  priority:     { type: Number, default: 50 },     // 0-100 (higher = more urgent)
  message:      { type: String, required: true },
  action:       { type: String },                  // suggested action
  checked:      { type: Boolean, default: false }, // user marked as done
  checkedAt:    { type: Date, default: null },
}, { _id: false });

/**
 * Main schema: CreativeSnapshot
 * One document per creative (ad_id) per user
 */
const CreativeSnapshotSchema = new Schema({
  // References
  user:             { type: Types.ObjectId, ref: 'User', index: true, required: true },
  metaAccountId:    { type: Types.ObjectId, ref: 'MetaAccount', index: true },
  adAccountId:      { type: String, index: true, required: true },  // e.g. "123456789"
  
  // Creative identifiers
  adId:             { type: String, required: true, index: true },
  adName:           { type: String },
  adsetId:          { type: String, index: true },
  adsetName:        { type: String },
  campaignId:       { type: String, index: true },
  campaignName:     { type: String },
  
  // Creative details
  creativeType:     { type: String, enum: ['image', 'video', 'carousel', 'collection', 'unknown'], default: 'unknown' },
  thumbnailUrl:     { type: String },
  previewUrl:       { type: String },
  effectiveStatus:  { type: String },  // ACTIVE, PAUSED, etc.
  
  // Objective context
  campaignObjective:     { type: String },  // original Meta objective
  campaignObjectiveNorm: { type: String, enum: ['SALES', 'LEADS', 'TRAFFIC', 'AWARENESS', 'ENGAGEMENT', 'MESSAGES', 'APP', 'OTHER'] },
  
  // User-selected objective (global or per-creative override)
  userObjective:    { type: String, enum: ['ventas', 'alcance', 'leads'], default: 'ventas' },
  objectiveOverride: { type: Boolean, default: false },  // true if user overrode global
  
  // Metrics: current period (last 7d by default)
  metrics:          { type: MetricsSchema, default: () => ({}) },
  
  // Metrics: previous period (for trend/delta)
  metricsPrev:      { type: MetricsSchema, default: () => ({}) },
  
  // Deltas (% change)
  deltas:           { type: Schema.Types.Mixed, default: {} },
  
  // Scores
  scores:           { type: ScoresSchema, default: () => ({}) },
  
  // Recommendations
  recommendations:  { type: [RecommendationSchema], default: [] },
  
  // Performance tier (derived from total score)
  tier:             { type: String, enum: ['star', 'good', 'average', 'poor', 'critical'], default: 'average' },
  
  // Time range of metrics
  dateRange:        {
    since: { type: String },
    until: { type: String },
  },
  
  // Sync timestamps
  lastSyncAt:       { type: Date, default: null },
  syncStatus:       { type: String, enum: ['pending', 'syncing', 'success', 'error'], default: 'pending' },
  syncError:        { type: String, default: null },
  
}, { timestamps: true });

// Compound index for fast lookups
CreativeSnapshotSchema.index({ user: 1, adAccountId: 1, adId: 1 }, { unique: true });
CreativeSnapshotSchema.index({ user: 1, adAccountId: 1, tier: 1 });
CreativeSnapshotSchema.index({ user: 1, adAccountId: 1, 'scores.total': -1 });

// Virtual for formatted score display
CreativeSnapshotSchema.virtual('scoreFormatted').get(function() {
  return Math.round(this.scores?.total || 0);
});

// Static method to get tier from score
CreativeSnapshotSchema.statics.getTierFromScore = function(score) {
  if (score >= 80) return 'star';
  if (score >= 65) return 'good';
  if (score >= 45) return 'average';
  if (score >= 25) return 'poor';
  return 'critical';
};

// Instance method to update tier
CreativeSnapshotSchema.methods.updateTier = function() {
  this.tier = this.constructor.getTierFromScore(this.scores?.total || 0);
  return this;
};

module.exports = mongoose.models.CreativeSnapshot || model('CreativeSnapshot', CreativeSnapshotSchema);
