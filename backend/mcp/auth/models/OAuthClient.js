'use strict';

const mongoose = require('mongoose');
const { Schema, model, Types } = mongoose;

const OAuthClientSchema = new Schema(
  {
    clientId: { type: String, required: true, unique: true, index: true },
    clientSecret: { type: String, required: true },
    name: { type: String, required: true },
    redirectUris: { type: [String], default: [] },
    redirectUriPatterns: { type: [String], default: [] },
    scopes: { type: [String], default: ['read:ads_performance', 'read:shopify_orders'] },
    grantsAllowed: {
      type: [String],
      default: ['authorization_code', 'refresh_token', 'urn:ietf:params:oauth:grant-type:token-exchange'],
    },
    active: { type: Boolean, default: true },
  },
  { collection: 'oauth_clients', timestamps: true }
);

module.exports = mongoose.models.OAuthClient || model('OAuthClient', OAuthClientSchema);
