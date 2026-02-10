"use strict";

const express = require("express");
const mongoose = require("mongoose");
const crypto = require("crypto");

// ✅ Para refrescar tokens Google (GA4 + Ads)
const { OAuth2Client } = require("google-auth-library");

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
 * ✅ Google Ads service (MISMO motor que el panel)
 * ========================= */
let Ads = null;
try {
  Ads = require("../services/googleAdsService");
} catch {
  Ads = null;
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

function ymd(d) {
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return null;
  const yyyy = String(dt.getFullYear());
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/* =========================
 * ✅ Google token helpers (GA4 + Google Ads)
 * ========================= */
function oauthClient() {
  return new OAuth2Client({
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri:
      process.env.GOOGLE_REDIRECT_URI || process.env.GOOGLE_CONNECT_CALLBACK_URL,
  });
}

// Devuelve access token fresco usando refresh token (sin romper si falla).
async function getFreshGoogleAccessToken(googleDoc) {
  const refreshToken = googleDoc?.refreshToken || googleDoc?.refresh_token || null;
  const accessToken = googleDoc?.accessToken || googleDoc?.access_token || null;

  if (!refreshToken) return accessToken || null;

  try {
    const client = oauthClient();
    client.setCredentials({
      refresh_token: refreshToken,
      access_token: accessToken || undefined,
    });

    // Intenta obtener token fresco
    const t = await client.getAccessToken().catch(() => null);
    const token = t?.token || null;

    // Best-effort: persistimos accessToken si el modelo está disponible
    if (token && GoogleAccount && googleDoc?._id) {
      GoogleAccount.updateOne(
        { _id: googleDoc._id },
        { $set: { accessToken: token, updatedAt: new Date() } }
      ).catch(() => {});
    }

    return token || accessToken || null;
  } catch {
    return accessToken || null;
  }
}

/* =========================
 * ✅ Fetch helpers (Meta / GA4 / Google Ads)
 * ========================= */
async function safeFetchJson(url, init) {
  const r = await fetch(url, init);
  const text = await r.text().catch(() => "");
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!r.ok) {
    const err = new Error(`HTTP_${r.status}`);
    err.status = r.status;
    err.payload = json;
    throw err;
  }
  return json;
}

async function fetchMetaSpend30d({ accessToken, actId }) {
  if (!accessToken || !actId) return null;

  const now = new Date();
  const until = ymd(now);
  const since = ymd(new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000));
  if (!since || !until) return null;

  const base = "https://graph.facebook.com/v20.0";
  const time_range = encodeURIComponent(JSON.stringify({ since, until }));
  const url =
    `${base}/act_${encodeURIComponent(actId)}/insights` +
    `?fields=spend&level=account&time_range=${time_range}&limit=1&access_token=${encodeURIComponent(
      accessToken
    )}`;

  const json = await safeFetchJson(url, { method: "GET" });
  const spendStr = json?.data?.[0]?.spend ?? null;
  const spend = Number(spendStr);
  return Number.isFinite(spend) ? spend : null;
}

function toPropertyResource(val) {
  const raw = String(val || "").trim();
  if (!raw) return "";
  if (/^properties\/\d+$/.test(raw)) return raw;
  const digits = raw.replace(/^properties\//, "").replace(/[^\d]/g, "");
  return digits ? `properties/${digits}` : "";
}

async function fetchGa4Sessions30d({ accessToken, propertyId }) {
  if (!accessToken || !propertyId) return null;

  const prop = toPropertyResource(propertyId);
  const pid = String(prop).trim().replace(/^properties\//, "");
  if (!pid) return null;

  const now = new Date();
  const endDate = ymd(now);
  const startDate = ymd(new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000));
  if (!startDate || !endDate) return null;

  const url = `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(
    pid
  )}:runReport`;

  const body = {
    dateRanges: [{ startDate, endDate }],
    metrics: [{ name: "sessions" }],
  };

  const json = await safeFetchJson(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const v = json?.rows?.[0]?.metricValues?.[0]?.value ?? null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/* =========================
 * ✅ Legacy (direct) Google Ads spend helper (lo dejamos como fallback)
 * ========================= */
function resolveGoogleDeveloperToken() {
  return (
    String(process.env.GOOGLE_DEVELOPER_TOKEN || "").trim() ||
    String(process.env.GOOGLE_ADS_DEVELOPER_TOKEN || "").trim() ||
    ""
  );
}

async function fetchGoogleAdsSpend30d({
  accessToken,
  customerId,
  developerToken,
  loginCustomerId,
}) {
  if (!accessToken || !customerId || !developerToken) return null;

  const cid = String(customerId).trim();
  if (!cid) return null;

  const url = `https://googleads.googleapis.com/v16/customers/${encodeURIComponent(
    cid
  )}/googleAds:search`;

  const query =
    "SELECT segments.date, metrics.cost_micros " +
    "FROM customer " +
    "WHERE segments.date DURING LAST_30_DAYS";

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "developer-token": developerToken,
  };
  if (loginCustomerId) headers["login-customer-id"] = String(loginCustomerId);

  const json = await safeFetchJson(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ query, page_size: 10000 }),
  });

  const results = Array.isArray(json?.results) ? json.results : [];
  let sumMicros = 0;
  for (const row of results) {
    const micros = Number(
      row?.metrics?.costMicros ?? row?.metrics?.cost_micros ?? 0
    );
    if (Number.isFinite(micros)) sumMicros += micros;
  }

  const spend = sumMicros / 1_000_000;
  return Number.isFinite(spend) ? spend : null;
}

