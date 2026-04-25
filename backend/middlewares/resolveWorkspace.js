// backend/middlewares/resolveWorkspace.js
'use strict';

const mongoose = require('mongoose');

const Workspace = require('../models/Workspace');
const WorkspaceMember = require('../models/WorkspaceMember');

/**
 * Middleware que resuelve el workspace activo de la request.
 *
 * Requisito previo: req.user debe estar populado (use después de ensureAuthenticated).
 *
 * Inyecta en req:
 *   - req.workspaceId         (string)
 *   - req.workspace           (Mongoose doc)
 *   - req.workspaceMembership (Mongoose doc del WorkspaceMember, con role)
 *
 * Errores posibles:
 *   401 NOT_AUTHENTICATED       — req.user faltante.
 *   400 NO_WORKSPACE_RESOLVED   — no se pudo determinar workspaceId.
 *   400 INVALID_WORKSPACE_ID    — workspaceId no es ObjectId válido.
 *   404 WORKSPACE_NOT_FOUND     — el workspace no existe o está soft-deleted.
 *   403 NOT_A_MEMBER            — el user no es miembro activo del workspace.
 */
async function resolveWorkspace(req, res, next) {
  try {
    const user = req.user;
    if (!user || !user._id) {
      return res.status(401).json({ error: 'NOT_AUTHENTICATED' });
    }

    // 1. Resolver workspaceId.
    const headerWorkspaceId = req.headers['x-workspace-id'];
    const candidate =
      (headerWorkspaceId && String(headerWorkspaceId).trim()) ||
      (user.lastActiveWorkspaceId && String(user.lastActiveWorkspaceId)) ||
      (user.defaultWorkspaceId && String(user.defaultWorkspaceId));

    if (!candidate) {
      return res.status(400).json({ error: 'NO_WORKSPACE_RESOLVED' });
    }

    if (!mongoose.isValidObjectId(candidate)) {
      return res.status(400).json({ error: 'INVALID_WORKSPACE_ID' });
    }

    // 2. Workspace existe y no está soft-deleted.
    const workspace = await Workspace.findOne({
      _id: candidate,
      deletedAt: null,
    });

    if (!workspace) {
      return res.status(404).json({ error: 'WORKSPACE_NOT_FOUND' });
    }

    // 3. User es miembro activo.
    const membership = await WorkspaceMember.findOne({
      workspaceId: workspace._id,
      userId: user._id,
      status: 'ACTIVE',
    });

    if (!membership) {
      return res.status(403).json({ error: 'NOT_A_MEMBER' });
    }

    // 4. Inyectar en req.
    req.workspaceId = String(workspace._id);
    req.workspace = workspace;
    req.workspaceMembership = membership;

    return next();
  } catch (err) {
    // No queremos exponer detalles de errores internos.
    console.error('[resolveWorkspace] error:', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
}

module.exports = resolveWorkspace;
