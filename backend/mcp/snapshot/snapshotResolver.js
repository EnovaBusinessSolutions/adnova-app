'use strict';

const mongoose = require('mongoose');
const McpData = require('../../models/McpData');

/** @typedef {'googleAds'|'metaAds'} McpSourceKey */

/**
 * @typedef {Object} SnapshotMeta
 * @property {string} source_mode
 * @property {string|null} snapshot_id
 * @property {number|null} snapshot_age_min
 * @property {boolean} fresh
 */

function safeStr(v) {
  return v == null ? '' : String(v).trim();
}

function toObjectId(userId) {
  if (!userId) return null;
  if (userId instanceof mongoose.Types.ObjectId) return userId;
  try {
    return new mongoose.Types.ObjectId(String(userId));
  } catch {
    return null;
  }
}

/**
 * YYYY-MM-DD string compare
 */
function ymdGte(a, b) {
  return safeStr(a) >= safeStr(b);
}

function ymdLte(a, b) {
  return safeStr(a) <= safeStr(b);
}

/**
 * Chunk.range covers the requested window (inclusive).
 */
function chunkCoversDateRange(chunk, dateFrom, dateTo) {
  const r = chunk?.range || {};
  const from = safeStr(r.from);
  const to = safeStr(r.to);
  if (!from || !to) return false;
  return ymdGte(dateFrom, from) && ymdLte(dateTo, to);
}

/**
 * Chunk solapa el rango pedido (inclusive).
 * Esto permite servir "parcial" cuando el collector solo guarda hasta ayer (TZ del cliente).
 */
function chunkOverlapsDateRange(chunk, dateFrom, dateTo) {
  const r = chunk?.range || {};
  const from = safeStr(r.from);
  const to = safeStr(r.to);
  if (!from || !to) return false;
  // chunk.from <= dateTo && chunk.to >= dateFrom
  return ymdLte(from, dateTo) && ymdGte(to, dateFrom);
}

function getChunkUpdatedAt(chunk) {
  const d = chunk?.updatedAt || chunk?.createdAt;
  if (!d) return null;
  const t = d instanceof Date ? d.getTime() : new Date(d).getTime();
  return Number.isFinite(t) ? t : null;
}

function getSnapshotAgeMinutes(chunk) {
  const t = getChunkUpdatedAt(chunk);
  if (t == null) return null;
  return Math.max(0, (Date.now() - t) / 60000);
}

function isFreshSnapshot(chunk, maxAgeMin) {
  const age = getSnapshotAgeMinutes(chunk);
  if (age == null) return false;
  return age <= maxAgeMin;
}

/**
 * @param {Array<{date?: string, kpis?: object}>} totalsByDay
 * @param {string} dateFrom
 * @param {string} dateTo
 */
function filterTotalsByDayRange(totalsByDay, dateFrom, dateTo) {
  const rows = Array.isArray(totalsByDay) ? totalsByDay : [];
  return rows.filter((r) => {
    const d = safeStr(r?.date);
    if (!d) return false;
    return ymdGte(d, dateFrom) && ymdLte(d, dateTo);
  });
}

/**
 * Require every calendar day in [dateFrom, dateTo] to exist in totals (strict coverage).
 * If a day has no row, snapshot is not considered complete for that window.
 */
