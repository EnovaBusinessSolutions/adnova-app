'use strict';

/**
 * personResolver.js  — Fase 7
 *
 * Resolves a SessionPacket to a Person record, creating one if needed.
 * Updates Person counters (sessionCount, orderCount, totalSpent) and
 * sets SessionPacket.personId.
 *
 * Resolution tiers:
 *   Tier 1a — visitorId (userKey) already in Person.visitorIds  → deterministic
 *   Tier 1b — emailHash or phoneHash match from a linked Order   → deterministic
 *   Tier 1c — customerId match from a linked Order               → deterministic
 *   Tier 3  — no match → create new Person
 *
 * Tier 2 (probabilistic fingerprint) is deferred — too noisy at current volume.
 */

const { PrismaClient } = require('@prisma/client');

// Reuse the shared prisma client if available via module pattern, else create one.
// In workers, prisma is instantiated at the top of the file and passed in via opts.
// In standalone use (backfill scripts), we create our own.
let _prisma = null;
function getPrisma() {
  if (!_prisma) _prisma = new PrismaClient();
  return _prisma;
}

/**
 * Resolve a SessionPacket to a Person, update counters, set personId.
 *
 * @param {object} packet   — SessionPacket row (must have sessionId, accountId, visitorId, orderId)
 * @param {object} opts
 * @param {object} opts.prisma  — optional shared PrismaClient instance
 * @returns {string}  personId
 */
async function resolvePersonForPacket(packet, opts = {}) {
  const prisma = opts.prisma || getPrisma();
  const { sessionId, accountId, visitorId, orderId } = packet;
  const now = new Date();

  // ── Gather identifiers from linked Order (if any) ──────────────────────────
  let emailHash  = null;
  let phoneHash  = null;
  let customerId = null;
  let orderRevenue = 0;

  if (orderId) {
    const order = await prisma.order.findUnique({
      where: { orderId },
      select: { emailHash: true, phoneHash: true, customerId: true, revenue: true },
    }).catch(() => null);
    if (order) {
      emailHash    = order.emailHash  || null;
      phoneHash    = order.phoneHash  || null;
      customerId   = order.customerId || null;
      orderRevenue = Number(order.revenue) || 0;
    }
  }

  const isPurchased = packet.outcome === 'PURCHASED';

  // ── Tier 1a: visitorId already linked to a Person ─────────────────────────
  let person = visitorId
    ? await prisma.person.findFirst({
        where: { accountId, visitorIds: { has: visitorId } },
      }).catch(() => null)
    : null;

  // ── Tier 1b: emailHash or phoneHash match ─────────────────────────────────
  if (!person && (emailHash || phoneHash)) {
    const orClauses = [];
    if (emailHash)  orClauses.push({ emailHashes: { has: emailHash } });
    if (phoneHash)  orClauses.push({ phoneHashes: { has: phoneHash } });
    person = await prisma.person.findFirst({
      where: { accountId, OR: orClauses },
    }).catch(() => null);
  }

  // ── Tier 1c: customerId match ─────────────────────────────────────────────
  if (!person && customerId) {
    person = await prisma.person.findFirst({
      where: { accountId, customerIds: { has: customerId } },
    }).catch(() => null);
  }

  if (person) {
    // Merge any new identifiers and update counters
    const visitorIds  = mergeArray(person.visitorIds,  visitorId);
    const emailHashes = mergeArray(person.emailHashes, emailHash);
    const phoneHashes = mergeArray(person.phoneHashes, phoneHash);
    const customerIds = mergeArray(person.customerIds, customerId);

    person = await prisma.person.update({
      where: { id: person.id },
      data: {
        visitorIds,
        emailHashes,
        phoneHashes,
        customerIds,
        lastSeenAt:   now,
        sessionCount: { increment: 1 },
        ...(isPurchased ? {
          orderCount: { increment: 1 },
          totalSpent: { increment: orderRevenue },
        } : {}),
      },
    }).catch((err) => {
      console.error('[personResolver] update failed:', err.message);
      return person; // return stale copy — personId still usable
    });
  } else {
    // Tier 3: create new Person
    person = await prisma.person.create({
      data: {
        accountId,
        visitorIds:  visitorId  ? [visitorId]  : [],
        emailHashes: emailHash  ? [emailHash]  : [],
        phoneHashes: phoneHash  ? [phoneHash]  : [],
        customerIds: customerId ? [customerId] : [],
        firstSeenAt: packet.startTs || now,
        lastSeenAt:  now,
        sessionCount: 1,
        orderCount:  isPurchased ? 1 : 0,
        totalSpent:  isPurchased ? orderRevenue : 0,
      },
    }).catch((err) => {
      console.error('[personResolver] create failed:', err.message);
      return null;
    });
  }

  if (!person) return null;

  // ── Set personId on the SessionPacket ────────────────────────────────────
  await prisma.sessionPacket.update({
    where: { sessionId },
    data: { personId: person.id },
  }).catch((err) => console.error('[personResolver] personId update failed:', err.message));

  return person.id;
}

