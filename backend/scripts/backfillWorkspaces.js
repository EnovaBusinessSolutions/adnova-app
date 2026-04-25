// backend/scripts/backfillWorkspaces.js
//
// Idempotente. Crea un workspace personal por cada User existente.
// Uso:
//   node backend/scripts/backfillWorkspaces.js [--dry-run]
//
// Importante: NO usa transacciones (MongoDB single-node no las soporta).
// En caso de fallo a mitad de un user, el script puede dejarlo a medias;
// reportar y dejar TODO de cleanup al final.

require('dotenv').config();
const mongoose = require('mongoose');
const slugify = require('slugify');

const User = require('../models/User');
const Workspace = require('../models/Workspace');
const WorkspaceMember = require('../models/WorkspaceMember');

const DRY_RUN = process.argv.includes('--dry-run');

const RESERVED_SLUGS = new Set([
  'admin', 'api', 'app', 'login', 'logout', 'signup', 'settings',
  'dashboard', 'billing', 'mcp', 'public', 'www', 'support', 'help',
  'blog', 'docs', 'integrations', 'team', 'workspace', 'workspaces',
  'invitations', 'invitation', 'onboarding', 'me',
]);

function deriveBaseSlug(user) {
  const base =
    (user.email && user.email.split('@')[0]) ||
    (user.firstName ? user.firstName : '') ||
    (user.name ? user.name : '') ||
    'user';
  const cleaned = slugify(String(base), { lower: true, strict: true, trim: true });
  return cleaned || 'user';
}

async function ensureUniqueSlug(baseSlug) {
  let slug = baseSlug;
  let n = 2;
  // Si está reservado o ya existe, agrega sufijo.
  // Limita a 100 intentos por seguridad.
  for (let i = 0; i < 100; i++) {
    if (!RESERVED_SLUGS.has(slug)) {
      const exists = await Workspace.findOne({ slug }).lean();
      if (!exists) return slug;
    }
    slug = `${baseSlug}-${n}`;
    n++;
  }
  throw new Error(`Could not generate unique slug after 100 attempts for base="${baseSlug}"`);
}

function deriveWorkspaceName(user) {
  if (user.firstName && user.firstName.trim()) {
    return `${user.firstName.trim()}'s workspace`;
  }
  if (user.name && user.name.trim()) {
    return `${user.name.trim()}'s workspace`;
  }
  if (user.email) {
    return `${user.email.split('@')[0]}'s workspace`;
  }
  return 'My workspace';
}

async function backfillUser(user) {
  const userId = user._id;

  // Idempotencia: si ya tiene defaultWorkspaceId que existe, saltar.
  if (user.defaultWorkspaceId) {
    const existing = await Workspace.findById(user.defaultWorkspaceId).lean();
    if (existing) {
      return { skipped: true, reason: 'already_has_workspace', workspaceId: existing._id };
    }
  }

  const baseSlug = deriveBaseSlug(user);
  const name = deriveWorkspaceName(user);

  if (DRY_RUN) {
    return { dryRun: true, slug: `${baseSlug} (would be uniqueified)`, name };
  }

  const slug = await ensureUniqueSlug(baseSlug);

  // 1. Crear Workspace.
  const workspace = await Workspace.create({
    slug,
    name,
    icon: 'SHOPPING_BAG',
    industryVertical: null,
    ownerUserId: userId,
    plan: user.plan || 'gratis',
    stripeCustomerId: user.stripeCustomerId || null,
    onboardingComplete: true, // backfill: usuarios existentes ya están "dentro"
  });

  // 2. Crear WorkspaceMember (OWNER).
  await WorkspaceMember.create({
    workspaceId: workspace._id,
    userId,
    role: 'OWNER',
    status: 'ACTIVE',
    joinedAt: new Date(),
  });

  // 3. Marcar User: defaultWorkspaceId, lastActiveWorkspaceId, onboardingStep.
  await User.updateOne(
    { _id: userId },
    {
      $set: {
        defaultWorkspaceId: workspace._id,
        lastActiveWorkspaceId: workspace._id,
        onboardingStep: 'COMPLETE',
      },
    }
  );

  return { created: true, workspaceId: workspace._id, slug };
}

async function main() {
  console.log(`[backfill] starting${DRY_RUN ? ' (DRY RUN)' : ''}...`);

  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI no está configurado');
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log('[backfill] connected to MongoDB');

  const users = await User.find({}).lean();
  console.log(`[backfill] found ${users.length} users`);

  const stats = { created: 0, skipped: 0, errors: 0 };

  for (const user of users) {
    try {
      const r = await backfillUser(user);
      if (r.skipped) {
        stats.skipped++;
        console.log(`[skip] ${user.email} (${r.reason})`);
      } else if (r.created) {
        stats.created++;
        console.log(`[ok] ${user.email} -> ${r.slug}`);
      } else if (r.dryRun) {
        console.log(`[dry-run] ${user.email} -> ${r.slug} (${r.name})`);
      }
    } catch (err) {
      stats.errors++;
      console.error(`[error] ${user.email}: ${err.message}`);
    }
  }

  console.log('\n[backfill] summary:', stats);

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('[backfill] fatal:', err);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
