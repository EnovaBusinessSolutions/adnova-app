// backend/services/auditCleanup.js
'use strict';

const Audit = require('../models/Audit');

async function deleteAuditsForUserSources(userId, sources = []) {
  if (!userId || !Array.isArray(sources) || sources.length === 0) return { deletedCount: 0 };

  // Ajusta el campo según tu esquema real:
  // - puede ser `source`, `platform`, `provider`, etc.
  const q = { userId, source: { $in: sources } };

  const res = await Audit.deleteMany(q);
  return { deletedCount: res?.deletedCount || 0 };
}

module.exports = { deleteAuditsForUserSources };