function listDaysInclusive(from, to) {
  const a = safeStr(from);
  const b = safeStr(to);
  if (!a || !b || a > b) return [];
  const out = [];
  const cur = new Date(`${a}T12:00:00.000Z`);
  const end = new Date(`${b}T12:00:00.000Z`);
  while (cur <= end) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

function hasFullDayCoverage(totalsByDay, dateFrom, dateTo) {
  const filtered = filterTotalsByDayRange(totalsByDay, dateFrom, dateTo);
  const days = listDaysInclusive(dateFrom, dateTo);
  if (days.length === 0) return false;
  const set = new Set(filtered.map((r) => safeStr(r.date)));
  for (const d of days) {
    if (!set.has(d)) return false;
  }
  return true;
}

/**
 * Latest chunk for user+source+dataset (by updatedAt).
 */
async function findLatestChunk(userId, source, dataset) {
  const uid = toObjectId(userId);
  if (!uid) return null;
  return McpData.findOne({
    userId: uid,
    kind: 'chunk',
    source,
    dataset,
  })
    .sort({ updatedAt: -1, createdAt: -1 })
    .lean();
}

/**
 * Devuelve el chunk "más reciente" que además solape [dateFrom, dateTo].
 * Esto evita el bug donde el chunk más nuevo no cubre el rango pedido.
 */
async function findLatestOverlappingChunk(userId, source, dataset, dateFrom, dateTo) {
  const uid = toObjectId(userId);
  if (!uid) return null;

  // Limitamos para no escanear toda la colección.
  const candidates = await McpData.find({
    userId: uid,
    kind: 'chunk',
    source,
    dataset,
  })
    .sort({ updatedAt: -1, createdAt: -1 })
    .limit(20)
    .lean();

  for (const c of candidates || []) {
    if (chunkOverlapsDateRange(c, dateFrom, dateTo)) return c;
  }
  return null;
}

/**
 * Resolve daily totals for ad performance: prefer daily_trends_ai, else history.daily_account_totals.
 */
async function resolveDailyTotalsForRange(userId, source, dateFrom, dateTo) {
  const datasetPrimary = source === 'googleAds' ? 'google.daily_trends_ai' : 'meta.daily_trends_ai';
  const datasetHistory = source === 'googleAds' ? 'google.history.daily_account_totals' : 'meta.history.daily_account_totals';

  const primary = await findLatestOverlappingChunk(userId, source, datasetPrimary, dateFrom, dateTo);
  if (primary?.data && chunkOverlapsDateRange(primary, dateFrom, dateTo)) {
    const totals = primary.data.totals_by_day;
    const filtered = filterTotalsByDayRange(totals, dateFrom, dateTo);
    if (filtered.length > 0) {
      return {
        chunk: primary,
        totalsByDay: filtered,
        dataset: datasetPrimary,
        partial_coverage: !hasFullDayCoverage(totals, dateFrom, dateTo),
      };
    }
  }

  const history = await findLatestOverlappingChunk(userId, source, datasetHistory, dateFrom, dateTo);
  if (history?.data && chunkOverlapsDateRange(history, dateFrom, dateTo)) {
    const totals = history.data.totals_by_day;
    const filtered = filterTotalsByDayRange(totals, dateFrom, dateTo);
    if (filtered.length > 0) {
      return {
        chunk: history,
        totalsByDay: filtered,
        dataset: datasetHistory,
        partial_coverage: !hasFullDayCoverage(totals, dateFrom, dateTo),
      };
    }
  }

  return null;
}

/**
 * campaigns_daily rows for campaign-level aggregation
 */
async function resolveCampaignsDailyForRange(userId, source, dateFrom, dateTo) {
  const datasetPrimary = source === 'googleAds' ? 'google.daily_trends_ai' : 'meta.daily_trends_ai';

  const primary = await findLatestOverlappingChunk(userId, source, datasetPrimary, dateFrom, dateTo);
  if (!primary?.data || !chunkOverlapsDateRange(primary, dateFrom, dateTo)) return null;

  const raw = primary.data.campaigns_daily;
  if (!Array.isArray(raw) || raw.length === 0) return null;

  const filtered = raw.filter((r) => {
    const d = safeStr(r?.date);
    return d && ymdGte(d, dateFrom) && ymdLte(d, dateTo);
  });
  if (filtered.length === 0) return null;

  const days = listDaysInclusive(dateFrom, dateTo);
  const dateSet = new Set(filtered.map((r) => safeStr(r.date)));
  const partial_coverage = days.some((d) => !dateSet.has(d));

  return { chunk: primary, rows: filtered, dataset: datasetPrimary, partial_coverage };
}

module.exports = {
  findLatestChunk,
  findLatestOverlappingChunk,
  resolveDailyTotalsForRange,
  resolveCampaignsDailyForRange,
  chunkCoversDateRange,
  chunkOverlapsDateRange,
  filterTotalsByDayRange,
  getSnapshotAgeMinutes,
  isFreshSnapshot,
  hasFullDayCoverage,
  safeStr,
};
