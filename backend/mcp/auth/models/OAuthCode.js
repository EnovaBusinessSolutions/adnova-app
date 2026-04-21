'use strict';

const mongoose = require('mongoose');
const { Schema, model, Types } = mongoose;

const OAuthCodeSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, index: true },
    userId: { type: Types.ObjectId, ref: 'User', required: true },
    clientId: { type: String, required: true },
    redirectUri: { type: String, required: true },
    scopes: { type: [String], default: [] },
    codeChallenge: { type: String, default: null },
    codeChallengeMethod: { type: String, default: null },
    // RFC 8707 Resource Indicator. Optional — legacy codes without this still
    // work. When set, it is the canonical URI of the resource server (e.g.
    // "https://adray.ai/mcp") the client will call with the issued token.
    resource: { type: String, default: null },
    expiresAt: { type: Date, required: true },
    used: { type: Boolean, default: false },
  },
  { collection: 'oauth_codes', timestamps: true }
);

OAuthCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.models.OAuthCode || model('OAuthCode', OAuthCodeSchema);
