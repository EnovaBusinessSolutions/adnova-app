"use strict";

const express = require("express");
const mongoose = require("mongoose");
const crypto = require("crypto");

const router = express.Router();

/* =========================
 * Models (robustos)
 * ========================= */
let AnalyticsEvent = null;
try {
  AnalyticsEvent = require("../models/AnalyticsEvent");
} catch (e) {
  const { Schema, model } = mongoose;
  AnalyticsEvent =
    mongoose.models.AnalyticsEvent ||
    model(
      "AnalyticsEvent",
      new Schema({}, { strict: false, collection: "analyticsevents" })
    );
}

let User = null;
try {
  User = require("../models/User");
} catch {
  User = null;
}

// ✅ OPTIONAL: modelos para enriquecer tabla CRM (best-effort)
let GoogleAccount = null;
try {
  GoogleAccount = require("../models/GoogleAccount");
} catch {
  GoogleAccount = null;
}

let MetaAccount = null;
try {
  MetaAccount = require("../models/MetaAccount");
} catch {
  MetaAccount = null;
}

/* =========================
 * Helpers
 * ========================= */
function parseDateMaybe(v) {
  if (!v) return null;
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? null : d;
}

function normalizeRange(from, to) {
  if (from && to && from.getTime() > to.getTime()) {
    return { from: to, to: from, swapped: true };
  }
  return { from, to, swapped: false };
}

function clampInt(n, min, max, fallback) {
  const x = Number.parseInt(n, 10);
  if (!Number.isFinite(x)) return fallback;
  return Math.max(min, Math.min(max, x));
}

function toObjectIdMaybe(v) {
  if (!v) return null;
  try {
    return new mongoose.Types.ObjectId(String(v));
  } catch {
    return null;
  }
}

function getEmailFromReq(req) {
  return String(req?.user?.email || req?.user?.emails?.[0]?.value || "")
    .trim()
    .toLowerCase();
}

function getRoleFromReq(req) {
  return String(req?.user?.role || req?.user?.kind || req?.user?.accountType || "")
    .trim()
    .toLowerCase();
}

