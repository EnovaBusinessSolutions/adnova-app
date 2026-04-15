const { randomUUID } = require('crypto');
const prisma = require('../utils/prismaClient');
const { hashFingerprint, hashPII } = require('../utils/encryption');

function isSchemaDriftError(error) {
  if (!error) return false;
  if (error.code === 'P2022') return true;
  const msg = String(error.message || '').toLowerCase();
  return msg.includes('column') && msg.includes('does not exist');
}

function normalizeSha256(value) {
  if (!value || typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(v) ? v : null;
}

function normalizeBrowserId(value) {
  if (!value || typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length < 8 || normalized.length > 128) return null;
  return normalized;
}

function hashBrowserId(value) {
  const normalized = normalizeBrowserId(value);
  return normalized ? hashPII(`browser:${normalized}`) : null;
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
  const browserId = normalizeBrowserId(payload.browser_id || payload.visitor_id);
  const browserFingerprintHash = hashBrowserId(browserId);

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

  // 2. Check persistent browser ID if no cookie match
  if (!matchedIdentity && browserFingerprintHash) {
    matchedIdentity = await prisma.identityGraph.findFirst({
      where: { accountId, fingerprintHash: browserFingerprintHash }
    });

    if (matchedIdentity) {
      finalConfidence = Math.max(matchedIdentity.confidenceScore, 0.98);
      matchType = 'deterministic';
    }
  }

  // 3. Check Click IDs if no cookie/browser match
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
      const clickIdentityData = {
        accountId,
        userKey,
        fingerprintHash: browserFingerprintHash,
        ipHash,
        emailHash,
        phoneHash,
        fbclid: payload.fbclid,
        gclid: payload.gclid,
        ttclid: payload.ttclid,
        confidenceScore: 1.0,
      };

      try {
        matchedIdentity = await prisma.identityGraph.create({ data: clickIdentityData });
      } catch (createError) {
        if (!isSchemaDriftError(createError)) throw createError;

        matchedIdentity = await prisma.identityGraph.create({
          data: {
            ...clickIdentityData,
            ipHash: undefined,
            emailHash: undefined,
            phoneHash: undefined,
          }
        });
      }
      isNew = true;
      finalConfidence = 1.0;
      matchType = 'deterministic';
    } else {
      finalConfidence = matchedIdentity.confidenceScore;
      matchType = 'deterministic';
    }
  }

  // 4. Check Customer ID
  if (!matchedIdentity && payload.customer_id) {
    matchedIdentity = await prisma.identityGraph.findFirst({
      where: { accountId, customerId: payload.customer_id }
    });
    
    if (matchedIdentity) {
       finalConfidence = Math.max(matchedIdentity.confidenceScore, 0.9);
       matchType = 'deterministic';
    }
  }

  // 4.1 Check deterministic hashed identity anchors from checkout signals
  if (!matchedIdentity && (emailHash || phoneHash)) {
    const OR = [];
    if (emailHash) OR.push({ emailHash });
    if (phoneHash) OR.push({ phoneHash });

    try {
      matchedIdentity = await prisma.identityGraph.findFirst({
        where: { accountId, OR }
      });
    } catch (hashLookupError) {
      if (!isSchemaDriftError(hashLookupError)) throw hashLookupError;
      matchedIdentity = null;
    }

    if (matchedIdentity) {
      finalConfidence = Math.max(matchedIdentity.confidenceScore, 0.95);
      matchType = 'deterministic';
    }
  }

  const fingerprintHash = browserFingerprintHash || hashFingerprint(
    payload.user_agent, payload.ip, payload.timezone, payload.language
  );

  // 5. Check Fingerprint
  if (!matchedIdentity) {
    matchedIdentity = await prisma.identityGraph.findFirst({
      where: { accountId, fingerprintHash }
    });
    
    if (matchedIdentity) {
      finalConfidence = Math.max(matchedIdentity.confidenceScore, 0.6);
      matchType = 'probabilistic';
    }
  }

  // 6. Create New
  if (!matchedIdentity) {
    const userKey = randomUUID();
    const newIdentityData = {
      accountId,
      userKey,
      fingerprintHash,
      ipHash,
      emailHash,
      phoneHash,
      confidenceScore: 0.6
    };

    try {
      matchedIdentity = await prisma.identityGraph.create({ data: newIdentityData });
    } catch (createError) {
      if (!isSchemaDriftError(createError)) throw createError;

      matchedIdentity = await prisma.identityGraph.create({
        data: {
          ...newIdentityData,
          ipHash: undefined,
          emailHash: undefined,
          phoneHash: undefined,
        }
      });
    }
    isNew = true;
    finalConfidence = 0.6;
    matchType = 'probabilistic';
  } else if (!isNew) {
    // Merge new identifiers into existing
    const updates = mergeIdentifiers(matchedIdentity, payload);
    if (ipHash && !matchedIdentity.ipHash) updates.ipHash = ipHash;
    if (fingerprintHash && !matchedIdentity.fingerprintHash) updates.fingerprintHash = fingerprintHash;
    updates.lastSeenAt = new Date();
    // Only update if there are meaningful changes to reduce DB writes
    if (Object.keys(updates).length > 1) { // >1 because lastSeenAt is always there
      try {
        await prisma.identityGraph.update({
          where: { id: matchedIdentity.id },
          data: updates
        });
      } catch (updateError) {
        if (!isSchemaDriftError(updateError)) throw updateError;

        const fallbackUpdates = { ...updates };
        delete fallbackUpdates.ipHash;
        delete fallbackUpdates.emailHash;
        delete fallbackUpdates.phoneHash;

        if (Object.keys(fallbackUpdates).length > 1) {
          await prisma.identityGraph.update({
            where: { id: matchedIdentity.id },
            data: fallbackUpdates
          });
        }
      }
    }

    if (browserFingerprintHash && matchedIdentity.fingerprintHash !== browserFingerprintHash) {
      try {
        const existingBrowserAlias = await prisma.identityGraph.findFirst({
          where: {
            accountId,
            userKey: matchedIdentity.userKey,
            fingerprintHash: browserFingerprintHash,
          }
        });

        if (!existingBrowserAlias) {
          const aliasData = {
            accountId,
            userKey: matchedIdentity.userKey,
            customerId: matchedIdentity.customerId || payload.customer_id || null,
            emailHash: matchedIdentity.emailHash || emailHash,
            phoneHash: matchedIdentity.phoneHash || phoneHash,
            ipHash: matchedIdentity.ipHash || ipHash,
            fbp: matchedIdentity.fbp || payload.fbp || null,
            fbc: matchedIdentity.fbc || payload.fbc || null,
            fbclid: matchedIdentity.fbclid || payload.fbclid || null,
            gclid: matchedIdentity.gclid || payload.gclid || null,
            ttclid: matchedIdentity.ttclid || payload.ttclid || null,
            fingerprintHash: browserFingerprintHash,
            confidenceScore: Math.max(finalConfidence || 0, 0.98),
          };

          try {
            await prisma.identityGraph.create({ data: aliasData });
          } catch (aliasCreateError) {
            if (!isSchemaDriftError(aliasCreateError)) throw aliasCreateError;

            await prisma.identityGraph.create({
              data: {
                ...aliasData,
                ipHash: undefined,
                emailHash: undefined,
                phoneHash: undefined,
              }
            });
          }
        }
      } catch (aliasError) {
        if (!isSchemaDriftError(aliasError)) throw aliasError;
      }
    }
  }

  // 7. Always set cookie
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
