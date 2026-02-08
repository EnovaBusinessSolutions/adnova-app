// backend/routes/adminAnalytics.js
"use strict";

const express = require("express");
const mongoose = require("mongoose");

const router = express.Router();

// ====== Models (robustos) ======
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

// ====== Helpers ======
function parseDateMaybe(v) {
  if (!v) return null;
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? null : d;
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
  return String(
    req?.user?.email ||
      req?.user?.emails?.[0]?.value ||
      ""
  )
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

/**
 * ✅ Middleware de acceso interno (NO rompe nada productivo)
 *
 * Permite si:
 * - usuario autenticado + role interno: admin|internal|staff
 * - usuario autenticado + email en allowlist ENV
 * - token interno via header x-internal-admin-token (para paneles internos)
 *
 * ENV sugeridas:
 * - INTERNAL_ADMIN_EMAILS="a@adray.ai,b@adray.ai"
 * - INTERNAL_ADMIN_TOKEN="un_token_largo"
 */
function requireInternalAdmin(req, res, next) {
  try {
    const token = String(req.headers["x-internal-admin-token"] || "").trim();
    const tokenOk =
      token &&
      process.env.INTERNAL_ADMIN_TOKEN &&
      token === String(process.env.INTERNAL_ADMIN_TOKEN).trim();

    // Si viene token interno válido, dejamos pasar sin sesión (útil para panel interno server-to-server)
    if (tokenOk) return next();

    // Si no hay token, exigimos sesión
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
  } catch (e) {
    return res.status(403).json({ ok: false, error: "FORBIDDEN" });
  }
}

// ===========================================================
// GET /api/admin/analytics/events?name=&userId=&from=&to=&limit=&cursor=
// Lista paginada (log) ordenada por createdAt desc.
// cursor = _id del último item (para paginar)
// ===========================================================
router.get("/events", requireInternalAdmin, async (req, res) => {
  try {
    const name = String(req.query.name || "").trim();
    const userId = String(req.query.userId || "").trim();
    const from = parseDateMaybe(req.query.from);
    const to = parseDateMaybe(req.query.to);
    const limit = clampInt(req.query.limit, 1, 200, 50);
    const cursor = String(req.query.cursor || "").trim();

    const q = {};
    if (name) q.name = name;

    const uid = toObjectIdMaybe(userId);
    if (uid) q.userId = uid;

    if (from || to) {
      q.createdAt = {};
      if (from) q.createdAt.$gte = from;
      if (to) q.createdAt.$lte = to;
    }

    // paginación por _id (desc)
    if (cursor) {
      const cid = toObjectIdMaybe(cursor);
      if (cid) q._id = { $lt: cid };
    }

    const docs = await AnalyticsEvent.find(q)
      .sort({ _id: -1 }) // _id correlaciona con tiempo (y es más estable que createdAt)
      .limit(limit)
      .select("name userId createdAt props dedupeKey")
      .lean();

    const nextCursor = docs.length ? String(docs[docs.length - 1]._id) : null;

    return res.json({
      ok: true,
      items: docs.map((d) => ({
        id: String(d._id),
        name: d.name,
        userId: d.userId ? String(d.userId) : null,
        createdAt: d.createdAt || null,
        props: d.props || {},
        dedupeKey: d.dedupeKey || null,
      })),
      nextCursor,
      count: docs.length,
    });
  } catch (e) {
    console.error("[adminAnalytics] /events error:", e);
    return res.status(500).json({ ok: false, error: "EVENTS_ERROR" });
  }
});

// ===========================================================
// GET /api/admin/analytics/series?name=&from=&to=&groupBy=day|week|month
// Serie temporal para marketing (conteo de eventos por periodo)
// ===========================================================
router.get("/series", requireInternalAdmin, async (req, res) => {
  try {
    const name = String(req.query.name || "").trim();
    const groupBy = String(req.query.groupBy || "day").trim().toLowerCase();
    const from = parseDateMaybe(req.query.from);
    const to = parseDateMaybe(req.query.to);

    if (!name) {
      return res.status(400).json({ ok: false, error: "NAME_REQUIRED" });
    }
    if (!["day", "week", "month"].includes(groupBy)) {
      return res.status(400).json({ ok: false, error: "INVALID_GROUPBY" });
    }

    const match = { name };
    if (from || to) {
      match.createdAt = {};
      if (from) match.createdAt.$gte = from;
      if (to) match.createdAt.$lte = to;
    }

    // Usamos formatos compatibles (sin depender de $dateTrunc)
    let groupId = null;

    if (groupBy === "day") {
      groupId = {
        $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
      };
    } else if (groupBy === "month") {
      groupId = {
        $dateToString: { format: "%Y-%m", date: "$createdAt" },
      };
    } else {
      // week (ISO): YYYY-Www
      groupId = {
        $concat: [
          { $toString: { $isoWeekYear: "$createdAt" } },
          "-W",
          {
            $cond: [
              { $lt: [{ $isoWeek: "$createdAt" }, 10] },
              { $concat: ["0", { $toString: { $isoWeek: "$createdAt" } }] },
              { $toString: { $isoWeek: "$createdAt" } },
            ],
          },
        ],
      };
    }

    const rows = await AnalyticsEvent.aggregate([
      { $match: match },
      {
        $group: {
          _id: groupId,
          count: { $sum: 1 },
          // usuarios únicos opcional (útil)
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
      name,
      groupBy,
      from: from ? from.toISOString() : null,
      to: to ? to.toISOString() : null,
      points: rows,
    });
  } catch (e) {
    console.error("[adminAnalytics] /series error:", e);
    return res.status(500).json({ ok: false, error: "SERIES_ERROR" });
  }
});

// ===========================================================
// GET /api/admin/analytics/funnel?from=&to=&steps=
// steps: CSV opcional, default:
// signed_up,google_connected,meta_connected,audit_requested,audit_completed,pixel_audit_completed
//
// Devuelve conteos por paso (usuarios únicos que alcanzaron ese paso)
// ===========================================================
router.get("/funnel", requireInternalAdmin, async (req, res) => {
  try {
    const from = parseDateMaybe(req.query.from);
    const to = parseDateMaybe(req.query.to);

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

    // match por rango + nombres
    const match = { name: { $in: steps } };
    if (from || to) {
      match.createdAt = {};
      if (from) match.createdAt.$gte = from;
      if (to) match.createdAt.$lte = to;
    }

    // 1) evento más temprano por (userId, name)
    const firsts = await AnalyticsEvent.aggregate([
      { $match: match },
      {
        $group: {
          _id: { userId: "$userId", name: "$name" },
          firstAt: { $min: "$createdAt" },
        },
      },
      {
        $group: {
          _id: "$_id.userId",
          names: { $addToSet: "$_id.name" },
        },
      },
    ]);

    // 2) conteos por step (usuarios únicos que lo tienen)
    const counts = Object.fromEntries(steps.map((s) => [s, 0]));
    for (const u of firsts) {
      const names = Array.isArray(u.names) ? u.names : [];
      for (const s of steps) {
        if (names.includes(s)) counts[s] += 1;
      }
    }

    // 3) armamos funnel “ordenado”
    const funnel = steps.map((s, idx) => ({
      step: s,
      index: idx,
      users: counts[s] || 0,
    }));

    // 4) drop-off aproximado (entre pasos consecutivos)
    for (let i = 1; i < funnel.length; i++) {
      const prev = funnel[i - 1].users || 0;
      const curr = funnel[i].users || 0;
      funnel[i].dropFromPrev = Math.max(0, prev - curr);
      funnel[i].conversionFromPrev = prev > 0 ? Number((curr / prev).toFixed(4)) : null;
    }

    // signed_up baseline
    if (funnel.length) {
      funnel[0].dropFromPrev = null;
      funnel[0].conversionFromPrev = null;
    }

    return res.json({
      ok: true,
      from: from ? from.toISOString() : null,
      to: to ? to.toISOString() : null,
      steps,
      totalUsersInWindow: firsts.length,
      funnel,
    });
  } catch (e) {
    console.error("[adminAnalytics] /funnel error:", e);
    return res.status(500).json({ ok: false, error: "FUNNEL_ERROR" });
  }
});

module.exports = router;
