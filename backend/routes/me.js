// backend/routes/me.js
'use strict';

const express = require('express');
const mongoose = require('mongoose');

const { ensureAuthenticated } = require('../auth');

const Workspace = require('../models/Workspace');
const WorkspaceMember = require('../models/WorkspaceMember');
const User = require('../models/User');

const router = express.Router();

/* ============================================================
 * GET /api/me/workspaces
 * Lista los workspaces del usuario actual con su rol.
 * ============================================================ */
router.get('/api/me/workspaces', ensureAuthenticated, async (req, res) => {
  try {
    const userId = req.user._id;

    const memberships = await WorkspaceMember.find({
      userId,
      status: 'ACTIVE',
    }).lean();

    const workspaceIds = memberships.map((m) => m.workspaceId);
    const workspaces = await Workspace.find({
      _id: { $in: workspaceIds },
      deletedAt: null,
    }).lean();

    // Combinar: cada workspace con el rol del user en él.
    const wsById = new Map(workspaces.map((w) => [String(w._id), w]));
    const items = memberships
      .map((m) => {
        const ws = wsById.get(String(m.workspaceId));
        if (!ws) return null;
        return { ...ws, role: m.role };
      })
      .filter(Boolean);

    return res.json({
      workspaces: items,
      activeWorkspaceId: req.user.lastActiveWorkspaceId
        ? String(req.user.lastActiveWorkspaceId)
        : (req.user.defaultWorkspaceId ? String(req.user.defaultWorkspaceId) : null),
    });
  } catch (err) {
    console.error('[GET /api/me/workspaces]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

/* ============================================================
 * PUT /api/me/active-workspace
 * Body: { workspaceId }
 * Cambia el workspace activo del usuario (lastActiveWorkspaceId).
 * ============================================================ */
router.put('/api/me/active-workspace', ensureAuthenticated, async (req, res) => {
  try {
    const { workspaceId } = req.body || {};
    if (!workspaceId) return res.status(400).json({ error: 'WORKSPACE_ID_REQUIRED' });
    if (!mongoose.isValidObjectId(workspaceId)) return res.status(400).json({ error: 'INVALID_WORKSPACE_ID' });

    const ws = await Workspace.findOne({ _id: workspaceId, deletedAt: null });
    if (!ws) return res.status(404).json({ error: 'WORKSPACE_NOT_FOUND' });

    const membership = await WorkspaceMember.findOne({
      workspaceId,
      userId: req.user._id,
      status: 'ACTIVE',
    });
    if (!membership) return res.status(403).json({ error: 'NOT_A_MEMBER' });

    await User.updateOne(
      { _id: req.user._id },
      { $set: { lastActiveWorkspaceId: ws._id } }
    );

    return res.json({ ok: true, activeWorkspaceId: String(ws._id) });
  } catch (err) {
    console.error('[PUT /api/me/active-workspace]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

module.exports = router;
