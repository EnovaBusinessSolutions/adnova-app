const { randomUUID } = require('crypto');
const prisma = require('../utils/prismaClient');
const { hashFingerprint, hashPII } = require('../utils/encryption');

/**
 * Merges new identifiers into existing identity record without overwriting non-null values
 * @param {Object} existing - Existing DB record
 * @param {Object} payload - Incoming payload
 * @returns {Object} Updated fields
 */
function mergeIdentifiers(existing, payload) {
  const updates = {};
  
  if (payload.customer_id && !existing.customerId) updates.customerId = payload.customer_id;
  if (payload.email && !existing.emailHash) updates.emailHash = hashPII(payload.email);
  if (payload.phone && !existing.phoneHash) updates.phoneHash = hashPII(payload.phone);
  
  // Update click/cookie IDs if empty
  ['fbp', 'fbc', 'fbclid', 'gclid', 'ttclid'].forEach(key => {
    if (payload[key] && !existing[key]) {
      updates[key] = payload[key];
    }
  });

  return updates;
}

/**
 * Resolves or creates a userKey based on hierarchy:
 * Cookie -> Click ID -> Customer ID -> Fingerprint -> New
 * @param {string} accountId 
 * @param {string|null} cookieUserKey 
 * @param {Object} payload 
 * @param {import('express').Response} res 
 */
async function resolveUserKey(accountId, cookieUserKey, payload, res) {
  let matchedIdentity = null;
  let isNew = false;
  let finalConfidence = 0.0;

  // 1. Check Cookie
  if (cookieUserKey) {
    matchedIdentity = await prisma.identityGraph.findFirst({
      where: { accountId, userKey: cookieUserKey }
    });
    
    if (matchedIdentity) {
      finalConfidence = matchedIdentity.confidenceScore;
    }
  }

  // 2. Check Click IDs if no cookie match
  if (!matchedIdentity && (payload.fbclid || payload.gclid || payload.ttclid)) {
    const OR = [];
    if (payload.fbclid) OR.push({ fbclid: payload.fbclid });
    if (payload.gclid) OR.push({ gclid: payload.gclid });
    if (payload.ttclid) OR.push({ ttclid: payload.ttclid });
    
    matchedIdentity = await prisma.identityGraph.findFirst({
      where: { accountId, OR }
    });
    
    if (!matchedIdentity) {
      // New user from click ID
      const userKey = randomUUID();
      matchedIdentity = await prisma.identityGraph.create({
        data: {
          accountId,
          userKey,
          fbclid: payload.fbclid,
          gclid: payload.gclid,
          ttclid: payload.ttclid,
          confidenceScore: 1.0,
        }
      });
      isNew = true;
      finalConfidence = 1.0;
    } else {
      finalConfidence = matchedIdentity.confidenceScore;
    }
  }

  // 3. Check Customer ID
  if (!matchedIdentity && payload.customer_id) {
    matchedIdentity = await prisma.identityGraph.findFirst({
      where: { accountId, customerId: payload.customer_id }
    });
    
    if (matchedIdentity) {
       finalConfidence = Math.max(matchedIdentity.confidenceScore, 0.9);
    }
  }

  const fingerprintHash = hashFingerprint(
    payload.user_agent, payload.ip, payload.timezone, payload.language
  );

  // 4. Check Fingerprint
  if (!matchedIdentity) {
    matchedIdentity = await prisma.identityGraph.findFirst({
      where: { accountId, fingerprintHash }
    });
    
    if (matchedIdentity) {
      finalConfidence = Math.max(matchedIdentity.confidenceScore, 0.6);
    }
  }

  // 5. Create New
  if (!matchedIdentity) {
    const userKey = randomUUID();
    matchedIdentity = await prisma.identityGraph.create({
      data: {
        accountId,
        userKey,
        fingerprintHash,
        confidenceScore: 0.6
      }
    });
    isNew = true;
    finalConfidence = 0.6;
  } else if (!isNew) {
    // Merge new identifiers into existing
    const updates = mergeIdentifiers(matchedIdentity, payload);
    updates.lastSeenAt = new Date();
    // Only update if there are meaningful changes to reduce DB writes
    if (Object.keys(updates).length > 1) { // >1 because lastSeenAt is always there
      await prisma.identityGraph.update({
        where: { id: matchedIdentity.id },
        data: updates
      });
    }
  }

  // 6. Always set cookie
  // 63072000000 = 2 years in ms
  if (res && typeof res.cookie === 'function') {
    res.cookie('_adray_uid', matchedIdentity.userKey, {
      httpOnly: true,
      secure: true,
      sameSite: 'None',
      maxAge: 63072000000,
      path: '/'
    });
  }

  return {
    userKey: matchedIdentity.userKey,
    isNew,
    confidenceScore: finalConfidence
  };
}

module.exports = {
  resolveUserKey,
  mergeIdentifiers
};
