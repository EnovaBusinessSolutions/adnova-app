// backend/routes/workspaces.js
'use strict';

const express = require('express');
const mongoose = require('mongoose');

const { ensureAuthenticated } = require('../auth');
const resolveWorkspace = require('../middlewares/resolveWorkspace');
const requirePermission = require('../middlewares/requirePermission');

const Workspace = require('../models/Workspace');
const WorkspaceMember = require('../models/WorkspaceMember');
const User = require('../models/User');

const workspaceService = require('../services/workspaceService');

const router = express.Router();

/* ============================================================
 * POST /api/workspaces
 * Crea un workspace nuevo. El usuario actual queda como OWNER.
 * ============================================================ */
router.post('/api/workspaces', ensureAuthenticated, async (req, res) => {
  try {
    const { name, slug, icon, industryVertical } = req.body || {};

    const result = await workspaceService.createWorkspaceForUser({
      user: req.user,
      payload: { name, slug, icon, industryVertical },
    });

    return res.status(201).json({
      workspace: result.workspace,
      membership: result.membership,
    });
  } catch (err) {
    if (err.code === 'NAME_REQUIRED') return res.status(400).json({ error: 'NAME_REQUIRED' });
    if (err.code === 'NAME_TOO_LONG') return res.status(400).json({ error: 'NAME_TOO_LONG' });
    if (err.code === 'SLUG_INVALID') return res.status(400).json({ error: 'SLUG_INVALID' });
    if (err.code === 'SLUG_TOO_LONG') return res.status(400).json({ error: 'SLUG_TOO_LONG' });
    if (err.code === 'SLUG_RESERVED') return res.status(400).json({ error: 'SLUG_RESERVED' });
    if (err.code === 'SLUG_TAKEN') return res.status(409).json({ error: 'SLUG_TAKEN' });
    console.error('[POST /api/workspaces]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

/* ============================================================
 * GET /api/workspaces/:id
 * ============================================================ */
router.get(
  '/api/workspaces/:id',
  ensureAuthenticated,
  resolveWorkspace,
  requirePermission('workspace.view'),
  async (req, res) => {
    return res.json({ workspace: req.workspace, membership: req.workspaceMembership });
  }
);

/* ============================================================
 * PATCH /api/workspaces/:id
 * Body parcial: { name?, slug?, icon?, industryVertical? }
 * Cada campo requiere su permission específico.
 * ============================================================ */
router.patch(
  '/api/workspaces/:id',
  ensureAuthenticated,
  resolveWorkspace,
  async (req, res) => {
    try {
      const { canDo } = require('../config/permissions');
      const role = req.workspaceMembership.role;
      const { name, slug, icon, industryVertical } = req.body || {};
      const updates = {};

      if (typeof name === 'string') {
        if (!canDo(role, 'workspace.update.name')) {
          return res.status(403).json({ error: 'INSUFFICIENT_PERMISSION', action: 'workspace.update.name', userRole: role });
        }
        const trimmed = name.trim();
        if (!trimmed) return res.status(400).json({ error: 'NAME_REQUIRED' });
        if (trimmed.length > 64) return res.status(400).json({ error: 'NAME_TOO_LONG' });
        updates.name = trimmed;
      }

      if (typeof slug === 'string') {
        if (!canDo(role, 'workspace.update.slug')) {
          return res.status(403).json({ error: 'INSUFFICIENT_PERMISSION', action: 'workspace.update.slug', userRole: role });
        }
        try {
          await workspaceService.validateSlug(slug);
        } catch (err) {
          if (err.code === 'SLUG_INVALID') return res.status(400).json({ error: 'SLUG_INVALID' });
          if (err.code === 'SLUG_TOO_LONG') return res.status(400).json({ error: 'SLUG_TOO_LONG' });
          if (err.code === 'SLUG_RESERVED') return res.status(400).json({ error: 'SLUG_RESERVED' });
          if (err.code === 'SLUG_TAKEN') return res.status(409).json({ error: 'SLUG_TAKEN' });
          throw err;
        }
        updates.slug = slug;
      }

      if (typeof icon === 'string') {
        if (!canDo(role, 'workspace.update.icon')) {
          return res.status(403).json({ error: 'INSUFFICIENT_PERMISSION', action: 'workspace.update.icon', userRole: role });
        }
        if (!Workspace.WORKSPACE_ICONS.includes(icon)) {
          return res.status(400).json({ error: 'ICON_INVALID' });
        }
        updates.icon = icon;
      }

      if (industryVertical !== undefined) {
        if (!canDo(role, 'workspace.update.industry')) {
          return res.status(403).json({ error: 'INSUFFICIENT_PERMISSION', action: 'workspace.update.industry', userRole: role });
        }
        if (industryVertical !== null && !Workspace.INDUSTRY_VERTICALS.includes(industryVertical)) {
          return res.status(400).json({ error: 'INDUSTRY_VERTICAL_INVALID' });
        }
        updates.industryVertical = industryVertical;
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'NO_UPDATES_PROVIDED' });
      }

      await Workspace.updateOne({ _id: req.workspace._id }, { $set: updates });
      const updated = await Workspace.findById(req.workspace._id);
      return res.json({ workspace: updated });
    } catch (err) {
      console.error('[PATCH /api/workspaces/:id]', err);
      return res.status(500).json({ error: 'INTERNAL_ERROR' });
    }
  }
);

/* ============================================================
 * DELETE /api/workspaces/:id  (soft delete)
 * Solo OWNER.
 * ============================================================ */
router.delete(
  '/api/workspaces/:id',
  ensureAuthenticated,
  resolveWorkspace,
  requirePermission('workspace.delete'),
  async (req, res) => {
    try {
      await Workspace.updateOne(
        { _id: req.workspace._id },
        { $set: { deletedAt: new Date() } }
      );
      return res.json({ ok: true });
    } catch (err) {
      console.error('[DELETE /api/workspaces/:id]', err);
      return res.status(500).json({ error: 'INTERNAL_ERROR' });
    }
  }
);

/* ============================================================
 * POST /api/workspaces/:id/transfer-ownership
 * Body: { targetUserId }
 * Solo OWNER.
 * ============================================================ */
router.post(
  '/api/workspaces/:id/transfer-ownership',
  ensureAuthenticated,
  resolveWorkspace,
  requirePermission('workspace.transfer.ownership'),
  async (req, res) => {
    try {
      const { targetUserId } = req.body || {};
      if (!targetUserId) return res.status(400).json({ error: 'TARGET_USER_REQUIRED' });
      if (!mongoose.isValidObjectId(targetUserId)) return res.status(400).json({ error: 'INVALID_TARGET_USER_ID' });
      if (String(targetUserId) === String(req.user._id)) return res.status(400).json({ error: 'CANNOT_TRANSFER_TO_SELF' });

      const targetMembership = await WorkspaceMember.findOne({
        workspaceId: req.workspace._id,
        userId: targetUserId,
        status: 'ACTIVE',
      });
      if (!targetMembership) return res.status(404).json({ error: 'TARGET_NOT_A_MEMBER' });

      await workspaceService.transferOwnership({
        workspace: req.workspace,
        currentOwnerMembership: req.workspaceMembership,
        targetMembership,
      });

      const updated = await Workspace.findById(req.workspace._id);
      return res.json({
        workspace: updated,
        previousOwnerUserId: String(req.user._id),
        newOwnerUserId: String(targetUserId),
      });
    } catch (err) {
      console.error('[POST /api/workspaces/:id/transfer-ownership]', err);
      return res.status(500).json({ error: 'INTERNAL_ERROR' });
    }
  }
);

/* ============================================================
 * GET /api/workspaces/:id/members
 * ============================================================ */
router.get(
  '/api/workspaces/:id/members',
  ensureAuthenticated,
  resolveWorkspace,
  requirePermission('members.view'),
  async (req, res) => {
    try {
      const members = await WorkspaceMember.find({
        workspaceId: req.workspace._id,
        status: { $ne: 'REMOVED' },
      })
        .populate('userId', 'email firstName lastName name profilePhotoUrl')
        .lean();

      return res.json({ members });
    } catch (err) {
      console.error('[GET /api/workspaces/:id/members]', err);
      return res.status(500).json({ error: 'INTERNAL_ERROR' });
    }
  }
);

/* ============================================================
 * PATCH /api/workspaces/:id/members/:userId
 * Body: { role?, status? }
 * ============================================================ */
router.patch(
  '/api/workspaces/:id/members/:userId',
  ensureAuthenticated,
  resolveWorkspace,
  requirePermission('members.changeRole'),
  async (req, res) => {
    try {
      const { userId: targetUserId } = req.params;
      const { role, status } = req.body || {};
      const callerRole = req.workspaceMembership.role;

      if (!mongoose.isValidObjectId(targetUserId)) {
        return res.status(400).json({ error: 'INVALID_USER_ID' });
      }

      const targetMembership = await WorkspaceMember.findOne({
        workspaceId: req.workspace._id,
        userId: targetUserId,
      });
      if (!targetMembership) return res.status(404).json({ error: 'MEMBER_NOT_FOUND' });

      // No permitir cambiarse a sí mismo (evitar auto-promociones).
      if (String(targetUserId) === String(req.user._id)) {
        return res.status(400).json({ error: 'CANNOT_CHANGE_SELF' });
      }

      // Admin no puede tocar al Owner.
      if (callerRole === 'ADMIN' && targetMembership.role === 'OWNER') {
        return res.status(403).json({ error: 'CANNOT_MODIFY_OWNER' });
      }

      const updates = {};

      if (role) {
        if (!['ADMIN', 'MEMBER', 'OWNER'].includes(role)) {
          return res.status(400).json({ error: 'INVALID_ROLE' });
        }
        // Solo OWNER puede asignar OWNER. Y para mover a OWNER, hay un endpoint
        // dedicado de transfer-ownership. No permitir aquí.
        if (role === 'OWNER') {
          return res.status(400).json({ error: 'USE_TRANSFER_OWNERSHIP_ENDPOINT' });
        }
        // Si el target era OWNER, no se puede demover por aquí.
        if (targetMembership.role === 'OWNER') {
          return res.status(400).json({ error: 'CANNOT_DEMOTE_OWNER_DIRECTLY' });
        }
        updates.role = role;
      }

      if (status) {
        if (!['ACTIVE', 'SUSPENDED'].includes(status)) {
          return res.status(400).json({ error: 'INVALID_STATUS' });
        }
        // No permitir suspender al OWNER.
        if (targetMembership.role === 'OWNER' && status !== 'ACTIVE') {
          return res.status(400).json({ error: 'CANNOT_SUSPEND_OWNER' });
        }
        updates.status = status;
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'NO_UPDATES_PROVIDED' });
      }

      await WorkspaceMember.updateOne({ _id: targetMembership._id }, { $set: updates });
      const updated = await WorkspaceMember.findById(targetMembership._id);
      return res.json({ membership: updated });
    } catch (err) {
      console.error('[PATCH /api/workspaces/:id/members/:userId]', err);
      return res.status(500).json({ error: 'INTERNAL_ERROR' });
    }
  }
);

