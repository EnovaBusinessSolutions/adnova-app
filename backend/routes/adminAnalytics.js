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

// ✅ Timezone canónico para analítica (para cortes y buckets)
const ANALYTICS_TZ = String(process.env.ANALYTICS_TZ || "America/Mexico_City");

// ✅ Detecta YYYY-MM-DD (sin hora)
function isYmdOnly(v) {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.trim());
}

// Convierte YYYY-MM-DD a Date UTC equivalente a inicio/fin de ese día en ANALYTICS_TZ
// Sin libs externas, usando Intl + offset calculado (DST safe).
function zonedDayBoundaryToUtc(ymdStr, kind /* "start" | "end" */) {
  if (!isYmdOnly(ymdStr)) return null;

  // Queremos "YYYY-MM-DD 00:00:00.000" o "23:59:59.999" en el TZ,
  // y convertirlo a UTC real.
  const [Y, M, D] = ymdStr.split("-").map((x) => Number(x));
  if (!Y || !M || !D) return null;

  const h = kind === "end" ? 23 : 0;
  const m = kind === "end" ? 59 : 0;
  const s = kind === "end" ? 59 : 0;
  const ms = kind === "end" ? 999 : 0;

  // Arrancamos con un guess en UTC (misma fecha/hora), y ajustamos por offset real del TZ
  let guess = new Date(Date.UTC(Y, M - 1, D, h, m, s, ms));
  if (isNaN(guess.getTime())) return null;

  // Calcula offset del TZ en ese instante: offset = (horaTZ - horaUTC)
  function tzOffsetMinutesAt(dateUtc) {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: ANALYTICS_TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });

    const parts = dtf.formatToParts(dateUtc);
    const get = (t) => Number(parts.find((p) => p.type === t)?.value || "0");

    const y = get("year");
    const mo = get("month");
    const da = get("day");
    const ho = get("hour");
    const mi = get("minute");
    const se = get("second");

    // “Lo que el TZ cree que es” en UTC, para comparar
    const asIfUtc = Date.UTC(y, mo - 1, da, ho, mi, se, 0);
    const realUtc = dateUtc.getTime();

    // Si asIfUtc > realUtc => TZ va adelante (offset positivo)
    return Math.round((asIfUtc - realUtc) / 60000);
  }

  // Ajuste iterativo (2 pasos suele bastar)
  for (let i = 0; i < 3; i++) {
    const offMin = tzOffsetMinutesAt(guess);
    const targetUtcMs = Date.UTC(Y, M - 1, D, h, m, s, ms) - offMin * 60000;
    const next = new Date(targetUtcMs);
    if (Math.abs(next.getTime() - guess.getTime()) < 1000) {
      guess = next;
      break;
    }
    guess = next;
  }

  return guess;
}

