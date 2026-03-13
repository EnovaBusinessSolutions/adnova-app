'use strict';

const mongoose = require('mongoose');
const { Schema, model, Types } = mongoose;

const OAuthTokenSchema = new Schema(
  {
    accessToken: { type: String, required: true, unique: true, index: true },
    refreshToken: { type: String, unique: true, sparse: true, index: true },
    userId: { type: Types.ObjectId, ref: 'User', required: true, index: true },
    clientId: { type: String, required: true, index: true },
    scopes: { type: [String], default: [] },
    accessTokenExpiresAt: { type: Date, required: true },
    refreshTokenExpiresAt: { type: Date },
    revoked: { type: Boolean, default: false },
  },
  { collection: 'oauth_tokens', timestamps: true }
);

OAuthTokenSchema.index({ accessTokenExpiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.models.OAuthToken || model('OAuthToken', OAuthTokenSchema);
