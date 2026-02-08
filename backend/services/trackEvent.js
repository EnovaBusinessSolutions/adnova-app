"use strict";

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

// ✅ Firma flexible: acepta userId/userid, dedupeKey/dedupekey, etc.
async function trackEvent({ name, userId, userid, sessionId, source = "app", dedupeKey, dedupekey, props }) {
  try {
    const eventName = safeStr(name, 80).trim();
    if (!eventName) return null;

    const uid = userId || userid || null;
    const dk = dedupeKey || dedupekey || null;

    const doc = {
      name: eventName,
      props: safeObj(props),
      source: safeStr(source, 40) || "app",
      ts: new Date(), // ✅ fecha canónica para filtros 7/30/90
    };

    if (uid) doc.userId = uid;
    if (sessionId) doc.sessionId = safeStr(sessionId, 120);
    if (dk) doc.dedupeKey = safeStr(dk, 200);

    // ✅ idempotente si hay dedupeKey
    if (doc.dedupeKey) {
      return await AnalyticsEvent.findOneAndUpdate(
        { name: doc.name, userId: doc.userId, dedupeKey: doc.dedupeKey },
        { $setOnInsert: doc },
        { upsert: true, new: true }
      );
    }

    return await AnalyticsEvent.create(doc);
  } catch {
    // no rompas el flujo por analítica
    return null;
  }
}

module.exports = { trackEvent };
