'use strict';

const mongoose = require('mongoose');
const { Schema, model, Types } = mongoose;


const stripDashes = (s = '') => s.toString().replace(/-/g, '').trim();
const normScopes = (v) => {
  if (!v) return [];
  if (Array.isArray(v)) {
    return Array.from(
      new Set(v.map(x => String(x || '').trim().toLowerCase()).filter(Boolean))
    );
  }
  
  return Array.from(
    new Set(
      String(v)
        .split(/\s+/)
        .map(x => x.trim().toLowerCase())
        .filter(Boolean)
    )
  );
};


const CustomerSchema = new Schema(
  {
    id: {
      type: String,
      set: (v) => stripDashes(v),            
    },
    resourceName: String,                      
    descriptiveName: String,                   
    currencyCode: String,                     
    timeZone: String,                          
  },
  { _id: false }
);


const GoogleAccountSchema = new Schema(
  {
    
    user:   { type: Types.ObjectId, ref: 'User', index: true, sparse: true },
    userId: { type: Types.ObjectId, ref: 'User', index: true, sparse: true },

    
    accessToken:  { type: String, select: false },
    refreshToken: { type: String, select: false },
    scope:        {
      type: [String],
      default: [],
      set: normScopes,                        
    },
    expiresAt:    { type: Date },

    
    managerCustomerId: {
      type: String,
      set: (v) => stripDashes(v),
    },

    
    customers:         { type: [CustomerSchema], default: [] },
    defaultCustomerId: {
      type: String,                           
      set: (v) => stripDashes(v),
    },

    
    objective: {
      type: String,
      enum: ['ventas', 'alcance', 'leads'],
      default: null,
    },

    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  {
    collection: 'googleaccounts',
    toJSON: {
      transform(_doc, ret) {
        delete ret.accessToken;
        delete ret.refreshToken;
        return ret;
      }
    },
    toObject: {
      transform(_doc, ret) {
        delete ret.accessToken;
        delete ret.refreshToken;
        return ret;
      }
    }
  }
);


GoogleAccountSchema.index({ user: 1   }, { unique: true, sparse: true });
GoogleAccountSchema.index({ userId: 1 }, { unique: true, sparse: true });


GoogleAccountSchema.virtual('hasRefresh').get(function () {
  return !!this.refreshToken;
});


GoogleAccountSchema.methods.setTokens = function ({
  access_token,
  refresh_token,
  expires_at,
  scope
} = {}) {
  if (access_token !== undefined) this.accessToken = access_token;
  if (refresh_token !== undefined) this.refreshToken = refresh_token;
  if (expires_at !== undefined)    this.expiresAt   = expires_at instanceof Date ? expires_at : new Date(expires_at);
  if (scope !== undefined)         this.scope       = normScopes(scope);
  return this;
};


GoogleAccountSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  
  if (Array.isArray(this.customers)) {
    this.customers = this.customers.map(c => ({
      ...c,
      id: stripDashes(c?.id),
      resourceName: c?.resourceName,
      descriptiveName: c?.descriptiveName,
      currencyCode: c?.currencyCode,
      timeZone: c?.timeZone,
    }));
  }
  next();
});


module.exports =
  mongoose.models.GoogleAccount || model('GoogleAccount', GoogleAccountSchema);