// ✅ from: si viene YYYY-MM-DD => inicio de día (en ANALYTICS_TZ) convertido a UTC
function parseDateMaybeStart(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (isYmdOnly(s)) return zonedDayBoundaryToUtc(s, "start");
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

// ✅ to: si viene YYYY-MM-DD => fin de día (en ANALYTICS_TZ) convertido a UTC (inclusivo)
function parseDateMaybeEnd(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (isYmdOnly(s)) return zonedDayBoundaryToUtc(s, "end");
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

// ✅ fecha exacta (NO fuerza inicio/fin) (compat)
function parseDateExact(v) {
  if (!v) return null;
  const s = String(v).trim();
  const d = new Date(s);
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
  return String(
    req?.user?.role || req?.user?.kind || req?.user?.accountType || ""
  )
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
  const yyyy = String(dt.getUTCFullYear());
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/* =========================
 * ✅ CIERRE DIARIO (cutoffDay)
 * =========================
 * El front manda cutoffDay=YYYY-MM-DD (día LOCAL de analítica).
 *
 * ✅ FIX CRÍTICO:
 * Antes se convertía con "...Z" (UTC) y eso cortaba el día a las 18:00 CDMX,
 * dejando FUERA eventos nocturnos (ej. 11:18pm local).
 *
 * Ahora:
 * - cutoffEnd = fin de cutoffDay en ANALYTICS_TZ, convertido a UTC real.
 *   (DST-safe, mismo motor que parseDateMaybeEnd)
 */
function parseCutoffDayToCutoffEnd(req) {
  const cutoffDay = String(req.query.cutoffDay || "").trim();
  if (!isYmdOnly(cutoffDay)) {
    return { cutoffDay: null, cutoffEnd: null, cutoffEffectiveDay: null };
  }

  // ✅ Fin del día en el TZ canónico (no UTC fijo)
  const cutoffEnd = zonedDayBoundaryToUtc(cutoffDay, "end");
  if (!cutoffEnd || isNaN(cutoffEnd.getTime())) {
    return { cutoffDay: null, cutoffEnd: null, cutoffEffectiveDay: null };
  }

  const cutoffEffectiveDay = cutoffDay;
  return { cutoffDay, cutoffEnd, cutoffEffectiveDay };
}

function applyCutoffToRange(req, range) {
  const { cutoffDay, cutoffEnd, cutoffEffectiveDay } = parseCutoffDayToCutoffEnd(req);
  if (!cutoffEnd) {
    return { ...range, cutoffDay: null, cutoffEnd: null, cutoffEffectiveDay: null };
  }

  let from = range.from || null;
  let to = range.to || null;

  // Si el usuario pide "to" posterior al corte, lo clamp.
  if (to && to.getTime() > cutoffEnd.getTime()) to = cutoffEnd;

  // Si no mandó "to", también lo fijamos al corte (congelado).
  if (!to) to = cutoffEnd;

  // Normalizar por si acaso
  const norm = normalizeRange(from, to);

  return {
    ...range,
    from: norm.from,
    to: norm.to,
    swapped: !!(range.swapped || norm.swapped),
    cutoffDay,
    cutoffEnd,
    cutoffEffectiveDay,
  };
}

/* =========================
 * ✅ Rango canónico (compat)
 * =========================
 * - Ya NO priorizamos "fromTs/toTs" (solo compat).
 * - El panel interno ahora usa from/to + cutoffDay.
 */
function getEffectiveRange(req) {
  // compat (no prioridad)
  let fromTs = parseDateExact(req.query.fromTs);
  let toTs = parseDateExact(req.query.toTs);
  const normTs = normalizeRange(fromTs, toTs);
  fromTs = normTs.from;
  toTs = normTs.to;

  // canonical (día)
  let from = parseDateMaybeStart(req.query.from);
  let to = parseDateMaybeEnd(req.query.to);
  const norm = normalizeRange(from, to);
  from = norm.from;
  to = norm.to;

  // elegimos from/to (día) como fuente principal
  const effectiveFrom = from || fromTs || null;
  const effectiveTo = to || toTs || null;

  const effectiveNorm = normalizeRange(effectiveFrom, effectiveTo);

  const base = {
    from: effectiveNorm.from,
    to: effectiveNorm.to,
    fromTs: fromTs ? fromTs.toISOString() : null,
    toTs: toTs ? toTs.toISOString() : null,
    swapped: !!(norm.swapped || normTs.swapped || effectiveNorm.swapped),
  };

  // ✅ aplicar cierre diario
  return applyCutoffToRange(req, base);
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
  const refreshToken =
    googleDoc?.refreshToken || googleDoc?.refresh_token || null;
  const accessToken = googleDoc?.accessToken || googleDoc?.access_token || null;

  if (!refreshToken) return accessToken || null;

  try {
    const client = oauthClient();
    client.setCredentials({
      refresh_token: refreshToken,
      access_token: accessToken || undefined,
    });

    const t = await client.getAccessToken().catch(() => null);
    const token = t?.token || null;

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
 * ✅ Legacy (direct) Google Ads spend helper (fallback)
 * ========================= */
function resolveGoogleDeveloperToken() {
  return (
    String(process.env.GOOGLE_DEVELOPER_TOKEN || "").trim() ||
    String(process.env.GOOGLE_ADS_DEVELOPER_TOKEN || "").trim() ||
    ""
  );
}

function resolveLoginCustomerId(googleDoc) {
  return (
    String(process.env.GOOGLE_LOGIN_CUSTOMER_ID || "").trim() ||
    String(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || "").trim() ||
    String(googleDoc?.loginCustomerId || "").trim() ||
    String(googleDoc?.managerCustomerId || "").trim() ||
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

  const cid = String(customerId).replace(/[^\d]/g, "").trim();
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
  if (!Ads) return null;
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
 * ✅ Login aliases (evitar ceros)
 * ========================= */
const LOGIN_EVENT_ALIASES = ["user_logged_in", "user_login", "login"];

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
 * ✅ GET /api/admin/analytics/summary?from=&to=&cutoffDay=
 * ========================= */
router.get("/summary", requireInternalAdmin, async (req, res) => {
  try {
    const range = getEffectiveRange(req);

    const dateMatch = buildDateMatch(range.from, range.to);
    const match = dateMatch ? { ...dateMatch } : {};

    // ✅ Para "últimas 24h / últimos 7d" usamos el "cierre" si existe, no el now real.
    const baseNow = range?.cutoffEnd
      ? new Date(range.cutoffEnd.getTime())
      : new Date();

    const d24From = new Date(baseNow.getTime() - 24 * 60 * 60 * 1000);
    const d7From = new Date(baseNow.getTime() - 7 * 24 * 60 * 60 * 1000);

    const match24 = buildDateMatch(d24From, baseNow) || {};
    const match7 = buildDateMatch(d7From, baseNow) || {};

    const [totals, topNames, last24h, last7d, signups, loginsAgg] =
      await Promise.all([
        // ✅ Totales: si el doc trae "count" (STATE) suma count, si no existe suma 1 (RAW)
        AnalyticsEvent.aggregate([
          { $match: match },
          {
            $group: {
              _id: null,
              events: { $sum: { $ifNull: ["$count", 1] } },
              users: { $addToSet: "$userId" },
            },
          },
          {
            $project: { _id: 0, events: 1, uniqueUsers: { $size: "$users" } },
          },
        ]),

        // ✅ Top events: suma count si existe, si no = 1
        AnalyticsEvent.aggregate([
          { $match: match },
          {
            $group: {
              _id: "$name",
              count: { $sum: { $ifNull: ["$count", 1] } },
            },
          },
          { $sort: { count: -1 } },
          { $limit: 10 },
          { $project: { _id: 0, name: "$_id", count: 1 } },
        ]),

        // ✅ Conteos estables (con cierre si aplica)
        AnalyticsEvent.countDocuments(match24).catch(() => 0),
        AnalyticsEvent.countDocuments(match7).catch(() => 0),

        AnalyticsEvent.countDocuments({
          ...(dateMatch ? dateMatch : {}),
          name: "user_signed_up",
        }).catch(() => 0),

        // ✅ Logins reales + usuarios únicos que loguearon en el rango
        // - Si el evento es "RAW", no trae count => suma 1
        // - Si el evento es "STATE" (dedupe), trae count => suma count
        AnalyticsEvent.aggregate([
          {
            $match: {
              ...(match || {}),
              name: { $in: LOGIN_EVENT_ALIASES },
            },
          },
          {
            $group: {
              _id: null,
              logins: { $sum: { $ifNull: ["$count", 1] } }, // ✅ FIX
              users: { $addToSet: "$userId" },
            },
          },
          {
            $project: {
              _id: 0,
              logins: 1,
              loginsUniqueUsers: { $size: "$users" },
            },
          },
        ]).catch(() => []),
      ]);

    const data = {
      from: range.from ? range.from.toISOString() : null,
      to: range.to ? range.to.toISOString() : null,

      // compat
      fromTs: range.fromTs,
      toTs: range.toTs,
      swapped: range.swapped || false,

      // ✅ cierre diario
      cutoffDay: range.cutoffDay || null,
      cutoffEnd: range.cutoffEnd ? range.cutoffEnd.toISOString() : null,
      cutoffEffectiveDay: range.cutoffEffectiveDay || null,

      events: totals?.[0]?.events || 0,
      uniqueUsers: totals?.[0]?.uniqueUsers || 0,
      topEvents: topNames || [],

      last24hEvents: last24h || 0,
      last7dEvents: last7d || 0,
      signups: signups || 0,

      // ✅ métricas de login (nombres que el front ya soporta)
      logins: loginsAgg?.[0]?.logins || 0,
      loginsUniqueUsers: loginsAgg?.[0]?.loginsUniqueUsers || 0,
    };

    return res.json({ ok: true, data });
  } catch (e) {
    console.error("[adminAnalytics] /summary error:", e);
    return res.status(500).json({ ok: false, error: "SUMMARY_ERROR" });
  }
});

/* =========================
 * GET /api/admin/analytics/events?name=&userId=&from=&to=&limit=&cursor=&q=&cutoffDay=
 * ========================= */
router.get("/events", requireInternalAdmin, async (req, res) => {
  try {
    const name = String(req.query.name || "").trim();
    const qtext = String(req.query.q || "").trim();
    const userId = String(req.query.userId || "").trim();

    const range = getEffectiveRange(req);

    const limit = clampInt(req.query.limit, 1, 200, 50);
    const cursor = String(req.query.cursor || "").trim();

    const q = {};
    if (name) q.name = name;

    const uid = toObjectIdMaybe(userId);
    if (uid) q.userId = uid;

    const dateMatch = buildDateMatch(range.from, range.to);
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
      .select("name userId ts createdAt updatedAt props dedupeKey count")
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
          updatedAt: d.updatedAt || null,
          count: typeof d.count === "number" ? d.count : null,
          props: d.props || {},
          dedupeKey: d.dedupeKey || null,
        })),
        nextCursor,
        count: docs.length,
        swapped: range.swapped || false,
        from: range.from ? range.from.toISOString() : null,
        to: range.to ? range.to.toISOString() : null,

        // ✅ cierre diario
        cutoffDay: range.cutoffDay || null,
        cutoffEnd: range.cutoffEnd ? range.cutoffEnd.toISOString() : null,
        cutoffEffectiveDay: range.cutoffEffectiveDay || null,
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
 * (Esta tabla NO usa cutoffDay porque filtra usuarios por createdAt del usuario,
 *  no por eventos. Aun así, si quieres, podemos aplicarlo después.)
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

// ✅ Último LOGIN REAL por usuario (solo eventos login)
async function getLastLoginMap(userIds) {
  const match = {
    userId: { $in: userIds },
    name: { $in: LOGIN_EVENT_ALIASES },
  };
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

  const runners = new Array(Math.min(limit, list.length))
    .fill(0)
    .map(async () => {
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

    // ✅ Mantener legacy from/to para filtro de usuarios (createdAt)
    let from = parseDateMaybeStart(req.query.from);
    let to = parseDateMaybeEnd(req.query.to);
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

    // ✅ lastLoginAt best-effort via AnalyticsEvent
    const lastLoginMap = await getLastLoginMap(userIds);

    // ✅ token correcto (Render: GOOGLE_DEVELOPER_TOKEN)
    const devToken = resolveGoogleDeveloperToken() || null;

    const computed = await runWithLimit(users, 5, async (u) => {
      const uid = String(u._id);
      const gd = googleByUser.get(uid) || null;
      const md = metaByUser.get(uid) || null;

      const metaSel = pickMetaSelected(md);
      const googleSel = pickGoogleAdsSelected(gd);
      const gaSel = pickGA4Selected(gd);

      const freshGoogleToken = await getFreshGoogleAccessToken(gd).catch(() => null);
      const tokenForGoogle = freshGoogleToken || googleSel.accessToken || null;

      const loginCid = resolveLoginCustomerId(gd);

      const googleSpendPromise = (async () => {
        // 1) Vía Insights (preferido)
        const viaInsights = await fetchGoogleAdsSpend30dViaInsights({
          accessToken: tokenForGoogle,
          customerId: googleSel.id,
        }).catch(() => null);

        if (viaInsights != null) return viaInsights;

        // 2) Fallback legacy (direct API)
        const legacy = await fetchGoogleAdsSpend30d({
          accessToken: tokenForGoogle,
          customerId: googleSel.id,
          developerToken: devToken,
          loginCustomerId: loginCid || googleSel.loginCustomerId,
        }).catch(() => null);

        return legacy;
      })();

      const [metaSpend30d, googleSpend30d, ga4Sessions30d] = await Promise.all([
        fetchMetaSpend30d({ accessToken: metaSel.token, actId: metaSel.id }).catch(
          () => null
        ),
        googleSpendPromise,
        fetchGa4Sessions30d({ accessToken: tokenForGoogle, propertyId: gaSel.id }).catch(
          () => null
        ),
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
      const lastLoginAt = lastLoginMap.get(uid) || null;

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

    if (!name) return res.status(400).json({ ok: false, error: "NAME_REQUIRED" });

    if (!["day", "week", "month"].includes(groupBy)) {
      return res.status(400).json({ ok: false, error: "INVALID_GROUPBY" });
    }

    const range = getEffectiveRange(req);

    const dateMatch = buildDateMatch(range.from, range.to);
    const match = { name };
    if (dateMatch) Object.assign(match, dateMatch);

    const effectiveDateExpr = { $ifNull: ["$ts", "$createdAt"] };

    let groupId = null;

    if (groupBy === "day") {
      groupId = {
        $dateToString: {
          format: "%Y-%m-%d",
          date: effectiveDateExpr,
          timezone: ANALYTICS_TZ,
        },
      };
    } else if (groupBy === "month") {
      groupId = {
        $dateToString: {
          format: "%Y-%m",
          date: effectiveDateExpr,
          timezone: ANALYTICS_TZ,
        },
      };
    } else {
      const weekStart = {
        $dateTrunc: { date: effectiveDateExpr, unit: "week", timezone: ANALYTICS_TZ },
      };
      groupId = {
        $dateToString: {
          format: "%Y-%m-%d",
          date: weekStart,
          timezone: ANALYTICS_TZ,
        },
      };
    }

    const rows = await AnalyticsEvent.aggregate([
      { $match: match },
      { $match: { $expr: { $ne: [effectiveDateExpr, null] } } },
      {
        $group: {
          _id: groupId,
          count: { $sum: { $ifNull: ["$count", 1] } },
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
        from: range.from ? range.from.toISOString() : null,
        to: range.to ? range.to.toISOString() : null,

        // compat
        fromTs: range.fromTs,
        toTs: range.toTs,
        swapped: range.swapped || false,

        // ✅ cierre diario
        cutoffDay: range.cutoffDay || null,
        cutoffEnd: range.cutoffEnd ? range.cutoffEnd.toISOString() : null,
        cutoffEffectiveDay: range.cutoffEffectiveDay || null,

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
    const range = getEffectiveRange(req);

    const STEP_GROUPS = {
      user_signed_up: ["user_signed_up", "signed_up", "signup", "user_created"],
      google_connected: ["google_connected"],
      meta_connected: ["meta_connected"],
      audit_requested: [
        "audit_requested",
        "audit_started",
        "audit_run_requested",
        "first_audit_started",
        "generate_audit_clicked",
        "ai_audit_requested",
      ],
      audit_completed: [
        "audit_completed",
        "audit_done",
        "audit_ready",
        "audit_generated",
        "ai_audit_completed",
        "audit_created",
      ],
      pixel_audit_completed: [
        "pixel_audit_completed",
        "pixel_auditor_completed",
        "pixel_audit_done",
      ],
    };

    const stepsRaw = String(req.query.steps || "").trim();

    const DEFAULT_STEPS = [
      "user_signed_up",
      "google_connected",
      "meta_connected",
      "audit_requested",
      "audit_completed",
      "pixel_audit_completed",
    ];

    const stepKeys = stepsRaw
      ? stepsRaw
          .split(",")
          .map((s) => String(s || "").trim())
          .filter(Boolean)
      : DEFAULT_STEPS;

    const expandedNamesByStep = new Map();
    for (const k of stepKeys) expandedNamesByStep.set(k, STEP_GROUPS[k] || [k]);

    const allNames = Array.from(expandedNamesByStep.values()).flat();

    const dateMatch = buildDateMatch(range.from, range.to);
    const match = { name: { $in: allNames } };
    if (dateMatch) Object.assign(match, dateMatch);

    const effectiveDateExpr = { $ifNull: ["$ts", "$createdAt"] };

    const rows = await AnalyticsEvent.aggregate([
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

    const counts = Object.fromEntries(stepKeys.map((k) => [k, 0]));

    for (const u of rows) {
      const names = Array.isArray(u.names) ? u.names : [];
      for (const stepKey of stepKeys) {
        const bucket = expandedNamesByStep.get(stepKey) || [stepKey];
        if (bucket.some((nm) => names.includes(nm))) counts[stepKey] += 1;
      }
    }

    const funnel = stepKeys.map((k, idx) => ({
      step: k,
      index: idx,
      users: counts[k] || 0,
    }));

    for (let i = 0; i < funnel.length; i++) {
      if (i === 0) {
        funnel[i].dropFromPrev = 0;
        funnel[i].conversionFromPrev = 1;
        continue;
      }
      const prev = funnel[i - 1].users || 0;
      const curr = funnel[i].users || 0;
      funnel[i].dropFromPrev = Math.max(0, prev - curr);
      funnel[i].conversionFromPrev = prev > 0 ? Number((curr / prev).toFixed(4)) : 0;
    }

    return res.json({
      ok: true,
      data: {
        from: range.from ? range.from.toISOString() : null,
        to: range.to ? range.to.toISOString() : null,

        // compat
        fromTs: range.fromTs,
        toTs: range.toTs,
        swapped: range.swapped || false,

        // ✅ cierre diario
        cutoffDay: range.cutoffDay || null,
        cutoffEnd: range.cutoffEnd ? range.cutoffEnd.toISOString() : null,
        cutoffEffectiveDay: range.cutoffEffectiveDay || null,

        steps: stepKeys,
        totalUsersInWindow: rows.length,
        funnel,
      },
    });
  } catch (e) {
    console.error("[adminAnalytics] /funnel error:", e);
    return res.status(500).json({ ok: false, error: "FUNNEL_ERROR" });
  }
});

module.exports = router;