function parseAllowlistEmails(envVal) {
  return String(envVal || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

// ObjectId -> fecha aproximada (si createdAt/ts no existe)
function objectIdToDate(oid) {
  try {
    const ts = String(oid).slice(0, 8);
    const ms = Number.parseInt(ts, 16) * 1000;
    if (!Number.isFinite(ms)) return null;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

function safeTokenEquals(a, b) {
  try {
    const aa = Buffer.from(String(a || ""), "utf8");
    const bb = Buffer.from(String(b || ""), "utf8");
    if (!aa.length || !bb.length) return false;
    if (aa.length !== bb.length) return false;
    return crypto.timingSafeEqual(aa, bb);
  } catch {
    return false;
  }
}

/**
 * ✅ Middleware de acceso interno
 */
function requireInternalAdmin(req, res, next) {
  try {
    const token =
      String(req.headers["x-internal-admin-token"] || "").trim() ||
      String(req.query.token || "").trim();

    const envToken = String(process.env.INTERNAL_ADMIN_TOKEN || "").trim();
    const tokenOk = token && envToken && safeTokenEquals(token, envToken);

    if (tokenOk) return next();

    const authed = !!(req.isAuthenticated && req.isAuthenticated());
    if (!authed || !req.user) {
      return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    }

    const email = getEmailFromReq(req);
    const role = getRoleFromReq(req);

    const allowedRoles = new Set(["admin", "internal", "staff"]);
    if (allowedRoles.has(role)) return next();

    const allowEmails = parseAllowlistEmails(process.env.INTERNAL_ADMIN_EMAILS);
    if (email && allowEmails.includes(email)) return next();

    return res.status(403).json({ ok: false, error: "FORBIDDEN" });
  } catch {
    return res.status(403).json({ ok: false, error: "FORBIDDEN" });
  }
}

/* =========================
 * ✅ Fecha canónica (robusta)
 * ========================= */
function buildDateMatch(from, to) {
  if (!from && !to) return null;

  const tsRange = {};
  if (from) tsRange.$gte = from;
  if (to) tsRange.$lte = to;

  const caRange = {};
  if (from) caRange.$gte = from;
  if (to) caRange.$lte = to;

  return {
    $or: [
      { ts: tsRange },
      { ts: { $exists: false }, createdAt: caRange },
      { ts: null, createdAt: caRange },
    ],
  };
}

function resolveEffectiveDate(doc) {
  return doc?.ts || doc?.createdAt || objectIdToDate(doc?._id) || null;
}

function pickFirstTruthy(...vals) {
  for (const v of vals) {
    if (v === undefined || v === null) continue;
    if (typeof v === "string" && !v.trim()) continue;
    return v;
  }
  return null;
}

function toISO(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/* ---------------------- */
/* User field resolvers    */
/* ---------------------- */
function resolveUserRegisteredAt(u) {
  return (
    u?.createdAt ||
    u?.created_at ||
    u?.signupAt ||
    u?.signup_at ||
    objectIdToDate(u?._id) ||
    null
  );
}

function resolveUserLastLoginAt(u) {
  return (
    u?.lastLoginAt ||
    u?.last_login_at ||
    u?.lastLogin ||
    u?.last_login ||
    u?.lastSignInAt ||
    u?.last_sign_in_at ||
    null
  );
}

function resolveUserName(u) {
  return pickFirstTruthy(
    u?.name,
    u?.fullName,
    u?.full_name,
    u?.displayName,
    u?.display_name,
    u?.profile?.name
  );
}

function resolveUserEmail(u) {
  return pickFirstTruthy(u?.email, u?.emails?.[0]?.value, u?.profile?.email);
}

/* ---------------------- */
/* Metrics best-effort     */
/* ---------------------- */
function numMaybe(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function dig(obj, paths) {
  for (const p of paths) {
    try {
      const parts = String(p).split(".");
      let cur = obj;
      for (const key of parts) {
        if (!cur) break;
        cur = cur[key];
      }
      if (cur !== undefined && cur !== null) return cur;
    } catch {}
  }
  return null;
}

/**
 * Intenta leer “spend/cost 30d” desde documentos cacheados,
 * SIN llamar APIs externas.
 */
function resolveGoogleSpend30dFromDoc(gd) {
  if (!gd) return null;

  // números directos
  const direct = dig(gd, [
    "googleSpend30d",
    "spend30d",
    "cost30d",
    "kpis.spend30d",
    "kpis.cost30d",
    "summary.spend30d",
    "summary.cost30d",
    "overview.spend30d",
    "overview.cost30d",
    "overview.cost",
    "overview.spend",
    "last30d.spend",
    "last30d.cost",
    "last30Days.spend",
    "last30Days.cost",
  ]);
  const n = numMaybe(direct);
  if (n !== null) return n;

  // micros (Google Ads suele traer cost_micros)
  const micros = dig(gd, [
    "overview.cost_micros",
    "overview.costMicros",
    "last30d.cost_micros",
    "last30Days.cost_micros",
  ]);
  const m = numMaybe(micros);
  if (m !== null) return Math.round(m / 1_000_000);

  return null;
}

function resolveGaSessions30dFromDoc(gd) {
  if (!gd) return null;

  const direct = dig(gd, [
    "ga4Sessions30d",
    "gaSessions30d",
    "sessions30d",
    "ga4.sessions30d",
    "ga4.kpis.sessions30d",
    "ga4.summary.sessions30d",
    "ga4.overview.sessions",
    "ga4.overview.sessions30d",
    "gaOverview.sessions",
    "gaOverview.sessions30d",
    "overviewGA4.sessions",
    "overviewGA4.sessions30d",
  ]);
  const n = numMaybe(direct);
  return n !== null ? Math.round(n) : null;
}

function resolveMetaSpend30dFromDoc(md) {
  if (!md) return null;

  const direct = dig(md, [
    "metaSpend30d",
    "spend30d",
    "kpis.spend30d",
    "summary.spend30d",
    "overview.spend30d",
    "overview.spend",
    "last30d.spend",
    "last30Days.spend",
  ]);
  const n = numMaybe(direct);
  return n !== null ? n : null;
}

/* ---------------------- */
/* Selections (canonical)  */
/* ---------------------- */
function splitIdNameDisplay(display) {
  const s = String(display || "").trim();
  if (!s) return { id: null, name: null, display: null };

  // "123 (Name)" o "act_123 (Name)"
  const m = s.match(/^(.+?)\s*\((.+)\)\s*$/);
  if (m) {
    return { id: String(m[1]).trim(), name: String(m[2]).trim(), display: s };
  }
  return { id: s, name: null, display: s };
}

function resolveMetaSelected(md, u) {
  const selectedId =
    pickFirstTruthy(
      md?.selectedAccountIds?.[0],
      md?.defaultAccountId,
      md?.ad_accounts?.[0]?.id,
      md?.adAccounts?.[0]?.id
    ) || null;

  const fallbackFromUser =
    pickFirstTruthy(
      u?.selectedMetaAccounts?.[0],
      u?.preferences?.meta?.auditAccountIds?.[0]
    ) || null;

  const id = selectedId || fallbackFromUser;
  if (!id) return { id: null, name: null, display: null };

  const list =
    (Array.isArray(md?.ad_accounts) && md.ad_accounts.length
      ? md.ad_accounts
      : null) ||
    (Array.isArray(md?.adAccounts) && md.adAccounts.length
      ? md.adAccounts
      : null) ||
    [];

  const found = list.find(
    (a) => String(a?.id || a?.account_id || "").trim() === String(id).trim()
  );

  const name = pickFirstTruthy(
    found?.name,
    found?.account_name,
    md?.name,
    md?.email
  );

  const display = name ? `${id} (${name})` : String(id);
  const parts = splitIdNameDisplay(display);
  return { id: String(id), name: name ? String(name) : parts.name, display };
}

function resolveGoogleAdsSelected(gd, u) {
  const selectedId =
    pickFirstTruthy(
      gd?.selectedCustomerIds?.[0],
      gd?.defaultCustomerId,
      gd?.ad_accounts?.[0]?.id,
      gd?.customers?.[0]?.id
    ) || null;

  const fallbackFromUser =
    pickFirstTruthy(
      u?.selectedGoogleAccounts?.[0],
      u?.preferences?.googleAds?.auditAccountIds?.[0]
    ) || null;

  const id = selectedId || fallbackFromUser;
  if (!id) return { id: null, name: null, display: null };

  const adAcc = Array.isArray(gd?.ad_accounts) ? gd.ad_accounts : [];
  const custs = Array.isArray(gd?.customers) ? gd.customers : [];

  const foundAd = adAcc.find((a) => String(a?.id || "").trim() === String(id).trim());
  const foundCu = custs.find((c) => String(c?.id || "").trim() === String(id).trim());

  const name = pickFirstTruthy(foundAd?.name, foundCu?.descriptiveName, foundCu?.descriptive_name);
  const display = name ? `${id} (${name})` : String(id);
  return { id: String(id), name: name ? String(name) : null, display };
}

function resolveGA4Selected(gd, u) {
  const selectedId =
    pickFirstTruthy(
      gd?.selectedPropertyIds?.[0],
      gd?.defaultPropertyId,
      gd?.gaProperties?.[0]?.propertyId
    ) || null;

  const fallbackFromUser =
    pickFirstTruthy(
      u?.preferences?.googleAnalytics?.auditPropertyIds?.[0],
      u?.selectedGAProperties?.[0]
    ) || null;

  const id = selectedId || fallbackFromUser;
  if (!id) return { id: null, name: null, display: null };

  const props = Array.isArray(gd?.gaProperties) ? gd.gaProperties : [];
  const found = props.find(
    (p) => String(p?.propertyId || "").trim() === String(id).trim()
  );

  const name = pickFirstTruthy(found?.displayName);
  const display = name ? `${id} (${name})` : String(id);
  return { id: String(id), name: name ? String(name) : null, display };
}

/* =========================
 * ✅ GET /api/admin/analytics/health
 * ========================= */
router.get("/health", requireInternalAdmin, async (_req, res) => {
  try {
    const data = {
      ok: true,
      env: process.env.NODE_ENV || "development",
      version: process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || null,
      db: mongoose.connection?.readyState === 1 ? "connected" : "not_connected",
      ts: new Date().toISOString(),
    };
    return res.json({ ok: true, data });
  } catch (_e) {
    return res.status(500).json({ ok: false, error: "HEALTH_ERROR" });
  }
});

/* =========================
 * ✅ GET /api/admin/analytics/summary?from=&to=
 * ========================= */
router.get("/summary", requireInternalAdmin, async (req, res) => {
  try {
    let from = parseDateMaybe(req.query.from);
    let to = parseDateMaybe(req.query.to);
    const norm = normalizeRange(from, to);
    from = norm.from;
    to = norm.to;

    const dateMatch = buildDateMatch(from, to);
    const match = dateMatch ? { ...dateMatch } : {};

    const now = new Date();
    const d24 = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const d7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const match24 = buildDateMatch(d24, null) || {};
    const match7 = buildDateMatch(d7, null) || {};

    const [totals, topNames, last24h, last7d, signups] = await Promise.all([
      AnalyticsEvent.aggregate([
        { $match: match },
        {
          $group: {
            _id: null,
            events: { $sum: 1 },
            users: { $addToSet: "$userId" },
          },
        },
        { $project: { _id: 0, events: 1, uniqueUsers: { $size: "$users" } } },
      ]),
      AnalyticsEvent.aggregate([
        { $match: match },
        { $group: { _id: "$name", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
        { $project: { _id: 0, name: "$_id", count: 1 } },
      ]),
      AnalyticsEvent.countDocuments(match24).catch(() => 0),
      AnalyticsEvent.countDocuments(match7).catch(() => 0),
      AnalyticsEvent.countDocuments({
        ...(dateMatch ? dateMatch : {}),
        name: "user_signed_up",
      }).catch(() => 0),
    ]);

    const data = {
      from: from ? from.toISOString() : null,
      to: to ? to.toISOString() : null,
      swapped: norm.swapped || false,
      events: totals?.[0]?.events || 0,
      uniqueUsers: totals?.[0]?.uniqueUsers || 0,
      topEvents: topNames || [],
      last24hEvents: last24h || 0,
      last7dEvents: last7d || 0,
      signups: signups || 0,
    };

    return res.json({ ok: true, data });
  } catch (e) {
    console.error("[adminAnalytics] /summary error:", e);
    return res.status(500).json({ ok: false, error: "SUMMARY_ERROR" });
  }
});

/* =========================
 * GET /api/admin/analytics/events
 * ========================= */
router.get("/events", requireInternalAdmin, async (req, res) => {
  try {
    const name = String(req.query.name || "").trim();
    const qtext = String(req.query.q || "").trim();
    const userId = String(req.query.userId || "").trim();

    let from = parseDateMaybe(req.query.from);
    let to = parseDateMaybe(req.query.to);
    const norm = normalizeRange(from, to);
    from = norm.from;
    to = norm.to;

    const limit = clampInt(req.query.limit, 1, 200, 50);
    const cursor = String(req.query.cursor || "").trim();

    const q = {};
    if (name) q.name = name;

    const uid = toObjectIdMaybe(userId);
    if (uid) q.userId = uid;

    const dateMatch = buildDateMatch(from, to);
    if (dateMatch) Object.assign(q, dateMatch);

    // paginación por _id (desc)
    if (cursor) {
      const cid = toObjectIdMaybe(cursor);
      if (cid) q._id = { $lt: cid };
    }

    // Búsqueda simple
    if (qtext) {
      const safe = qtext.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      q.$or = [
        { name: new RegExp(safe, "i") },
        { dedupeKey: new RegExp(safe, "i") },
      ];
    }

    const docs = await AnalyticsEvent.find(q)
      .sort({ _id: -1 })
      .limit(limit)
      .select("name userId ts createdAt props dedupeKey")
      .lean();

    const nextCursor = docs.length ? String(docs[docs.length - 1]._id) : null;

    return res.json({
      ok: true,
      data: {
        items: docs.map((d) => ({
          id: String(d._id),
          name: d.name,
          userId: d.userId ? String(d.userId) : null,
          createdAt: resolveEffectiveDate(d),
          props: d.props || {},
          dedupeKey: d.dedupeKey || null,
        })),
        nextCursor,
        count: docs.length,
        swapped: norm.swapped || false,
      },
    });
  } catch (e) {
    console.error("[adminAnalytics] /events error:", e);
    return res.status(500).json({ ok: false, error: "EVENTS_ERROR" });
  }
});

/* =========================
 * ✅ GET /api/admin/analytics/users?from=&to=&limit=&cursor=&q=
 * Tabla tipo CRM: métricas por usuario (NO eventos)
 * ========================= */
router.get("/users", requireInternalAdmin, async (req, res) => {
  try {
    if (!User) {
      return res.status(500).json({ ok: false, error: "USER_MODEL_NOT_AVAILABLE" });
    }

    const qtext = String(req.query.q || "").trim();
    const limit = clampInt(req.query.limit, 1, 200, 50);
    const cursor = String(req.query.cursor || "").trim();

    let from = parseDateMaybe(req.query.from);
    let to = parseDateMaybe(req.query.to);
    const norm = normalizeRange(from, to);
    from = norm.from;
    to = norm.to;

    const q = {};

    // paginación por _id (desc)
    if (cursor) {
      const cid = toObjectIdMaybe(cursor);
      if (cid) q._id = { $lt: cid };
    }

    // Búsqueda simple (email/name/_id)
    if (qtext) {
      const safe = qtext.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const or = [
        { email: new RegExp(safe, "i") },
        { name: new RegExp(safe, "i") },
        { fullName: new RegExp(safe, "i") },
        { displayName: new RegExp(safe, "i") },
      ];

      const oid = toObjectIdMaybe(qtext);
      if (oid) or.push({ _id: oid });

      q.$or = or;
    }

    // Filtro por rango de registro (best-effort con createdAt si existe)
    if (from || to) {
      const range = {};
      if (from) range.$gte = from;
      if (to) range.$lte = to;
      q.createdAt = range;
    }

    const users = await User.find(q)
      .sort({ _id: -1 })
      .limit(limit)
      .select(
        "_id name fullName displayName email emails createdAt updatedAt " +
          "lastLoginAt lastLogin last_sign_in_at last_login_at profile " +
          "selectedMetaAccounts selectedGoogleAccounts selectedGAProperties preferences"
      )
      .lean();

    const nextCursor = users.length ? String(users[users.length - 1]._id) : null;
    const userIds = users.map((u) => u._id);

    // Batch load related docs (best-effort)
    const googleByUser = new Map();
    if (GoogleAccount && userIds.length) {
      const googleDocs = await GoogleAccount.find({
        $or: [
          { userId: { $in: userIds } },
          { owner: { $in: userIds } },
          { user: { $in: userIds } },
        ],
      })
        .select(
          "_id userId owner user email " +
            "selectedCustomerIds defaultCustomerId " +
            "ad_accounts customers " +
            "gaProperties defaultPropertyId selectedPropertyIds selectedGaPropertyId " +
            // caches opcionales (si existen)
            "overview summary kpis ga4 gaOverview ga4Overview last30d last30Days"
        )
        .lean()
        .catch(() => []);

      for (const gd of googleDocs) {
        const uid = gd?.userId || gd?.owner || gd?.user || null;
        if (!uid) continue;
        googleByUser.set(String(uid), gd);
      }
    }

    const metaByUser = new Map();
    if (MetaAccount && userIds.length) {
      const metaDocs = await MetaAccount.find({
        $or: [
          { userId: { $in: userIds } },
          { owner: { $in: userIds } },
          { user: { $in: userIds } },
        ],
      })
        .select(
          "_id userId owner user email name " +
            "selectedAccountIds defaultAccountId " +
            "ad_accounts adAccounts " +
            // caches opcionales (si existen)
            "overview summary kpis last30d last30Days"
        )
        .lean()
        .catch(() => []);

      for (const md of metaDocs) {
        const uid = md?.userId || md?.owner || md?.user || null;
        if (!uid) continue;
        metaByUser.set(String(uid), md);
      }
    }

    /**
     * ✅ Última actividad por usuario (fallback real para lastLoginAt)
     * Tomamos MAX(ts||createdAt) de AnalyticsEvent.
     */
    const lastActivityByUser = new Map();
    if (userIds.length) {
      const rows = await AnalyticsEvent.aggregate([
        { $match: { userId: { $in: userIds } } },
        {
          $group: {
            _id: "$userId",
            lastAt: { $max: { $ifNull: ["$ts", "$createdAt"] } },
          },
        },
      ]).catch(() => []);

      for (const r of rows) {
        if (!r?._id) continue;
        lastActivityByUser.set(String(r._id), r.lastAt || null);
      }
    }

    const items = users.map((u) => {
      const uid = String(u._id);
      const gd = googleByUser.get(uid) || null;
      const md = metaByUser.get(uid) || null;

      const registeredAt = resolveUserRegisteredAt(u);

      // last login: user field OR last activity fallback
      const lastLoginPrimary = resolveUserLastLoginAt(u);
      const lastActivity = lastActivityByUser.get(uid) || null;
      const lastLoginAt = lastLoginPrimary || lastActivity || null;

      // selections canonical
      const metaSel = resolveMetaSelected(md, u);
      const gadsSel = resolveGoogleAdsSelected(gd, u);
      const ga4Sel = resolveGA4Selected(gd, u);

      // metrics (best-effort sin APIs)
      const metaSpend30d =
        resolveMetaSpend30dFromDoc(md);

      const googleSpend30d =
        resolveGoogleSpend30dFromDoc(gd);

      const gaSessions30d =
        resolveGaSessions30dFromDoc(gd);

      return {
        userId: uid,
        name: resolveUserName(u),
        email: resolveUserEmail(u),

        // ✅ campos canónicos que el hook ya entiende
        createdAt: toISO(registeredAt),
        lastLoginAt: toISO(lastLoginAt),

        metaAccountId: metaSel.id,
        metaAccountName: metaSel.name,
        metaSpend30d: metaSpend30d,

        googleAdsCustomerId: gadsSel.id,
        googleAdsAccountName: gadsSel.name,
        googleSpend30d: googleSpend30d,

        ga4PropertyId: ga4Sel.id,
        ga4PropertyName: ga4Sel.name,
        ga4Sessions30d: gaSessions30d,

        // ✅ compat legacy (por si algún front viejo usa estas llaves)
        registeredAt: toISO(registeredAt),
        metaAccountSelected: metaSel.display,
        googleAdsAccount: gadsSel.display,
        ga4Account: ga4Sel.display,
        gaSessions30d: gaSessions30d,

        // debug opcional
        raw: {
          user: {
            _id: uid,
            email: resolveUserEmail(u),
            name: resolveUserName(u),
          },
          meta: md ? { _id: String(md._id) } : null,
          google: gd ? { _id: String(gd._id) } : null,
          lastActivityAt: toISO(lastActivity),
        },
      };
    });

    return res.json({
      ok: true,
      data: {
        items,
        nextCursor,
        count: items.length,
        swapped: norm.swapped || false,
      },
    });
  } catch (e) {
    console.error("[adminAnalytics] /users error:", e);
    return res.status(500).json({ ok: false, error: "USERS_ERROR" });
  }
});

/* =========================
 * GET /api/admin/analytics/series
 * ========================= */
router.get("/series", requireInternalAdmin, async (req, res) => {
  try {
    const name = String(req.query.name || "").trim();
    const groupBy = String(req.query.groupBy || "day").trim().toLowerCase();

    let from = parseDateMaybe(req.query.from);
    let to = parseDateMaybe(req.query.to);
    const norm = normalizeRange(from, to);
    from = norm.from;
    to = norm.to;

    if (!name) return res.status(400).json({ ok: false, error: "NAME_REQUIRED" });
    if (!["day", "week", "month"].includes(groupBy)) {
      return res.status(400).json({ ok: false, error: "INVALID_GROUPBY" });
    }

    const dateMatch = buildDateMatch(from, to);
    const match = { name };
    if (dateMatch) Object.assign(match, dateMatch);

    const effectiveDateExpr = { $ifNull: ["$ts", "$createdAt"] };

    let groupId = null;
    if (groupBy === "day") {
      groupId = { $dateToString: { format: "%Y-%m-%d", date: effectiveDateExpr } };
    } else if (groupBy === "month") {
      groupId = { $dateToString: { format: "%Y-%m", date: effectiveDateExpr } };
    } else {
      groupId = {
        $concat: [
          { $toString: { $isoWeekYear: effectiveDateExpr } },
          "-W",
          {
            $cond: [
              { $lt: [{ $isoWeek: effectiveDateExpr }, 10] },
              { $concat: ["0", { $toString: { $isoWeek: effectiveDateExpr } }] },
              { $toString: { $isoWeek: effectiveDateExpr } },
            ],
          },
        ],
      };
    }

    const rows = await AnalyticsEvent.aggregate([
      { $match: match },
      { $match: { $expr: { $ne: [effectiveDateExpr, null] } } },
      {
        $group: {
          _id: groupId,
          count: { $sum: 1 },
          users: { $addToSet: "$userId" },
        },
      },
      { $sort: { _id: 1 } },
      {
        $project: {
          _id: 0,
          bucket: "$_id",
          count: 1,
          uniqueUsers: { $size: "$users" },
        },
      },
    ]);

    return res.json({
      ok: true,
      data: {
        name,
        groupBy,
        from: from ? from.toISOString() : null,
        to: to ? to.toISOString() : null,
        swapped: norm.swapped || false,
        points: rows,
      },
    });
  } catch (e) {
    console.error("[adminAnalytics] /series error:", e);
    return res.status(500).json({ ok: false, error: "SERIES_ERROR" });
  }
});

/* =========================
 * GET /api/admin/analytics/funnel
 * ========================= */
router.get("/funnel", requireInternalAdmin, async (req, res) => {
  try {
    let from = parseDateMaybe(req.query.from);
    let to = parseDateMaybe(req.query.to);
    const norm = normalizeRange(from, to);
    from = norm.from;
    to = norm.to;

    const stepsRaw = String(req.query.steps || "").trim();
    const steps = stepsRaw
      ? stepsRaw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [
          "signed_up",
          "google_connected",
          "meta_connected",
          "audit_requested",
          "audit_completed",
          "pixel_audit_completed",
        ];

    const dateMatch = buildDateMatch(from, to);
    const match = { name: { $in: steps } };
    if (dateMatch) Object.assign(match, dateMatch);

    const effectiveDateExpr = { $ifNull: ["$ts", "$createdAt"] };

    const firsts = await AnalyticsEvent.aggregate([
      { $match: match },
      { $match: { $expr: { $ne: [effectiveDateExpr, null] } } },
      {
        $group: {
          _id: { userId: "$userId", name: "$name" },
          firstAt: { $min: effectiveDateExpr },
        },
      },
      {
        $group: {
          _id: "$_id.userId",
          names: { $addToSet: "$_id.name" },
        },
      },
    ]);

    const counts = Object.fromEntries(steps.map((s) => [s, 0]));
    for (const u of firsts) {
      const names = Array.isArray(u.names) ? u.names : [];
      for (const s of steps) if (names.includes(s)) counts[s] += 1;
    }

    const funnel = steps.map((s, idx) => ({
      step: s,
      index: idx,
      users: counts[s] || 0,
    }));

    for (let i = 1; i < funnel.length; i++) {
      const prev = funnel[i - 1].users || 0;
      const curr = funnel[i].users || 0;
      funnel[i].dropFromPrev = Math.max(0, prev - curr);
      funnel[i].conversionFromPrev = prev > 0 ? Number((curr / prev).toFixed(4)) : null;
    }

    if (funnel.length) {
      funnel[0].dropFromPrev = null;
      funnel[0].conversionFromPrev = null;
    }

    return res.json({
      ok: true,
      data: {
        from: from ? from.toISOString() : null,
        to: to ? to.toISOString() : null,
        swapped: norm.swapped || false,
        steps,
        totalUsersInWindow: firsts.length,
        funnel,
      },
    });
  } catch (e) {
    console.error("[adminAnalytics] /funnel error:", e);
    return res.status(500).json({ ok: false, error: "FUNNEL_ERROR" });
  }
});

module.exports = router;
