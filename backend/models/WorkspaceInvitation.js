// backend/models/WorkspaceInvitation.js
'use strict';

const mongoose = require('mongoose');

const WORKSPACE_ROLES = ['ADMIN', 'MEMBER']; // OWNER no es invitable

const workspaceInvitationSchema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Workspace',
      required: true,
      index: true,
    },

    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },

    role: {
      type: String,
      enum: WORKSPACE_ROLES,
      default: 'MEMBER',
    },

    tokenHash: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    invitedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },

    acceptedAt: { type: Date, default: null },
    declinedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Para validar "una sola invitación activa por (workspace, email)" en código (Fase 3).
workspaceInvitationSchema.index({ workspaceId: 1, email: 1 });

workspaceInvitationSchema.statics.WORKSPACE_ROLES = WORKSPACE_ROLES;

module.exports = mongoose.model('WorkspaceInvitation', workspaceInvitationSchema);
