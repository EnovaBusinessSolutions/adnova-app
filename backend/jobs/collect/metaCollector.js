'use strict';
const MetaAccount = require('../../models/MetaAccount');

async function collectMeta(userId) {
  const acc = await MetaAccount.findOne({ $or:[{user:userId},{userId}] }).lean();
  if (!acc) throw new Error('META_NOT_CONNECTED');

  // Llama a tu endpoint actual de insights/meta y arma el snapshot:
  // const meta = await fetch(...)

  return {
    kpis: {/* ... */},
    byCampaign: [/* ... */],
    pixelHealth: {/* ... */}
  };
}
module.exports = { collectMeta };
