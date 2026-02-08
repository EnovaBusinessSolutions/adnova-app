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
    model("AnalyticsEvent", new Schema({}, { strict: false, collection: "analyticsevents" }));
}

let User = null;
try {
  User = require("../models/User");
} catch {
  User = null;
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
 * ✅ Middleware de acceso interno (Opción B)
 *
 * Permite si:
 * - token interno via header x-internal-admin-token (o query ?token=)
 * - (fallback) usuario autenticado + role interno: admin|internal|staff
 * - (fallback) usuario autenticado + email en allowlist ENV
 *
 * ENV:
 * - INTERNAL_ADMIN_TOKEN="un_token_largo"
 * - INTERNAL_ADMIN_EMAILS="a@adray.ai,b@adray.ai"
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
 * =========================
 * effectiveDate = ts || createdAt || objectIdToDate(_id)
 * - Para queries/aggregations: usamos "ts" como prioridad y fallback a createdAt
 * - Para response de items: si no viene, calculamos por _id
 */
function buildDateMatch(from, to) {
  // IMPORTANT:
  // - Preferimos ts. Si no existe ts, algunos docs podrían tener createdAt.
  // - Mongo no puede usar un "fallback" directo con match simple,
  //   así que hacemos $or: [ {ts:range}, {ts:{$exists:false}, createdAt:range} ]
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
  } catch (e) {
    return res.status(500).json({ ok: false, error: "HEALTH_ERROR" });
  }
});

/* =========================
 * ✅ GET /api/admin/analytics/summary?from=&to=
 * KPIs rápidos para arrancar el panel “wow”
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
      AnalyticsEvent.countDocuments({ ...(dateMatch ? dateMatch : {}), name: "user_signed_up" }).catch(
        () => 0
      ),
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
 * GET /api/admin/analytics/events?name=&userId=&from=&to=&limit=&cursor=
 * + opcional q= (busca simple)
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
 * GET /api/admin/analytics/series?name=&from=&to=&groupBy=day|week|month
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

    // effectiveDate expr: ts || createdAt || _id-date (best-effort)
    // Nota: _id-date no es trivial en aggregation sin $function, así que
    // nos quedamos con ts||createdAt para series. Si falta, caerá fuera.
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
      // filtramos docs sin fecha usable para series
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
 * GET /api/admin/analytics/funnel?from=&to=&steps=
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
      ? stepsRaw.split(",").map((s) => s.trim()).filter(Boolean)
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

    const funnel = steps.map((s, idx) => ({ step: s, index: idx, users: counts[s] || 0 }));

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