function mergeArray(existing = [], newValue) {
  if (!newValue) return existing;
  return existing.includes(newValue) ? existing : [...existing, newValue];
}

/**
 * Backfill: create Person records from existing Orders, grouping by
 * emailHash → phoneHash → customerId → userKey.
 * Safe to run multiple times (upsert by visitorId).
 *
 * @param {object} opts
 * @param {object} opts.prisma
 * @param {string} opts.accountId  — optional, limit to one account
 */
async function backfillPersonsFromOrders(opts = {}) {
  const prisma = opts.prisma || getPrisma();
  const where  = opts.accountId ? { accountId: opts.accountId } : {};

  const orders = await prisma.order.findMany({
    where,
    select: {
      accountId: true, userKey: true, customerId: true,
      emailHash: true, phoneHash: true,
      revenue: true, platformCreatedAt: true,
    },
    orderBy: { platformCreatedAt: 'asc' },
  });

  let created = 0, merged = 0;

  for (const order of orders) {
    const { accountId, userKey, customerId, emailHash, phoneHash } = order;
    const revenue = Number(order.revenue) || 0;
    const orderAt = order.platformCreatedAt || new Date();

    // Find existing Person
    const orClauses = [];
    if (userKey)    orClauses.push({ visitorIds:  { has: userKey } });
    if (emailHash)  orClauses.push({ emailHashes: { has: emailHash } });
    if (phoneHash)  orClauses.push({ phoneHashes: { has: phoneHash } });
    if (customerId) orClauses.push({ customerIds: { has: customerId } });

    let person = orClauses.length
      ? await prisma.person.findFirst({ where: { accountId, OR: orClauses } }).catch(() => null)
      : null;

    if (person) {
      await prisma.person.update({
        where: { id: person.id },
        data: {
          visitorIds:  mergeArray(person.visitorIds,  userKey),
          emailHashes: mergeArray(person.emailHashes, emailHash),
          phoneHashes: mergeArray(person.phoneHashes, phoneHash),
          customerIds: mergeArray(person.customerIds, customerId),
          lastSeenAt:  orderAt > person.lastSeenAt ? orderAt : person.lastSeenAt,
          orderCount:  { increment: 1 },
          totalSpent:  { increment: revenue },
        },
      }).catch(() => {});
      merged++;
    } else {
      await prisma.person.create({
        data: {
          accountId,
          visitorIds:  userKey    ? [userKey]    : [],
          emailHashes: emailHash  ? [emailHash]  : [],
          phoneHashes: phoneHash  ? [phoneHash]  : [],
          customerIds: customerId ? [customerId] : [],
          firstSeenAt: orderAt,
          lastSeenAt:  orderAt,
          sessionCount: 0,
          orderCount:  1,
          totalSpent:  revenue,
        },
      }).catch(() => {});
      created++;
    }
  }

  return { created, merged, total: orders.length };
}

module.exports = { resolvePersonForPacket, backfillPersonsFromOrders };
