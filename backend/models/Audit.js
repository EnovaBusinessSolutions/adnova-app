// backend/models/Audit.js
const { Schema, model, Types } = require('mongoose');

const IssueSchema = new Schema(
  {
    title:          { type: String, required: true },
    description:    { type: String, required: true },
    severity:       { type: String, enum: ['high', 'medium', 'low'], default: 'medium' },
    screenshot:     { type: String },   
    recommendation: { type: String }    
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

const AuditSchema = new Schema(
  {
    
    userId:     { type: Types.ObjectId, ref: 'User', required: true },
    shopDomain: { type: String },
    generatedAt:{ type: Date, default: Date.now },

  
    salesLast30:   { type: Number },
    ordersLast30:  { type: Number },
    avgOrderValue: { type: Number },

    topProducts: [TopProductSchema],

    customerStats: {
      newPct:    { type: Number },
      repeatPct: { type: Number }
    },

    actionCenter: [ActionSchema],

    issues: {
      
      productos: [
        {
          nombre:     { type: String, required: true },
          hallazgos:  [IssueSchema]
        }
      ],

     
      ux:          [IssueSchema],
      seo:         [IssueSchema],
      performance: [IssueSchema],
      media:       [IssueSchema]
    }
  },

  {
    strict: false,          
    timestamps: false       
  }
);

module.exports = model('Audit', AuditSchema);
