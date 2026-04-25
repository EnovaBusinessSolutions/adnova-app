// backend/services/workspaceService.js
'use strict';

const mongoose = require('mongoose');
const slugify = require('slugify');

const Workspace = require('../models/Workspace');
const WorkspaceMember = require('../models/WorkspaceMember');
const User = require('../models/User');

const RESERVED_SLUGS = new Set([
  'admin', 'api', 'app', 'login', 'logout', 'signup', 'settings',
  'dashboard', 'billing', 'mcp', 'public', 'www', 'support', 'help',
  'blog', 'docs', 'integrations', 'team', 'workspace', 'workspaces',
  'invitations', 'invitation', 'onboarding', 'me',
]);

/**
 * Genera un slug base desde un string libre.
 */
function deriveBaseSlug(input) {
  const cleaned = slugify(String(input || ''), { lower: true, strict: true, trim: true });
  return cleaned || 'workspace';
}

/**
 * Devuelve un slug único, agregando sufijo numérico si está reservado o existe.
 * Limita a 100 intentos por seguridad.
 */
async function ensureUniqueSlug(baseSlug) {
  let slug = baseSlug;
  let n = 2;
  for (let i = 0; i < 100; i++) {
    if (!RESERVED_SLUGS.has(slug)) {
      const exists = await Workspace.findOne({ slug }).lean();
      if (!exists) return slug;
    }
    slug = `${baseSlug}-${n}`;
    n++;
  }
  throw new Error(`Could not generate unique slug after 100 attempts (base="${baseSlug}")`);
}

/**
 * Valida que un slug propuesto sea aceptable.
 * Throws con código si no.
 */
async function validateSlug(slug) {
  const SLUG_REGEX = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
  if (typeof slug !== 'string' || !SLUG_REGEX.test(slug)) {
    const err = new Error('SLUG_INVALID');
    err.code = 'SLUG_INVALID';
    throw err;
  }
  if (slug.length > 48) {
    const err = new Error('SLUG_TOO_LONG');
    err.code = 'SLUG_TOO_LONG';
    throw err;
  }
  if (RESERVED_SLUGS.has(slug)) {
    const err = new Error('SLUG_RESERVED');
    err.code = 'SLUG_RESERVED';
    throw err;
  }
  const exists = await Workspace.findOne({ slug }).lean();
  if (exists) {
    const err = new Error('SLUG_TAKEN');
    err.code = 'SLUG_TAKEN';
    throw err;
  }
}

/**
 * Crea un workspace nuevo con su Owner. Usado por POST /api/workspaces y por
 * el onboarding (Fase 4).
 *
 * payload: { name, slug?, icon?, industryVertical? }
 *
 * Si no se pasa slug, se deriva del name. Garantiza unicidad.
 *
 * No usa transacciones (Mongo single-node). En caso de fallar la creación
 * del WorkspaceMember tras crear el Workspace, intenta limpiar el Workspace
 * y propaga el error.
 */
async function createWorkspaceForUser({ user, payload }) {
  if (!user || !user._id) throw new Error('user required');
  const name = String(payload.name || '').trim();
  if (!name) {
    const err = new Error('NAME_REQUIRED');
    err.code = 'NAME_REQUIRED';
    throw err;
  }
  if (name.length > 64) {
    const err = new Error('NAME_TOO_LONG');
    err.code = 'NAME_TOO_LONG';
    throw err;
  }

  let slug;
  if (payload.slug) {
    await validateSlug(payload.slug);
    slug = payload.slug;
  } else {
    const base = deriveBaseSlug(name);
    slug = await ensureUniqueSlug(base);
  }

  const workspace = await Workspace.create({
    slug,
    name,
    icon: payload.icon || 'SHOPPING_BAG',
    industryVertical: payload.industryVertical || null,
    ownerUserId: user._id,
    plan: user.plan || 'gratis',
    onboardingComplete: false,
  });

  let membership;
  try {
    membership = await WorkspaceMember.create({
      workspaceId: workspace._id,
      userId: user._id,
      role: 'OWNER',
      status: 'ACTIVE',
      joinedAt: new Date(),
    });
  } catch (err) {
    // Cleanup: el workspace quedó huérfano. Borramos para mantener consistencia.
    await Workspace.deleteOne({ _id: workspace._id }).catch(() => {});
    throw err;
  }

  // Si el user no tiene defaultWorkspaceId, este es ahora su default.
  // Siempre actualizamos lastActiveWorkspaceId para que el switcher lo muestre.
  const userPatch = { lastActiveWorkspaceId: workspace._id };
  if (!user.defaultWorkspaceId) userPatch.defaultWorkspaceId = workspace._id;
  await User.updateOne({ _id: user._id }, { $set: userPatch });

  return { workspace, membership };
}

