"use strict";

/**
 * backfillAnalyticsProV2.js
 * - Backfill "pro" para analyticsevents:
 *   - 1 evento por usuario por tipo (dedupeKey estable)
 *   - Actualiza ts/props (no solo insert)
 *   - Heurística para pixel_audit_completed desde audits (best-effort)
 *   - Limpieza opcional de backfills viejos (para alinear)
 *
 * ENV:
 * - MONGO_URI o MONGODB_URI
 * - DRY_RUN=1            -> no escribe
 * - LIMIT_USERS=500      -> limita usuarios procesados (opcional)
 * - RESET_BACKFILL=1     -> borra solo eventos backfill antes de regenerar
 * - BATCH_SIZE=200       -> tamaño de batch (default 200)
 */

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });

const mongoose = require("mongoose");

const User = require("../models/User");
const AnalyticsEvent = require("../models/AnalyticsEvent");
const GoogleAccount = require("../models/GoogleAccount");
const MetaAccount = require("../models/MetaAccount");

// Opcional: si tu modelo existe
let Audit = null;
try {
  Audit = require("../models/Audit");
} catch (_) {
  Audit = null;
}

const DRY_RUN = String(process.env.DRY_RUN || "").trim() === "1";
const RESET_BACKFILL = String(process.env.RESET_BACKFILL || "").trim() === "1";
const LIMIT_USERS = Number(process.env.LIMIT_USERS || 0) || 0;
const BATCH_SIZE = Number(process.env.BATCH_SIZE || 200) || 200;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function withRetry(fn, opts) {
  const retries = Number(opts?.retries ?? 3);
  const baseDelayMs = Number(opts?.baseDelayMs ?? 300);
  let lastErr = null;

  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const msg = String(e?.message || "");
      const code = String(e?.code || "");
      const isNet =
        code === "ECONNRESET" ||
        code === "ETIMEDOUT" ||
        code === "ENOTFOUND" ||
        msg.includes("ECONNRESET") ||
        msg.toLowerCase().includes("timed out") ||
        msg.toLowerCase().includes("socket");

      if (!isNet || i === retries) break;

      const wait = baseDelayMs * Math.pow(2, i);
      console.warn(`[backfill-pro-v2] retry ${i + 1}/${retries} after ${wait}ms due to:`, code || msg);
      await sleep(wait);
    }
  }

  throw lastErr;
}

