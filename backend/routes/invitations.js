// backend/routes/invitations.js
'use strict';

const express = require('express');

const Workspace = require('../models/Workspace');
const WorkspaceMember = require('../models/WorkspaceMember');
const WorkspaceInvitation = require('../models/WorkspaceInvitation');
const User = require('../models/User');

const workspaceService = require('../services/workspaceService');

const router = express.Router();

/* ============================================================
 * POST /api/invitations/:token/accept
 * Acepta una invitación pendiente. Requiere usuario autenticado
 * con email matching al de la invitación.
 *
 * Errores:
 *   401 NEEDS_LOGIN              — no autenticado.
 *   404 INVITATION_NOT_FOUND     — token inválido.
 *   410 INVITATION_EXPIRED       — pasó expiresAt.
 *   410 INVITATION_REVOKED       — fue revocada.
 *   410 INVITATION_ALREADY_ACCEPTED
 *   410 INVITATION_DECLINED
 *   403 EMAIL_MISMATCH           — req.user.email != invitation.email.
 *   404 WORKSPACE_NOT_FOUND      — el workspace fue eliminado.
 *   409 ALREADY_A_MEMBER         — ya es miembro activo.
 * ============================================================ */
router.post('/api/invitations/:token/accept', async (req, res) => {
  // Auth manual (no usamos ensureAuthenticated directo porque el código
  // de error que queremos para no-auth aquí es NEEDS_LOGIN, no NOT_AUTHENTICATED).
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    return res.status(401).json({ error: 'NEEDS_LOGIN' });
  }

  try {
    const { token } = req.params;
    if (!token || typeof token !== 'string') {
      return res.status(400).json({ error: 'TOKEN_REQUIRED' });
    }

    const tokenHash = workspaceService.hashInvitationToken(token);
    const invitation = await WorkspaceInvitation.findOne({ tokenHash });

    if (!invitation) return res.status(404).json({ error: 'INVITATION_NOT_FOUND' });
    if (invitation.acceptedAt) return res.status(410).json({ error: 'INVITATION_ALREADY_ACCEPTED' });
    if (invitation.declinedAt) return res.status(410).json({ error: 'INVITATION_DECLINED' });
    if (invitation.revokedAt) return res.status(410).json({ error: 'INVITATION_REVOKED' });
    if (invitation.expiresAt && new Date(invitation.expiresAt).getTime() < Date.now()) {
      return res.status(410).json({ error: 'INVITATION_EXPIRED' });
    }

    // Email match
    const userEmail = String(req.user.email || '').toLowerCase().trim();
    const invitationEmail = String(invitation.email || '').toLowerCase().trim();
    if (userEmail !== invitationEmail) {
      return res.status(403).json({
        error: 'EMAIL_MISMATCH',
        invitationEmail,
        userEmail,
      });
    }

    // Workspace existe
    const workspace = await Workspace.findOne({
      _id: invitation.workspaceId,
      deletedAt: null,
    });
    if (!workspace) return res.status(404).json({ error: 'WORKSPACE_NOT_FOUND' });

    // ¿Ya es miembro?
    const existingMember = await WorkspaceMember.findOne({
      workspaceId: workspace._id,
      userId: req.user._id,
    });

    if (existingMember && existingMember.status === 'ACTIVE') {
      return res.status(409).json({ error: 'ALREADY_A_MEMBER' });
    }

    // Si era REMOVED o SUSPENDED, lo borramos para volver a crearlo limpio.
    if (existingMember) {
      await WorkspaceMember.deleteOne({ _id: existingMember._id });
    }

    // Crear membresía.
    const member = await WorkspaceMember.create({
      workspaceId: workspace._id,
      userId: req.user._id,
      role: invitation.role,
      status: 'ACTIVE',
      invitedBy: invitation.invitedBy,
      invitedAt: invitation.createdAt,
      joinedAt: new Date(),
    });

    // Marcar invitación como aceptada.
    await WorkspaceInvitation.updateOne(
      { _id: invitation._id },
      { $set: { acceptedAt: new Date() } }
    );

    // Update User: lastActiveWorkspaceId siempre, defaultWorkspaceId si null.
    const userPatch = { lastActiveWorkspaceId: workspace._id };
    if (!req.user.defaultWorkspaceId) userPatch.defaultWorkspaceId = workspace._id;
    await User.updateOne({ _id: req.user._id }, { $set: userPatch });

    return res.json({
      ok: true,
      workspace,
      membership: member,
    });
  } catch (err) {
    console.error('[POST /api/invitations/:token/accept]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

module.exports = router;