/**
 * Cuenta cuántos owners ACTIVOS tiene un workspace.
 */
async function countActiveOwners(workspaceId) {
  return WorkspaceMember.countDocuments({
    workspaceId,
    role: 'OWNER',
    status: 'ACTIVE',
  });
}

/**
 * Transfiere ownership de un workspace.
 * - currentOwnerMembership pasa a ADMIN.
 * - targetMembership pasa a OWNER.
 * - Workspace.ownerUserId se actualiza.
 *
 * Validaciones previas (debe hacerlas el caller):
 * - target es ACTIVE member del workspace
 * - target no es el current owner
 *
 * No usa transacciones. En caso de falla a mitad, log y propagar error.
 */
async function transferOwnership({ workspace, currentOwnerMembership, targetMembership }) {
  if (!workspace || !currentOwnerMembership || !targetMembership) {
    throw new Error('transferOwnership: missing args');
  }
  if (currentOwnerMembership.role !== 'OWNER') {
    throw new Error('transferOwnership: current is not OWNER');
  }
  if (String(currentOwnerMembership._id) === String(targetMembership._id)) {
    throw new Error('transferOwnership: same membership');
  }

  // 1. Demote current owner.
  await WorkspaceMember.updateOne(
    { _id: currentOwnerMembership._id },
    { $set: { role: 'ADMIN' } }
  );

  // 2. Promote target.
  try {
    await WorkspaceMember.updateOne(
      { _id: targetMembership._id },
      { $set: { role: 'OWNER' } }
    );
  } catch (err) {
    // Compensar: revertir el demote.
    await WorkspaceMember.updateOne(
      { _id: currentOwnerMembership._id },
      { $set: { role: 'OWNER' } }
    ).catch(() => {});
    throw err;
  }

  // 3. Update Workspace.ownerUserId.
  try {
    await Workspace.updateOne(
      { _id: workspace._id },
      { $set: { ownerUserId: targetMembership.userId } }
    );
  } catch (err) {
    console.error('[transferOwnership] members updated but workspace.ownerUserId failed', err);
    throw err;
  }

  return {
    workspaceId: workspace._id,
    previousOwnerUserId: currentOwnerMembership.userId,
    newOwnerUserId: targetMembership.userId,
  };
}

// ============================================================
// Invitations (Fase 3B)
// ============================================================

const crypto = require('crypto');
const WorkspaceInvitation = require('../models/WorkspaceInvitation');

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 días

/**
 * Genera un par { token, tokenHash }.
 * El token plano se manda al email. El hash se guarda en DB.
 */
function generateInvitationToken() {
  const token = crypto.randomBytes(32).toString('hex'); // 64 chars
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  return { token, tokenHash };
}

/**
 * Hashea un token incoming (en accept) para buscarlo en DB.
 */
function hashInvitationToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

/**
 * Devuelve true si la invitación está activa (no aceptada, no rechazada,
 * no revocada, no expirada).
 */
function isInvitationActive(invitation) {
  if (!invitation) return false;
  if (invitation.acceptedAt || invitation.declinedAt || invitation.revokedAt) return false;
  if (invitation.expiresAt && new Date(invitation.expiresAt).getTime() < Date.now()) return false;
  return true;
}

/**
 * Busca una invitación activa para (workspaceId, email).
 * Retorna null si no hay.
 */
async function findActiveInvitation(workspaceId, email) {
  const candidates = await WorkspaceInvitation.find({
    workspaceId,
    email: String(email || '').toLowerCase().trim(),
    acceptedAt: null,
    declinedAt: null,
    revokedAt: null,
    expiresAt: { $gt: new Date() },
  });
  return candidates[0] || null;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(email) {
  return typeof email === 'string' && EMAIL_REGEX.test(email.trim());
}

module.exports = {
  RESERVED_SLUGS,
  deriveBaseSlug,
  ensureUniqueSlug,
  validateSlug,
  createWorkspaceForUser,
  countActiveOwners,
  transferOwnership,
  generateInvitationToken,
  hashInvitationToken,
  isInvitationActive,
  findActiveInvitation,
  isValidEmail,
  INVITATION_TTL_MS,
};