/* ============================================================
 * DELETE /api/workspaces/:id/members/:userId
 * Self-leave permitido excepto para Owner único.
 * ============================================================ */
router.delete(
  '/api/workspaces/:id/members/:userId',
  ensureAuthenticated,
  resolveWorkspace,
  async (req, res) => {
    try {
      const { userId: targetUserId } = req.params;
      const callerUserId = req.user._id;
      const callerRole = req.workspaceMembership.role;
      const isSelfLeave = String(targetUserId) === String(callerUserId);

      if (!mongoose.isValidObjectId(targetUserId)) {
        return res.status(400).json({ error: 'INVALID_USER_ID' });
      }

      // Permission check:
      // - self-leave: cualquier rol puede salirse de sí mismo (excepto Owner único).
      // - removing other: requiere members.remove (OWNER o ADMIN).
      if (!isSelfLeave) {
        const { canDo } = require('../config/permissions');
        if (!canDo(callerRole, 'members.remove')) {
          return res.status(403).json({
            error: 'INSUFFICIENT_PERMISSION',
            action: 'members.remove',
            userRole: callerRole,
          });
        }
      }

      const targetMembership = await WorkspaceMember.findOne({
        workspaceId: req.workspace._id,
        userId: targetUserId,
      });
      if (!targetMembership) return res.status(404).json({ error: 'MEMBER_NOT_FOUND' });

      // Owner solo puede ser removido si NO es el último Owner activo.
      if (targetMembership.role === 'OWNER') {
        const owners = await workspaceService.countActiveOwners(req.workspace._id);
        if (owners <= 1) {
          return res.status(400).json({
            error: 'CANNOT_REMOVE_LAST_OWNER',
            detail: isSelfLeave
              ? 'Transfer ownership before leaving.'
              : 'Promote another member to OWNER first.',
          });
        }
      }

      // Admin no puede remover Owner.
      if (callerRole === 'ADMIN' && targetMembership.role === 'OWNER' && !isSelfLeave) {
        return res.status(403).json({ error: 'CANNOT_MODIFY_OWNER' });
      }

      await WorkspaceMember.deleteOne({ _id: targetMembership._id });

      // Si el user removido tenía este workspace como default/active, limpiar.
      // (Solo si es self-leave o si target somos nosotros mismos.)
      if (isSelfLeave) {
        const u = await User.findById(callerUserId);
        const patch = {};
        if (u && String(u.lastActiveWorkspaceId) === String(req.workspace._id)) {
          patch.lastActiveWorkspaceId = null;
        }
        if (u && String(u.defaultWorkspaceId) === String(req.workspace._id)) {
          patch.defaultWorkspaceId = null;
        }
        if (Object.keys(patch).length) {
          await User.updateOne({ _id: callerUserId }, { $set: patch });
        }
      }

      return res.json({ ok: true });
    } catch (err) {
      console.error('[DELETE /api/workspaces/:id/members/:userId]', err);
      return res.status(500).json({ error: 'INTERNAL_ERROR' });
    }
  }
);