function objectIdToDate(oid) {
  try {
    const ts = String(oid).slice(0, 8);
    const ms = parseInt(ts, 16) * 1000;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

function asDateSafe(x) {
  if (!x) return null;
  const d = x instanceof Date ? x : new Date(x);
  return isNaN(d.getTime()) ? null : d;
}

function minDate(a, b) {
  const da = asDateSafe(a);
  const db = asDateSafe(b);
  if (!da && !db) return null;
  if (!da) return db;
  if (!db) return da;
  return da.getTime() <= db.getTime() ? da : db;
}

function maxDate(a, b) {
  const da = asDateSafe(a);
  const db = asDateSafe(b);
  if (!da && !db) return null;
  if (!da) return db;
  if (!db) return da;
  return da.getTime() >= db.getTime() ? da : db;
}

/**
 * ✅ UPSERT estable:
 * - filtro por dedupeKey (único por diseño)
 * - $set sobreescribe ts/props para alinear el panel
 */
async function upsertEventStable({ name, userId, ts, source, dedupeKey, props }) {
  if (!name || !userId || !dedupeKey) return null;

  const docTs = asDateSafe(ts) || new Date();

  const doc = {
    name,
    userId,
    ts: docTs,
    source: source || "server_backfill",
    dedupeKey,
    props: props || {},
    updatedAt: new Date(),
  };

  const update = {
    $set: doc,
    $setOnInsert: {
      createdAt: docTs, // si es backfill, createdAt consistente con ts
      firstSeenAt: docTs,
    },
  };

  if (DRY_RUN) return { dryRun: true, name, userId: String(userId), ts: docTs, dedupeKey };

  return withRetry(
    () =>
      AnalyticsEvent.findOneAndUpdate(
        { dedupeKey }, // ✅ único
        update,
        { upsert: true, new: true }
      ),
    { retries: 3, baseDelayMs: 400 }
  );
}

function bump(counters, key, inc = 1) {
  counters[key] = (counters[key] || 0) + inc;
}

async function run() {
  const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!MONGO_URI) {
    console.error("Missing MONGO_URI / MONGODB_URI");
    process.exit(1);
  }

  await mongoose.connect(MONGO_URI, {
    serverSelectionTimeoutMS: 15000,
    socketTimeoutMS: 60000,
    connectTimeoutMS: 30000,
    family: 4,
  });

  console.log("[backfill-pro-v2] connected", DRY_RUN ? "(DRY_RUN=1)" : "", RESET_BACKFILL ? "(RESET_BACKFILL=1)" : "");

  const counters = Object.create(null);

  // =========================
  // 0) Reset (solo backfill) -> PARA ALINEAR
  // =========================
  if (!DRY_RUN && RESET_BACKFILL) {
    const del = await withRetry(
      () =>
        AnalyticsEvent.deleteMany({
          $or: [{ source: "server_backfill" }, { "props.backfill": true }],
        }),
      { retries: 3, baseDelayMs: 500 }
    );
    console.log("[backfill-pro-v2] deleted old backfill docs:", del?.deletedCount ?? 0);
  }

  // =========================
  // 1) Load users (base)
  // =========================
  const users = await withRetry(
    () =>
      User.find(
        {},
        {
          _id: 1,
          createdAt: 1,
          updatedAt: 1,
          welcomeEmailSent: 1,
          welcomeEmailSentAt: 1,
          emailVerified: 1,
          metaConnected: 1,
          googleConnected: 1,
        }
      ).lean(),
    { retries: 3, baseDelayMs: 500 }
  );

  const usersToProcess = LIMIT_USERS ? users.slice(0, LIMIT_USERS) : users;
  console.log("[backfill-pro-v2] users:", usersToProcess.length, LIMIT_USERS ? `(LIMIT_USERS=${LIMIT_USERS})` : "");

  // =========================
  // 2) GoogleAccounts aggregated per user
  // =========================
  const googleAccounts = await withRetry(
    () =>
      GoogleAccount.find(
        {},
        {
          _id: 1,
          user: 1,
          userId: 1,
          createdAt: 1,
          updatedAt: 1,
          selectedCustomerIds: 1,
          selectedPropertyIds: 1,
          selectedGaPropertyId: 1,
          ad_accounts: 1,
          customers: 1,
          gaProperties: 1,
          ga_properties: 1,
        }
      ).lean(),
    { retries: 3, baseDelayMs: 500 }
  );

  const googleByUser = new Map(); // userId -> aggregate
  for (const a of googleAccounts) {
    const userId = a.userId || a.user || null;
    if (!userId) continue;

    const createdTs = a.createdAt || objectIdToDate(a._id) || null;
    const updatedTs = a.updatedAt || createdTs || null;

    const adsDiscovered =
      (Array.isArray(a.ad_accounts) && a.ad_accounts.length > 0) ||
      (Array.isArray(a.customers) && a.customers.length > 0);

    const gaPropsArr = Array.isArray(a.gaProperties)
      ? a.gaProperties
      : Array.isArray(a.ga_properties)
      ? a.ga_properties
      : [];

    const ga4Discovered = gaPropsArr.length > 0;

    const hasAdsSelection = Array.isArray(a.selectedCustomerIds) && a.selectedCustomerIds.length > 0;

    const hasGa4Selection =
      (Array.isArray(a.selectedPropertyIds) && a.selectedPropertyIds.length > 0) ||
      !!a.selectedGaPropertyId;

    const prev = googleByUser.get(String(userId)) || {
      firstConnectedAt: null,
      lastUpdatedAt: null,
      firstAdsDiscoveredAt: null,
      lastAdsDiscoveredAt: null,
      firstGa4DiscoveredAt: null,
      lastGa4DiscoveredAt: null,
      firstAdsSelectedAt: null,
      lastAdsSelectedAt: null,
      firstGa4SelectedAt: null,
      lastGa4SelectedAt: null,
      adsSelectedMaxCount: 0,
      ga4SelectedMaxCount: 0,
      docs: 0,
    };

    prev.docs += 1;
    prev.firstConnectedAt = minDate(prev.firstConnectedAt, createdTs);
    prev.lastUpdatedAt = maxDate(prev.lastUpdatedAt, updatedTs);

    if (adsDiscovered) {
      prev.firstAdsDiscoveredAt = minDate(prev.firstAdsDiscoveredAt, updatedTs);
      prev.lastAdsDiscoveredAt = maxDate(prev.lastAdsDiscoveredAt, updatedTs);
    }
    if (ga4Discovered) {
      prev.firstGa4DiscoveredAt = minDate(prev.firstGa4DiscoveredAt, updatedTs);
      prev.lastGa4DiscoveredAt = maxDate(prev.lastGa4DiscoveredAt, updatedTs);
    }
    if (hasAdsSelection) {
      prev.firstAdsSelectedAt = minDate(prev.firstAdsSelectedAt, updatedTs);
      prev.lastAdsSelectedAt = maxDate(prev.lastAdsSelectedAt, updatedTs);
      prev.adsSelectedMaxCount = Math.max(prev.adsSelectedMaxCount, a.selectedCustomerIds.length);
    }
    if (hasGa4Selection) {
      const c = Array.isArray(a.selectedPropertyIds) ? a.selectedPropertyIds.length : 1;
      prev.firstGa4SelectedAt = minDate(prev.firstGa4SelectedAt, updatedTs);
      prev.lastGa4SelectedAt = maxDate(prev.lastGa4SelectedAt, updatedTs);
      prev.ga4SelectedMaxCount = Math.max(prev.ga4SelectedMaxCount, c);
    }

    googleByUser.set(String(userId), prev);
  }

  // =========================
  // 3) MetaAccounts aggregated per user
  // =========================
  const metaAccounts = await withRetry(
    () =>
      MetaAccount.find(
        {},
        {
          _id: 1,
          user: 1,
          userId: 1,
          createdAt: 1,
          updatedAt: 1,
          selectedAccountIds: 1,
          defaultAccountId: 1,
          ad_accounts: 1,
          adAccounts: 1,
        }
      ).lean(),
    { retries: 3, baseDelayMs: 500 }
  );

  const metaByUser = new Map();
  for (const a of metaAccounts) {
    const userId = a.userId || a.user || null;
    if (!userId) continue;

    const createdTs = a.createdAt || objectIdToDate(a._id) || null;
    const updatedTs = a.updatedAt || createdTs || null;

    const discovered =
      (Array.isArray(a.ad_accounts) && a.ad_accounts.length > 0) ||
      (Array.isArray(a.adAccounts) && a.adAccounts.length > 0);

    const hasSelection = Array.isArray(a.selectedAccountIds) && a.selectedAccountIds.length > 0;

    const prev = metaByUser.get(String(userId)) || {
      firstConnectedAt: null,
      lastUpdatedAt: null,
      firstAdsDiscoveredAt: null,
      lastAdsDiscoveredAt: null,
      firstAdsSelectedAt: null,
      lastAdsSelectedAt: null,
      adsSelectedMaxCount: 0,
      docs: 0,
    };

    prev.docs += 1;
    prev.firstConnectedAt = minDate(prev.firstConnectedAt, createdTs);
    prev.lastUpdatedAt = maxDate(prev.lastUpdatedAt, updatedTs);

    if (discovered) {
      prev.firstAdsDiscoveredAt = minDate(prev.firstAdsDiscoveredAt, updatedTs);
      prev.lastAdsDiscoveredAt = maxDate(prev.lastAdsDiscoveredAt, updatedTs);
    }
    if (hasSelection) {
      prev.firstAdsSelectedAt = minDate(prev.firstAdsSelectedAt, updatedTs);
      prev.lastAdsSelectedAt = maxDate(prev.lastAdsSelectedAt, updatedTs);
      prev.adsSelectedMaxCount = Math.max(prev.adsSelectedMaxCount, a.selectedAccountIds.length);
    }

    metaByUser.set(String(userId), prev);
  }

  // =========================
  // 4) Pixel audit backfill (best-effort)
  // =========================
  const pixelByUser = new Map(); // userId -> { firstCompletedAt, lastCompletedAt, docs }
  if (Audit) {
    const pixelAudits = await withRetry(
      () =>
        Audit.find(
          {
            $or: [
              { type: "pixel" },
              { type: "pixel_audit" },
              { source: "pixel" },
              { source: "pixel_auditor" },
              { tool: "pixel" },
              { tool: "pixel_auditor" },
              { kind: "pixel" },
              { kind: "pixel_auditor" },
              { name: "pixel_audit" },
              { name: "pixel_auditor" },
            ],
          },
          { _id: 1, userId: 1, createdAt: 1, updatedAt: 1, type: 1, source: 1, tool: 1, kind: 1, name: 1 }
        ).lean(),
      { retries: 3, baseDelayMs: 600 }
    ).catch(() => []);

    for (const a of pixelAudits || []) {
      const userId = a.userId || null;
      if (!userId) continue;

      const createdTs = a.createdAt || objectIdToDate(a._id) || null;
      const updatedTs = a.updatedAt || createdTs || null;

      const prev = pixelByUser.get(String(userId)) || {
        firstCompletedAt: null,
        lastCompletedAt: null,
        docs: 0,
      };

      prev.docs += 1;
      prev.firstCompletedAt = minDate(prev.firstCompletedAt, createdTs);
      prev.lastCompletedAt = maxDate(prev.lastCompletedAt, updatedTs);

      pixelByUser.set(String(userId), prev);
    }

    console.log("[backfill-pro-v2] pixel audits matched:", pixelByUser.size);
  } else {
    console.log("[backfill-pro-v2] Audit model not found -> skipping pixel_audit_completed backfill");
  }

  // =========================
  // 5) Apply backfill per user (batched)
  // =========================
  for (let i = 0; i < usersToProcess.length; i++) {
    const u = usersToProcess[i];
    const userId = u._id;
    const userKey = String(userId);

    const createdTs = u.createdAt || objectIdToDate(u._id) || new Date();
    const updatedTs = u.updatedAt || createdTs;

    // user_signed_up
    await upsertEventStable({
      name: "user_signed_up",
      userId,
      ts: createdTs,
      source: "server_backfill",
      dedupeKey: `user_signed_up:${userKey}`,
      props: { backfill: true, sourceCollection: "users" },
    });
    bump(counters, "user_signed_up");

    // welcome_email_sent (si existe)
    if (u.welcomeEmailSent && u.welcomeEmailSentAt) {
      await upsertEventStable({
        name: "welcome_email_sent",
        userId,
        ts: new Date(u.welcomeEmailSentAt),
        source: "server_backfill",
        dedupeKey: `welcome_email_sent:${userKey}`,
        props: { backfill: true, sourceCollection: "users" },
      });
      bump(counters, "welcome_email_sent");
    }

    // email_verified (sin timestamp exacto, usamos updatedAt)
    if (u.emailVerified) {
      await upsertEventStable({
        name: "email_verified",
        userId,
        ts: updatedTs,
        source: "server_backfill",
        dedupeKey: `email_verified:${userKey}`,
        props: { backfill: true, inferred: true, sourceCollection: "users" },
      });
      bump(counters, "email_verified");
    }

    // GOOGLE (por agregado)
    const g = googleByUser.get(userKey);
    if (g && g.firstConnectedAt) {
      await upsertEventStable({
        name: "google_connected",
        userId,
        ts: g.firstConnectedAt,
        source: "server_backfill",
        dedupeKey: `google_connected:${userKey}`,
        props: { backfill: true, aggDocs: g.docs, firstConnectedAt: g.firstConnectedAt, lastUpdatedAt: g.lastUpdatedAt },
      });
      bump(counters, "google_connected");
    }

    if (g && g.firstAdsDiscoveredAt) {
      await upsertEventStable({
        name: "google_ads_discovered",
        userId,
        ts: g.firstAdsDiscoveredAt,
        source: "server_backfill",
        dedupeKey: `google_ads_discovered:${userKey}`,
        props: { backfill: true, aggDocs: g.docs, firstDiscoveredAt: g.firstAdsDiscoveredAt, lastDiscoveredAt: g.lastAdsDiscoveredAt },
      });
      bump(counters, "google_ads_discovered");
    }

    if (g && g.firstAdsSelectedAt) {
      await upsertEventStable({
        name: "google_ads_selected",
        userId,
        ts: g.firstAdsSelectedAt,
        source: "server_backfill",
        dedupeKey: `google_ads_selected:${userKey}`,
        props: { backfill: true, aggDocs: g.docs, firstSelectedAt: g.firstAdsSelectedAt, lastSelectedAt: g.lastAdsSelectedAt, selectedMaxCount: g.adsSelectedMaxCount || 0 },
      });
      bump(counters, "google_ads_selected");
    }

    if (g && g.firstGa4DiscoveredAt) {
      await upsertEventStable({
        name: "ga4_discovered",
        userId,
        ts: g.firstGa4DiscoveredAt,
        source: "server_backfill",
        dedupeKey: `ga4_discovered:${userKey}`,
        props: { backfill: true, aggDocs: g.docs, firstDiscoveredAt: g.firstGa4DiscoveredAt, lastDiscoveredAt: g.lastGa4DiscoveredAt },
      });
      bump(counters, "ga4_discovered");
    }

    if (g && g.firstGa4SelectedAt) {
      await upsertEventStable({
        name: "ga4_selected",
        userId,
        ts: g.firstGa4SelectedAt,
        source: "server_backfill",
        dedupeKey: `ga4_selected:${userKey}`,
        props: { backfill: true, aggDocs: g.docs, firstSelectedAt: g.firstGa4SelectedAt, lastSelectedAt: g.lastGa4SelectedAt, selectedMaxCount: g.ga4SelectedMaxCount || 0 },
      });
      bump(counters, "ga4_selected");
    }

    // META (por agregado)
    const m = metaByUser.get(userKey);
    if (m && m.firstConnectedAt) {
      await upsertEventStable({
        name: "meta_connected",
        userId,
        ts: m.firstConnectedAt,
        source: "server_backfill",
        dedupeKey: `meta_connected:${userKey}`,
        props: { backfill: true, aggDocs: m.docs, firstConnectedAt: m.firstConnectedAt, lastUpdatedAt: m.lastUpdatedAt },
      });
      bump(counters, "meta_connected");
    } else if (u.metaConnected) {
      await upsertEventStable({
        name: "meta_connected",
        userId,
        ts: createdTs,
        source: "server_backfill",
        dedupeKey: `meta_connected:${userKey}`,
        props: { backfill: true, inferredFromUser: true, note: "User.metaConnected true but no MetaAccount doc found" },
      });
      bump(counters, "meta_connected");
    }

    if (m && m.firstAdsDiscoveredAt) {
      await upsertEventStable({
        name: "meta_ads_discovered",
        userId,
        ts: m.firstAdsDiscoveredAt,
        source: "server_backfill",
        dedupeKey: `meta_ads_discovered:${userKey}`,
        props: { backfill: true, aggDocs: m.docs, firstDiscoveredAt: m.firstAdsDiscoveredAt, lastDiscoveredAt: m.lastAdsDiscoveredAt },
      });
      bump(counters, "meta_ads_discovered");
    }

    if (m && m.firstAdsSelectedAt) {
      await upsertEventStable({
        name: "meta_ads_selected",
        userId,
        ts: m.firstAdsSelectedAt,
        source: "server_backfill",
        dedupeKey: `meta_ads_selected:${userKey}`,
        props: { backfill: true, aggDocs: m.docs, firstSelectedAt: m.firstAdsSelectedAt, lastSelectedAt: m.lastAdsSelectedAt, selectedMaxCount: m.adsSelectedMaxCount || 0 },
      });
      bump(counters, "meta_ads_selected");
    }

    // PIXEL AUDIT (best-effort)
    const p = pixelByUser.get(userKey);
    if (p && p.firstCompletedAt) {
      await upsertEventStable({
        name: "pixel_audit_completed",
        userId,
        ts: p.firstCompletedAt,
        source: "server_backfill",
        dedupeKey: `pixel_audit_completed:${userKey}`,
        props: { backfill: true, aggDocs: p.docs, firstCompletedAt: p.firstCompletedAt, lastCompletedAt: p.lastCompletedAt, note: "Derived from Audit collection heuristic" },
      });
      bump(counters, "pixel_audit_completed");
    }

    // Pausa y log por batch (reduce chance de ECONNRESET)
    const isBatchEnd = (i + 1) % BATCH_SIZE === 0;
    if (isBatchEnd) {
      console.log(`[backfill-pro-v2] progress ${i + 1}/${usersToProcess.length} | counters snapshot:`, {
        user_signed_up: counters.user_signed_up || 0,
        welcome_email_sent: counters.welcome_email_sent || 0,
        email_verified: counters.email_verified || 0,
        google_connected: counters.google_connected || 0,
        meta_connected: counters.meta_connected || 0,
        pixel_audit_completed: counters.pixel_audit_completed || 0,
      });
      await sleep(150);
    }
  }

  console.log("[backfill-pro-v2] counters:", counters);
  await mongoose.disconnect();
  console.log("[backfill-pro-v2] disconnected");
}

run().catch((e) => {
  console.error("[backfill-pro-v2] fatal:", e);
  process.exit(1);
});