/* =========================
 * ✅ NEW: Google Ads spend 30D usando el MISMO motor del panel (Ads.fetchInsights)
 * ========================= */
async function fetchGoogleAdsSpend30dViaInsights({ accessToken, customerId }) {
  if (!Ads) return null; // si por alguna razón no existe el service
  if (!accessToken || !customerId) return null;

  const cid = String(customerId || "").replace(/[^\d]/g, "").trim();
  if (!cid) return null;

  const payload = await Ads.fetchInsights({
    accessToken,
    customerId: cid,
    datePreset: "last_30d",
    includeToday: false,
    objective: "ventas",
    range: null,
    compareMode: null,
  });

  const cost = payload?.kpis?.cost;
  return typeof cost === "number" && Number.isFinite(cost) ? cost : null;
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

    if (cursor) {
      const cid = toObjectIdMaybe(cursor);
      if (cid) q._id = { $lt: cid };
    }

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
 * Tabla tipo CRM
 * ========================= */

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

function pickMetaSelected(metaDoc) {
  if (!metaDoc) return { id: null, name: null, token: null };

  const id =
    pickFirstTruthy(metaDoc?.selectedAccountIds?.[0], metaDoc?.defaultAccountId) ||
    null;

  const list = Array.isArray(metaDoc?.ad_accounts)
    ? metaDoc.ad_accounts
    : Array.isArray(metaDoc?.adAccounts)
    ? metaDoc.adAccounts
    : [];

  const hit = id
    ? list.find((a) => String(a?.id || "").trim() === String(id).trim())
    : null;

  const name = pickFirstTruthy(hit?.name, hit?.account_name) || null;

  const token =
    metaDoc?.longLivedToken ||
    metaDoc?.longlivedToken ||
    metaDoc?.access_token ||
    metaDoc?.accessToken ||
    metaDoc?.token ||
    null;

  return { id, name, token };
}

function pickGoogleAdsSelected(googleDoc) {
  if (!googleDoc)
    return {
      id: null,
      name: null,
      accessToken: null,
      loginCustomerId: null,
      refreshToken: null,
    };

  const id =
    pickFirstTruthy(
      googleDoc?.selectedCustomerIds?.[0],
      googleDoc?.defaultCustomerId
    ) || null;

  const list = Array.isArray(googleDoc?.ad_accounts) ? googleDoc.ad_accounts : [];
  const hit = id
    ? list.find((a) => String(a?.id || "").trim() === String(id).trim())
    : null;

  const name = pickFirstTruthy(hit?.name) || null;

  const accessToken = googleDoc?.accessToken || null;
  const refreshToken = googleDoc?.refreshToken || googleDoc?.refresh_token || null;

  const loginCustomerId =
    pickFirstTruthy(googleDoc?.loginCustomerId, googleDoc?.managerCustomerId) ||
    null;

  return { id, name, accessToken, refreshToken, loginCustomerId };
}

function pickGA4Selected(googleDoc) {
  if (!googleDoc) return { id: null, name: null };

  const rawId =
    pickFirstTruthy(
      googleDoc?.selectedPropertyIds?.[0],
      googleDoc?.defaultPropertyId,
      googleDoc?.selectedGaPropertyId
    ) || null;

  const id = rawId ? toPropertyResource(rawId) : null;

  const props = Array.isArray(googleDoc?.gaProperties) ? googleDoc.gaProperties : [];
  const hit = id
    ? props.find((p) => String(p?.propertyId || "").trim() === String(id).trim())
    : null;

  const name = pickFirstTruthy(hit?.displayName) || null;

  return { id, name };
}

// ✅ Última actividad REAL (sin limitar por from/to del filtro)
async function getLastActivityMap(userIds) {
  const match = { userId: { $in: userIds } };
  const effectiveDateExpr = { $ifNull: ["$ts", "$createdAt"] };

  const rows = await AnalyticsEvent.aggregate([
    { $match: match },
    { $match: { $expr: { $ne: [effectiveDateExpr, null] } } },
    { $group: { _id: "$userId", lastAt: { $max: effectiveDateExpr } } },
  ]).catch(() => []);

  const map = new Map();
  for (const r of rows) {
    if (!r?._id) continue;
    map.set(String(r._id), r.lastAt ? new Date(r.lastAt) : null);
  }
  return map;
}

async function runWithLimit(list, limit, worker) {
  const out = new Array(list.length);
  let i = 0;

  const runners = new Array(Math.min(limit, list.length)).fill(0).map(async () => {
    while (i < list.length) {
      const idx = i++;
      try {
        out[idx] = await worker(list[idx], idx);
      } catch {
        out[idx] = null;
      }
    }
  });

  await Promise.all(runners);
  return out;
}

router.get("/users", requireInternalAdmin, async (req, res) => {
  try {
    if (!User) {
      return res
        .status(500)
        .json({ ok: false, error: "USER_MODEL_NOT_AVAILABLE" });
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
    if (cursor) {
      const cid = toObjectIdMaybe(cursor);
      if (cid) q._id = { $lt: cid };
    }

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

    if (from || to) {
      const range = {};
      if (from) range.$gte = from;
      if (to) range.$lte = to;
      q.createdAt = range;
    }

    const users = await User.find(q)
      .sort({ _id: -1 })
      .limit(limit)
      .select("_id name fullName displayName email emails createdAt updatedAt profile")
      .lean();

    const nextCursor = users.length ? String(users[users.length - 1]._id) : null;
    const userIds = users.map((u) => u._id);

    // related docs
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
          "_id userId owner user " +
            "selectedCustomerIds defaultCustomerId loginCustomerId managerCustomerId " +
            "ad_accounts " +
            "gaProperties defaultPropertyId selectedPropertyIds selectedGaPropertyId " +
            "+accessToken +refreshToken"
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
          "_id userId owner user " +
            "selectedAccountIds defaultAccountId ad_accounts adAccounts " +
            "+access_token +token +longlivedToken +accessToken +longLivedToken"
        )
        .lean()
        .catch(() => []);
      for (const md of metaDocs) {
        const uid = md?.userId || md?.owner || md?.user || null;
        if (!uid) continue;
        metaByUser.set(String(uid), md);
      }
    }

    // ✅ lastLoginAt best-effort via AnalyticsEvent (última actividad global)
    const lastActivityMap = await getLastActivityMap(userIds);

    // ✅ token correcto (por si usamos fallback legacy)
    const devToken = resolveGoogleDeveloperToken() || null;

    const computed = await runWithLimit(users, 5, async (u) => {
      const uid = String(u._id);
      const gd = googleByUser.get(uid) || null;
      const md = metaByUser.get(uid) || null;

      const metaSel = pickMetaSelected(md);
      const googleSel = pickGoogleAdsSelected(gd);
      const gaSel = pickGA4Selected(gd);

      // ✅ Access token fresco (sirve para Ads y GA4)
      const freshGoogleToken = await getFreshGoogleAccessToken(gd).catch(() => null);
      const tokenForGoogle = freshGoogleToken || googleSel.accessToken || null;

      // ✅ Google Ads Spend 30D: mismo motor del panel (Ads.fetchInsights)
      const googleSpendPromise = (async () => {
        // 1) Vía Insights (preferido)
        const viaInsights = await fetchGoogleAdsSpend30dViaInsights({
          accessToken: tokenForGoogle,
          customerId: googleSel.id,
        }).catch(() => null);

        if (viaInsights != null) return viaInsights;

        // 2) Fallback legacy (direct API) por si algo raro con el service
        const legacy = await fetchGoogleAdsSpend30d({
          accessToken: tokenForGoogle,
          customerId: googleSel.id,
          developerToken: devToken,
          loginCustomerId: googleSel.loginCustomerId,
        }).catch(() => null);

        return legacy;
      })();

      const [metaSpend30d, googleSpend30d, ga4Sessions30d] = await Promise.all([
        fetchMetaSpend30d({ accessToken: metaSel.token, actId: metaSel.id }).catch(
          () => null
        ),
        googleSpendPromise,
        fetchGa4Sessions30d({
          accessToken: tokenForGoogle,
          propertyId: gaSel.id,
        }).catch(() => null),
      ]);

      return {
        uid,
        metaSel,
        googleSel,
        gaSel,
        metaSpend30d,
        googleSpend30d,
        ga4Sessions30d,
      };
    });

    const computedByUser = new Map();
    for (const c of computed) {
      if (!c?.uid) continue;
      computedByUser.set(String(c.uid), c);
    }

    const items = users.map((u) => {
      const uid = String(u._id);
      const c = computedByUser.get(uid) || {};
      const registeredAt = resolveUserRegisteredAt(u);
      const lastLoginAt = lastActivityMap.get(uid) || null;

      return {
        userId: uid,
        name: resolveUserName(u),
        email: resolveUserEmail(u),

        createdAt: toISO(registeredAt),
        lastLoginAt: toISO(lastLoginAt),

        metaAccountId: c?.metaSel?.id || null,
        metaAccountName: c?.metaSel?.name || null,
        metaSpend30d: c?.metaSpend30d ?? null,

        googleAdsCustomerId: c?.googleSel?.id || null,
        googleAdsAccountName: c?.googleSel?.name || null,
        googleSpend30d: c?.googleSpend30d ?? null,

        ga4PropertyId: c?.gaSel?.id || null,
        ga4PropertyName: c?.gaSel?.name || null,
        ga4Sessions30d: c?.ga4Sessions30d ?? null,

        raw: {
          registeredAt: toISO(registeredAt),
          lastLoginAt: toISO(lastLoginAt),
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