/* ============================================================
 * POST /api/workspaces/:id/invitations
 * Body: { email, role? }
 * Crea invitación + envía email.
 * ============================================================ */
router.post(
  '/api/workspaces/:id/invitations',
  ensureAuthenticated,
  resolveWorkspace,
  requirePermission('invitations.create'),
  async (req, res) => {
    try {
      const WorkspaceInvitation = require('../models/WorkspaceInvitation');
      const { sendWorkspaceInvitationEmail } = require('../services/emailService');

      const rawEmail = String((req.body && req.body.email) || '').trim().toLowerCase();
      const role = (req.body && req.body.role) || 'MEMBER';

      if (!rawEmail) return res.status(400).json({ error: 'EMAIL_REQUIRED' });
      if (!workspaceService.isValidEmail(rawEmail)) {
        return res.status(400).json({ error: 'EMAIL_INVALID' });
      }
      if (!['ADMIN', 'MEMBER'].includes(role)) {
        return res.status(400).json({ error: 'INVALID_ROLE' });
      }

      // ¿Ya es miembro activo?
      const allActive = await WorkspaceMember.find({
        workspaceId: req.workspace._id,
        status: 'ACTIVE',
      }).populate('userId', 'email');
      const alreadyMember = allActive.find(
        (m) => m.userId && String(m.userId.email || '').toLowerCase() === rawEmail
      );
      if (alreadyMember) return res.status(409).json({ error: 'ALREADY_A_MEMBER' });

      // ¿Ya tiene invitación activa?
      const existing = await workspaceService.findActiveInvitation(req.workspace._id, rawEmail);
      if (existing) return res.status(409).json({ error: 'INVITATION_ALREADY_PENDING' });

      // Crear invitación.
      const { token, tokenHash } = workspaceService.generateInvitationToken();
      const expiresAt = new Date(Date.now() + workspaceService.INVITATION_TTL_MS);

      const invitation = await WorkspaceInvitation.create({
        workspaceId: req.workspace._id,
        email: rawEmail,
        role,
        tokenHash,
        invitedBy: req.user._id,
        expiresAt,
      });

      // Enviar email (fail-safe).
      const appUrl = (process.env.APP_URL || 'https://adray.ai').replace(/\/$/, '');
      const acceptUrl = `${appUrl}/invitations/${token}`;

      const inviterName =
        (req.user.firstName && `${req.user.firstName} ${req.user.lastName || ''}`.trim()) ||
        req.user.name ||
        req.user.email;

      const emailResult = await sendWorkspaceInvitationEmail({
        toEmail: rawEmail,
        inviterName,
        workspaceName: req.workspace.name,
        role,
        acceptUrl,
        expiresAt,
      });

      return res.status(201).json({
        invitation: {
          _id: invitation._id,
          workspaceId: invitation.workspaceId,
          email: invitation.email,
          role: invitation.role,
          expiresAt: invitation.expiresAt,
          createdAt: invitation.createdAt,
        },
        emailDelivered: !!emailResult.sent,
        emailSkippedReason: emailResult.skipped ? emailResult.reason : null,
      });
    } catch (err) {
      console.error('[POST /api/workspaces/:id/invitations]', err);
      return res.status(500).json({ error: 'INTERNAL_ERROR' });
    }
  }
);

