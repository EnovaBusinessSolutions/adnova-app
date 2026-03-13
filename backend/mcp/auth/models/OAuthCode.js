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
    expiresAt: { type: Date, required: true },
    used: { type: Boolean, default: false },
  },
  { collection: 'oauth_codes', timestamps: true }
);

OAuthCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.models.OAuthCode || model('OAuthCode', OAuthCodeSchema);
