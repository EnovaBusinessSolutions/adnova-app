const { randomUUID } = require('crypto');
const prisma = require('../utils/prismaClient');
const { hashFingerprint, hashPII } = require('../utils/encryption');

function normalizeSha256(value) {
  if (!value || typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(v) ? v : null;
}

function getPayloadHashes(payload) {
  const emailHash = normalizeSha256(payload.email_hash) || (payload.email ? hashPII(payload.email) : null);
  const phoneHash = normalizeSha256(payload.phone_hash) || (payload.phone ? hashPII(payload.phone) : null);
  return { emailHash, phoneHash };
}

/**
 * Merges new identifiers into existing identity record without overwriting non-null values
 * @param {Object} existing - Existing DB record
 * @param {Object} payload - Incoming payload
 * @returns {Object} Updated fields
 */
function mergeIdentifiers(existing, payload) {
  const updates = {};
  const { emailHash, phoneHash } = getPayloadHashes(payload);
  
  if (payload.customer_id && !existing.customerId) updates.customerId = payload.customer_id;
  if (emailHash && !existing.emailHash) updates.emailHash = emailHash;
  if (phoneHash && !existing.phoneHash) updates.phoneHash = phoneHash;
  
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
  let matchType = 'probabilistic';
  const ipHash = payload.ip ? hashPII(payload.ip) : null;
  const { emailHash, phoneHash } = getPayloadHashes(payload);

  // 1. Check Cookie
  if (cookieUserKey) {
    matchedIdentity = await prisma.identityGraph.findFirst({
      where: { accountId, userKey: cookieUserKey }
    });
    
    if (matchedIdentity) {
      finalConfidence = matchedIdentity.confidenceScore;
      matchType = 'deterministic';
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
          ipHash,
          emailHash,
          phoneHash,
          fbclid: payload.fbclid,
          gclid: payload.gclid,
          ttclid: payload.ttclid,
          confidenceScore: 1.0,
        }
      });
      isNew = true;
      finalConfidence = 1.0;
      matchType = 'deterministic';
    } else {
      finalConfidence = matchedIdentity.confidenceScore;
      matchType = 'deterministic';
    }
  }

  // 3. Check Customer ID
  if (!matchedIdentity && payload.customer_id) {
    matchedIdentity = await prisma.identityGraph.findFirst({
      where: { accountId, customerId: payload.customer_id }
    });
    
    if (matchedIdentity) {
       finalConfidence = Math.max(matchedIdentity.confidenceScore, 0.9);
       matchType = 'deterministic';
    }
  }

  // 3.1 Check deterministic hashed identity anchors from checkout signals
  if (!matchedIdentity && (emailHash || phoneHash)) {
    const OR = [];
    if (emailHash) OR.push({ emailHash });
    if (phoneHash) OR.push({ phoneHash });

    matchedIdentity = await prisma.identityGraph.findFirst({
      where: { accountId, OR }
    });

    if (matchedIdentity) {
      finalConfidence = Math.max(matchedIdentity.confidenceScore, 0.95);
      matchType = 'deterministic';
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
      matchType = 'probabilistic';
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
        ipHash,
        emailHash,
        phoneHash,
        confidenceScore: 0.6
      }
    });
    isNew = true;
    finalConfidence = 0.6;
    matchType = 'probabilistic';
  } else if (!isNew) {
    // Merge new identifiers into existing
    const updates = mergeIdentifiers(matchedIdentity, payload);
    if (ipHash && !matchedIdentity.ipHash) updates.ipHash = ipHash;
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
    confidenceScore: finalConfidence,
    matchType
  };
}

module.exports = {
  resolveUserKey,
  mergeIdentifiers
};
