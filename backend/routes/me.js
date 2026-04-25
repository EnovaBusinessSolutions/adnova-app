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

/* ============================================================
 * PATCH /api/me/profile
 * Body parcial: { firstName?, lastName?, jobTitle?, primaryFocus?,
 *                 profilePhotoUrl?, onboardingStep? }
 * Actualiza solo los campos enviados. Los demás quedan intactos.
 * ============================================================ */
router.patch('/api/me/profile', ensureAuthenticated, async (req, res) => {
  try {
    const body = req.body || {};
    const updates = {};

    const ALLOWED_PRIMARY_FOCUS = [
      'FOUNDER_CEO', 'HEAD_OF_GROWTH', 'HEAD_OF_MARKETING',
      'MARKETING_MANAGER', 'PERFORMANCE_MARKETER', 'ANALYTICS',
      'AGENCY', 'ENGINEERING', 'OTHER',
    ];
    const ALLOWED_ONBOARDING_STEPS = [
      'NONE', 'WORKSPACE_CREATED', 'PROFILE_COMPLETE', 'COMPLETE',
    ];

    if (typeof body.firstName === 'string') {
      const trimmed = body.firstName.trim();
      if (trimmed.length > 32) return res.status(400).json({ error: 'FIRST_NAME_TOO_LONG' });
      updates.firstName = trimmed;
    }

    if (typeof body.lastName === 'string') {
      const trimmed = body.lastName.trim();
      if (trimmed.length > 32) return res.status(400).json({ error: 'LAST_NAME_TOO_LONG' });
      updates.lastName = trimmed;
    }

    if (typeof body.jobTitle === 'string') {
      const trimmed = body.jobTitle.trim();
      if (trimmed.length > 64) return res.status(400).json({ error: 'JOB_TITLE_TOO_LONG' });
      updates.jobTitle = trimmed;
    }

    if (body.primaryFocus !== undefined) {
      if (body.primaryFocus !== null && !ALLOWED_PRIMARY_FOCUS.includes(body.primaryFocus)) {
        return res.status(400).json({ error: 'INVALID_PRIMARY_FOCUS' });
      }
      updates.primaryFocus = body.primaryFocus;
    }

    if (typeof body.profilePhotoUrl === 'string') {
      const trimmed = body.profilePhotoUrl.trim();
      if (trimmed.length > 1024) return res.status(400).json({ error: 'PHOTO_URL_TOO_LONG' });
      updates.profilePhotoUrl = trimmed;
    }

    if (typeof body.onboardingStep === 'string') {
      if (!ALLOWED_ONBOARDING_STEPS.includes(body.onboardingStep)) {
        return res.status(400).json({ error: 'INVALID_ONBOARDING_STEP' });
      }
      updates.onboardingStep = body.onboardingStep;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'NO_UPDATES_PROVIDED' });
    }

    await User.updateOne({ _id: req.user._id }, { $set: updates });
    const updated = await User.findById(req.user._id);
    return res.json({
      ok: true,
      user: {
        _id: updated._id,
        email: updated.email,
        firstName: updated.firstName,
        lastName: updated.lastName,
        jobTitle: updated.jobTitle,
        primaryFocus: updated.primaryFocus,
        profilePhotoUrl: updated.profilePhotoUrl,
        onboardingStep: updated.onboardingStep,
        defaultWorkspaceId: updated.defaultWorkspaceId,
        lastActiveWorkspaceId: updated.lastActiveWorkspaceId,
      },
    });
  } catch (err) {
    console.error('[PATCH /api/me/profile]', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

module.exports = router;
