"use strict";
const AnalyticsEvent = require("../models/AnalyticsEvent");

async function trackEvent({ name, userId, dedupeKey, props }) {
  try {
    if (!name) return null;

    const doc = {
      name: String(name),
      props: props && typeof props === "object" ? props : {},
    };

    if (userId) doc.userId = userId;
    if (dedupeKey) doc.dedupeKey = String(dedupeKey);

    // upsert si hay dedupeKey (idempotente)
    if (dedupeKey) {
      return await AnalyticsEvent.findOneAndUpdate(
        { name: doc.name, userId: doc.userId, dedupeKey: doc.dedupeKey },
        { $setOnInsert: doc },
        { upsert: true, new: true }
      );
    }

    return await AnalyticsEvent.create(doc);
  } catch (e) {
    // No rompas el flujo productivo por analytics
    return null;
  }
}

module.exports = { trackEvent };
