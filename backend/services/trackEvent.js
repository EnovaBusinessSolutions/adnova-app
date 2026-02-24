"use strict";

const mongoose = require("mongoose");
const AnalyticsEvent = require("../models/AnalyticsEvent");

function safeStr(v, max = 200) {
  if (v === undefined || v === null) return "";
  return String(v).slice(0, max);
}

function safeObj(v) {
  if (!v || typeof v !== "object") return {};
  try {
    const json = JSON.stringify(v);
    if (json.length > 30_000) return { _truncated: true };
    return v;
  } catch {
    return {};
  }
}

function safeDate(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function toObjectIdMaybe(v) {
  if (!v) return null;
  try {
    const s = String(v).trim();
    if (!s) return null;
    if (!mongoose.Types.ObjectId.isValid(s)) return null;
    return new mongoose.Types.ObjectId(s);
  } catch {
    return null;
  }
}

/**
 * Construye updates seguros para props:
 * - No intentamos reemplazar todo props (para no pisar datos)
 * - Hacemos set por clave: props.key = value
 */
function buildPropsSet(props) {
  const p = safeObj(props);
  const out = {};
  for (const [k, val] of Object.entries(p)) {
    const key = safeStr(k, 80).trim();
    if (!key) continue;

    // Mongo no permite keys con '.' o que empiecen con '$'
    if (key.includes(".") || key.startsWith("$")) continue;

    // No dejamos strings gigantes
    if (typeof val === "string") out[`props.${key}`] = safeStr(val, 5000);
    else out[`props.${key}`] = val;
  }
  return out;
}

// ✅ Firma flexible + extensible: soporta ts/inc/setOnInsert
async function trackEvent({
  name,
  userId,
  userid,
  sessionId,
  source = "app",
  dedupeKey,
  dedupekey,
  props,
  ts, // ✅ opcional: timestamp canónico (ej. last login)
  inc, // ✅ opcional: { count: 1 }
  setOnInsert, // ✅ opcional: { firstTs: now }
}) {
  try {
    const eventName = safeStr(name, 80).trim();
    if (!eventName) return null;

    const uidRaw = userId || userid || null;
    const uid = toObjectIdMaybe(uidRaw); // ✅ cast seguro (evita perder eventos por cast inválido)
    const dk = dedupeKey || dedupekey || null;

    const now = new Date();
    const tsFinal = safeDate(ts) || now;

    const baseDoc = {
      name: eventName,
      source: safeStr(source, 40) || "app",
      ts: tsFinal, // ✅ fecha canónica: para filtros 7/30/90 y "último login"
      props: safeObj(props),
      createdAt: now,
      updatedAt: now,
    };

    if (uid) baseDoc.userId = uid;
    if (sessionId) baseDoc.sessionId = safeStr(sessionId, 120);
    if (dk) baseDoc.dedupeKey = safeStr(dk, 200);

    // ✅ Si NO hay dedupeKey -> crea siempre (RAW events)
    if (!baseDoc.dedupeKey) {
      return await AnalyticsEvent.create(baseDoc);
    }

    // 🔥 FIX: si hay dedupeKey pero NO hay userId válido, NO dedupes (evita colisiones / casts raros)
    if (!baseDoc.userId) {
      return await AnalyticsEvent.create(baseDoc);
    }

    // ✅ Con dedupeKey -> upsert, PERO:
    // - si ya existía, actualizamos ts (last activity) y hacemos merge de props
    // - si mandas inc, incrementa contadores
    // - si mandas setOnInsert, se setea solo cuando se crea por primera vez
    const filter = {
      name: baseDoc.name,
      userId: baseDoc.userId,
      dedupeKey: baseDoc.dedupeKey,
    };

    const propsSet = buildPropsSet(props);

    const update = {
      $setOnInsert: {
        ...baseDoc,
        ...(safeObj(setOnInsert) || {}),
        createdAt: now,
      },
      $set: {
        ts: tsFinal,
        updatedAt: now,
        // guardamos también source/sessionId por si cambian
        source: baseDoc.source,
        ...(baseDoc.sessionId ? { sessionId: baseDoc.sessionId } : {}),
        ...(Object.keys(propsSet).length ? propsSet : {}),
      },
    };

    // ✅ Incrementos opcionales (ej. { count: 1 })
    const incObj = safeObj(inc);
    if (incObj && Object.keys(incObj).length) {
      // Sanitizar keys del $inc
      const incSafe = {};
      for (const [k, v] of Object.entries(incObj)) {
        const key = safeStr(k, 80).trim();
        if (!key) continue;
        if (key.includes(".") || key.startsWith("$")) continue;
        const num = Number(v);
        if (!Number.isFinite(num)) continue;
        incSafe[key] = num;
      }
      if (Object.keys(incSafe).length) update.$inc = incSafe;
    }

    return await AnalyticsEvent.findOneAndUpdate(filter, update, {
      upsert: true,
      new: true,
    });
  } catch (e) {
    // ✅ No rompas el flujo por analítica, pero permite debug opcional
    if (process.env.ANALYTICS_DEBUG === "1") {
      console.error("[trackEvent] error:", e?.message || e, {
        name,
        userId,
        userid,
        dedupeKey,
        dedupekey,
      });
    }
    return null;
  }
}

module.exports = { trackEvent };
