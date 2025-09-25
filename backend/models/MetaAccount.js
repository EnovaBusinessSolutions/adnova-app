// backend/models/MetaAccount.js
'use strict';

const mongoose = require('mongoose');
const { Schema, model, Types } = mongoose;


const normActId = (s = '') => s.toString().replace(/^act_/, '').trim();
const normScopes = (v) =>
  Array.from(new Set((Array.isArray(v) ? v : [])
    .map(x => String(x || '').trim().toLowerCase())
    .filter(Boolean)));


const AdAccountSchema = new Schema(
  {
    id:              { type: String },               
    account_id:      { type: String },               
    name:            { type: String },
    account_name:    { type: String },
    account_status:  { type: Schema.Types.Mixed },
    configured_status:{ type: Schema.Types.Mixed },
    currency:        { type: String },
    account_currency:{ type: String },
    timezone_name:   { type: String },
    timezone:        { type: String },
  },
  { _id: false }
);


const MetaAccountSchema = new Schema(
  {
    
    user:   { type: Types.ObjectId, ref: 'User', index: true, sparse: true },
    userId: { type: Types.ObjectId, ref: 'User', index: true, sparse: true },

    
    access_token:   { type: String, select: false },
    token:          { type: String, select: false },
    longlivedToken: { type: String, select: false }, 
    accessToken:    { type: String, select: false }, 
    longLivedToken: { type: String, select: false }, 

    
    expires_at: { type: Date },
    expiresAt:  { type: Date },

    
    fb_user_id: { type: String },
    email:      { type: String },
    name:       { type: String },

    
    objective: {
      type: String,
      enum: ['ventas', 'alcance', 'leads'],
      default: null,
    },

    
    ad_accounts: { type: [AdAccountSchema], default: [] }, 
    adAccounts:  { type: [AdAccountSchema], default: [] }, 
    pages:       { type: Array, default: [] },

    
    scopes:      { type: [String], default: [], set: normScopes },

   
    defaultAccountId: {
      type: String,
      set: (v) => normActId(v),
    },

    
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  {
    collection: 'metaaccounts',
    toJSON: {
      transform(_doc, ret) {
        
        delete ret.access_token;
        delete ret.token;
        delete ret.longlivedToken;
        delete ret.accessToken;
        delete ret.longLivedToken;
        return ret;
      }
    },
    toObject: {
      transform(_doc, ret) {
        delete ret.access_token;
        delete ret.token;
        delete ret.longlivedToken;
        delete ret.accessToken;
        delete ret.longLivedToken;
        return ret;
      }
    }
  }
);


MetaAccountSchema.index({ user: 1   }, { unique: true, sparse: true });
MetaAccountSchema.index({ userId: 1 }, { unique: true, sparse: true });


MetaAccountSchema.virtual('accessTokenAny').get(function () {
  return this.longLivedToken || this.longlivedToken || this.access_token || this.accessToken || this.token || null;
});


MetaAccountSchema.methods.setTokens = function (value) {
  this.longLivedToken = value;
  this.longlivedToken = value;
  this.access_token   = value;
  this.accessToken    = value;
  this.token          = value;
  return this;
};


MetaAccountSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});


module.exports = mongoose.models.MetaAccount || model('MetaAccount', MetaAccountSchema);