/* ============================================================
 * GET /api/workspaces/:id/invitations
 * Lista invitaciones pendientes (no aceptadas, no revocadas, no expiradas).
 * ============================================================ */
router.get(
  '/api/workspaces/:id/invitations',
  ensureAuthenticated,
  resolveWorkspace,
  requirePermission('invitations.view'),
  async (req, res) => {
    try {
      const WorkspaceInvitation = require('../models/WorkspaceInvitation');
      const invitations = await WorkspaceInvitation.find({
        workspaceId: req.workspace._id,
        acceptedAt: null,
        declinedAt: null,
        revokedAt: null,
        expiresAt: { $gt: new Date() },
      })
        .select('-tokenHash')
        .sort({ createdAt: -1 })
        .lean();

      return res.json({ invitations });
    } catch (err) {
      console.error('[GET /api/workspaces/:id/invitations]', err);
      return res.status(500).json({ error: 'INTERNAL_ERROR' });
    }
  }
);

/* ============================================================
 * DELETE /api/workspaces/:id/invitations/:invitationId
 * Revoca una invitación (marca revokedAt).
 * ============================================================ */
router.delete(
  '/api/workspaces/:id/invitations/:invitationId',
  ensureAuthenticated,
  resolveWorkspace,
  requirePermission('invitations.revoke'),
  async (req, res) => {
    try {
      const WorkspaceInvitation = require('../models/WorkspaceInvitation');
      const { invitationId } = req.params;

      if (!mongoose.isValidObjectId(invitationId)) {
        return res.status(400).json({ error: 'INVALID_INVITATION_ID' });
      }

      const inv = await WorkspaceInvitation.findOne({
        _id: invitationId,
        workspaceId: req.workspace._id,
      });

      if (!inv) return res.status(404).json({ error: 'INVITATION_NOT_FOUND' });
      if (inv.acceptedAt) return res.status(400).json({ error: 'INVITATION_ALREADY_ACCEPTED' });
      if (inv.revokedAt) return res.status(400).json({ error: 'INVITATION_ALREADY_REVOKED' });

      await WorkspaceInvitation.updateOne(
        { _id: inv._id },
        { $set: { revokedAt: new Date() } }
      );

      return res.json({ ok: true });
    } catch (err) {
      console.error('[DELETE /api/workspaces/:id/invitations/:invitationId]', err);
      return res.status(500).json({ error: 'INTERNAL_ERROR' });
    }
  }
);

module.exports = router;
