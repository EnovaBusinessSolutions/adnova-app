// backend/models/WorkspaceMember.js
'use strict';

const mongoose = require('mongoose');

const WORKSPACE_ROLES = ['OWNER', 'ADMIN', 'MEMBER'];
const MEMBER_STATUSES = ['ACTIVE', 'SUSPENDED', 'REMOVED'];

const workspaceMemberSchema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Workspace',
      required: true,
      index: true,
    },

    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    role: {
      type: String,
      enum: WORKSPACE_ROLES,
      default: 'MEMBER',
      required: true,
    },

    status: {
      type: String,
      enum: MEMBER_STATUSES,
      default: 'ACTIVE',
    },

    invitedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    invitedAt: { type: Date, default: null },
    joinedAt: { type: Date, default: Date.now },
    lastActiveAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Un user no puede ser miembro dos veces del mismo workspace.
workspaceMemberSchema.index({ workspaceId: 1, userId: 1 }, { unique: true });
// Para listar miembros por rol rápidamente.
workspaceMemberSchema.index({ workspaceId: 1, role: 1 });

workspaceMemberSchema.statics.WORKSPACE_ROLES = WORKSPACE_ROLES;
workspaceMemberSchema.statics.MEMBER_STATUSES = MEMBER_STATUSES;

module.exports = mongoose.model('WorkspaceMember', workspaceMemberSchema);
