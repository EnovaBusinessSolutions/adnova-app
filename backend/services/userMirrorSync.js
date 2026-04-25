// backend/services/userMirrorSync.js

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * Upsert UserMirror in Postgres from a Mongo User document.
 * Idempotente. No throws (logs and swallows).
 */
async function syncUserToMirror(userDoc) {
  if (!userDoc?._id || !userDoc?.email) return;

  const id = userDoc._id.toString();

  try {
    await prisma.userMirror.upsert({
      where: { id },
      create: {
        id,
        email: userDoc.email.toLowerCase(),
        firstName: userDoc.firstName || null,
        lastName: userDoc.lastName || null,
        jobTitle: userDoc.jobTitle || null,
        primaryFocus: userDoc.primaryFocus || null,
        profilePhotoUrl: userDoc.profilePhotoUrl || null,
        defaultWorkspaceId: userDoc.defaultWorkspaceId || null,
      },
      update: {
        email: userDoc.email.toLowerCase(),
        firstName: userDoc.firstName || null,
        lastName: userDoc.lastName || null,
        jobTitle: userDoc.jobTitle || null,
        primaryFocus: userDoc.primaryFocus || null,
        profilePhotoUrl: userDoc.profilePhotoUrl || null,
        defaultWorkspaceId: userDoc.defaultWorkspaceId || null,
      },
    });
  } catch (err) {
    // No bloquear save de Mongo si Postgres está caído.
    // TODO: agregar job de reconciliación en Fase 7.
    console.error('[userMirrorSync] failed to sync user', id, err.message);
  }
}

module.exports = { syncUserToMirror };
