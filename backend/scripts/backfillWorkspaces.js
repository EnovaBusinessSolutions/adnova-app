// backend/scripts/backfillWorkspaces.js
//
// Idempotente. Crea workspace personal por User existente.
// Uso: node backend/scripts/backfillWorkspaces.js [--dry-run]

require('dotenv').config();
const mongoose = require('mongoose');
const { PrismaClient } = require('@prisma/client');
const slugify = require('slugify') || ((s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''));

const User = require('../models/User');
const { syncUserToMirror } = require('../services/userMirrorSync');

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');

const RESERVED_SLUGS = new Set([
  'admin', 'api', 'app', 'login', 'logout', 'signup', 'settings',
  'dashboard', 'billing', 'mcp', 'public', 'www', 'support', 'help',
  'blog', 'docs', 'integrations', 'team', 'workspace', 'workspaces',
  'invitations', 'invitation', 'onboarding', 'me',
]);

function deriveSlug(email, firstName) {
  const base = (email || '').split('@')[0] || (firstName || 'user');
  const cleaned = slugify(base, { lower: true, strict: true });
  return cleaned || 'user';
}

async function ensureUniqueSlug(baseSlug) {
  let slug = baseSlug;
  let n = 2;
  while (RESERVED_SLUGS.has(slug) || (await prisma.workspace.findUnique({ where: { slug } }))) {
    slug = `${baseSlug}-${n}`;
    n++;
  }
  return slug;
}

async function backfillUser(user) {
  const userId = user._id.toString();

  // Si el user ya tiene defaultWorkspaceId, asumimos que ya fue migrado.
  if (user.defaultWorkspaceId) {
    const existing = await prisma.workspace.findUnique({
      where: { id: user.defaultWorkspaceId },
    });
    if (existing) {
      console.log(`[skip] User ${user.email} already has workspace ${existing.slug}`);
      return { skipped: true };
    }
  }

  // 1. Asegurar UserMirror.
  if (!DRY_RUN) {
    await syncUserToMirror(user);
  }

  // 2. Generar slug único.
  const baseSlug = deriveSlug(user.email, user.firstName);
  const slug = DRY_RUN ? baseSlug : await ensureUniqueSlug(baseSlug);

  // 3. Nombre del workspace.
  const displayName = user.firstName
    ? `${user.firstName}'s workspace`
    : (user.email ? `${user.email.split('@')[0]}'s workspace` : 'My workspace');

  if (DRY_RUN) {
    console.log(`[dry-run] would create workspace { slug: ${slug}, name: ${displayName}, owner: ${user.email} }`);
    return { dryRun: true, slug, displayName };
  }

  // 4. Crear Workspace + WorkspaceMember en transacción.
  const result = await prisma.$transaction(async (tx) => {
    const ws = await tx.workspace.create({
      data: {
        slug,
        name: displayName,
        ownerUserId: userId,
        plan: user.plan || 'gratis',
        stripeCustomerId: user.stripeCustomerId || null,
        onboardingComplete: true, // backfill: usuarios existentes ya están "dentro"
      },
    });

    await tx.workspaceMember.create({
      data: {
        workspaceId: ws.id,
        userId,
        role: 'OWNER',
        status: 'ACTIVE',
      },
    });

    return ws;
  });

  // 5. Asociar Accounts del usuario al nuevo workspace.
  //    Heurística: si User tiene `shop` field, buscar Account con ese domain.
  let accountsLinked = 0;
  if (user.shop) {
    const updated = await prisma.account.updateMany({
      where: {
        domain: user.shop,
        workspaceId: null,
      },
      data: { workspaceId: result.id },
    });
    accountsLinked = updated.count;
  }

  // 6. Marcar User.defaultWorkspaceId, lastActiveWorkspaceId, onboardingStep.
  await User.updateOne(
    { _id: user._id },
    {
      $set: {
        defaultWorkspaceId: result.id,
        lastActiveWorkspaceId: result.id,
        onboardingStep: 'COMPLETE',
      },
    }
  );

  // 7. Reflejar en UserMirror.
  await prisma.userMirror.update({
    where: { id: userId },
    data: { defaultWorkspaceId: result.id },
  });

  console.log(`[ok] User ${user.email} → workspace ${slug} (${accountsLinked} accounts linked)`);
  return { created: true, slug, accountsLinked };
}

async function main() {
  console.log(`Backfill workspaces ${DRY_RUN ? '(DRY RUN)' : ''}`);

  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to MongoDB');

  const users = await User.find({}).lean();
  console.log(`Found ${users.length} users`);

  let stats = { created: 0, skipped: 0, errors: 0, accountsLinked: 0 };

  for (const user of users) {
    try {
      const r = await backfillUser(user);
      if (r.skipped) stats.skipped++;
      if (r.created) {
        stats.created++;
        stats.accountsLinked += r.accountsLinked;
      }
    } catch (err) {
      console.error(`[error] User ${user.email}:`, err.message);
      stats.errors++;
    }
  }

  console.log('\nSummary:', stats);

  await mongoose.disconnect();
  await prisma.$disconnect();
}

if (require.main === module) {
  main().catch(async (err) => {
    console.error(err);
    await mongoose.disconnect().catch(() => {});
    await prisma.$disconnect();
    process.exit(1);
  });
}

module.exports = { backfillUser, deriveSlug };
