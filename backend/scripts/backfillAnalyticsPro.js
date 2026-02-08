"use strict";

require("dotenv").config();
const mongoose = require("mongoose");

const User = require("../models/User");
const AnalyticsEvent = require("../models/AnalyticsEvent");

const GoogleAccount = require("../models/GoogleAccount");
const MetaAccount = require("../models/MetaAccount");

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

async function upsertEvent({ name, userId, ts, source, dedupeKey, props }) {
  if (!name || !userId) return null;

  const doc = {
    name,
    userId,
    ts: ts || new Date(),
    source: source || "server_backfill",
    dedupeKey,
    props: props || { backfill: true },
  };

  return AnalyticsEvent.findOneAndUpdate(
    { name, userId, dedupeKey },
    { $setOnInsert: doc },
    { upsert: true, new: true }
  );
}

async function run() {
  if (!process.env.MONGO_URI) {
    console.error("Missing MONGO_URI");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log("[backfill-pro] connected");

  const counters = Object.create(null);

  // ----------------------------
  // 1) Users → user_signed_up (+ opcional welcome/email_verified inferidos)
  // ----------------------------
  const users = await User.find(
    {},
    { _id: 1, createdAt: 1, updatedAt: 1, welcomeEmailSent: 1, welcomeEmailSentAt: 1, emailVerified: 1 }
  ).lean();

  console.log("[backfill-pro] users:", users.length);

  for (const u of users) {
    const createdTs = u.createdAt || objectIdToDate(u._id) || new Date();

    await upsertEvent({
      name: "user_signed_up",
      userId: u._id,
      ts: createdTs,
      source: "server_backfill",
      dedupeKey: `signup:${String(u._id)}`,
      props: { backfill: true, sourceCollection: "users" },
    });
    counters.user_signed_up = (counters.user_signed_up || 0) + 1;

    if (u.welcomeEmailSent && u.welcomeEmailSentAt) {
      await upsertEvent({
        name: "welcome_email_sent",
        userId: u._id,
        ts: new Date(u.welcomeEmailSentAt),
        source: "server_backfill",
        dedupeKey: `welcome:${String(u._id)}`,
        props: { backfill: true, sourceCollection: "users" },
      });
      counters.welcome_email_sent = (counters.welcome_email_sent || 0) + 1;
    }

    // emailVerified no tiene timestamp → aproximamos con updatedAt
    if (u.emailVerified) {
      await upsertEvent({
        name: "email_verified",
        userId: u._id,
        ts: u.updatedAt || createdTs,
        source: "server_backfill",
        dedupeKey: `email_verified:${String(u._id)}`,
        props: { backfill: true, inferred: true, sourceCollection: "users" },
      });
      counters.email_verified = (counters.email_verified || 0) + 1;
    }
  }

  // ----------------------------
  // 2) GoogleAccounts → google_connected + selections (fechas reales)
  // ----------------------------
  const googleAccounts = await GoogleAccount.find(
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
    }
  ).lean();

  console.log("[backfill-pro] googleaccounts:", googleAccounts.length);

  for (const a of googleAccounts) {
    const userId = a.userId || a.user || null;
    if (!userId) continue;

    const createdTs = a.createdAt || objectIdToDate(a._id) || new Date();
    const updatedTs = a.updatedAt || createdTs;

    await upsertEvent({
      name: "google_connected",
      userId,
      ts: createdTs,
      source: "server_backfill",
      dedupeKey: `google_connected:${String(a._id)}`,
      props: { backfill: true, sourceCollection: "googleaccounts" },
    });
    counters.google_connected = (counters.google_connected || 0) + 1;

    const hasAdsSelection = Array.isArray(a.selectedCustomerIds) && a.selectedCustomerIds.length > 0;
    if (hasAdsSelection) {
      await upsertEvent({
        name: "google_ads_selected",
        userId,
        ts: updatedTs,
        source: "server_backfill",
        dedupeKey: `google_ads_selected:${String(a._id)}`,
        props: {
          backfill: true,
          sourceCollection: "googleaccounts",
          selectedCount: a.selectedCustomerIds.length,
        },
      });
      counters.google_ads_selected = (counters.google_ads_selected || 0) + 1;
    }

    const hasGa4Selection =
      (Array.isArray(a.selectedPropertyIds) && a.selectedPropertyIds.length > 0) ||
      !!a.selectedGaPropertyId;

    if (hasGa4Selection) {
      const count = Array.isArray(a.selectedPropertyIds) ? a.selectedPropertyIds.length : 1;
      await upsertEvent({
        name: "ga4_selected",
        userId,
        ts: updatedTs,
        source: "server_backfill",
        dedupeKey: `ga4_selected:${String(a._id)}`,
        props: { backfill: true, sourceCollection: "googleaccounts", selectedCount: count },
      });
      counters.ga4_selected = (counters.ga4_selected || 0) + 1;
    }

    const adsDiscovered =
      (Array.isArray(a.ad_accounts) && a.ad_accounts.length > 0) ||
      (Array.isArray(a.customers) && a.customers.length > 0);

    if (adsDiscovered) {
      await upsertEvent({
        name: "google_ads_discovered",
        userId,
        ts: updatedTs,
        source: "server_backfill",
        dedupeKey: `google_ads_discovered:${String(a._id)}`,
        props: { backfill: true, sourceCollection: "googleaccounts" },
      });
      counters.google_ads_discovered = (counters.google_ads_discovered || 0) + 1;
    }

    const ga4Discovered = Array.isArray(a.gaProperties) && a.gaProperties.length > 0;
    if (ga4Discovered) {
      await upsertEvent({
        name: "ga4_discovered",
        userId,
        ts: updatedTs,
        source: "server_backfill",
        dedupeKey: `ga4_discovered:${String(a._id)}`,
        props: { backfill: true, sourceCollection: "googleaccounts" },
      });
      counters.ga4_discovered = (counters.ga4_discovered || 0) + 1;
    }
  }

  // ----------------------------
  // 3) MetaAccounts → meta_connected + selections (fechas reales)
  // ----------------------------
  const metaAccounts = await MetaAccount.find(
    {},
    {
      _id: 1,
      user: 1,
      userId: 1,
      createdAt: 1,
      updatedAt: 1,
      selectedAccountIds: 1,
      ad_accounts: 1,
      adAccounts: 1,
    }
  ).lean();

  console.log("[backfill-pro] metaaccounts:", metaAccounts.length);

  for (const a of metaAccounts) {
    const userId = a.userId || a.user || null;
    if (!userId) continue;

    const createdTs = a.createdAt || objectIdToDate(a._id) || new Date();
    const updatedTs = a.updatedAt || createdTs;

    await upsertEvent({
      name: "meta_connected",
      userId,
      ts: createdTs,
      source: "server_backfill",
      dedupeKey: `meta_connected:${String(a._id)}`,
      props: { backfill: true, sourceCollection: "metaaccounts" },
    });
    counters.meta_connected = (counters.meta_connected || 0) + 1;

    const hasSelection = Array.isArray(a.selectedAccountIds) && a.selectedAccountIds.length > 0;
    if (hasSelection) {
      await upsertEvent({
        name: "meta_ads_selected",
        userId,
        ts: updatedTs,
        source: "server_backfill",
        dedupeKey: `meta_ads_selected:${String(a._id)}`,
        props: {
          backfill: true,
          sourceCollection: "metaaccounts",
          selectedCount: a.selectedAccountIds.length,
        },
      });
      counters.meta_ads_selected = (counters.meta_ads_selected || 0) + 1;
    }

    const discovered =
      (Array.isArray(a.ad_accounts) && a.ad_accounts.length > 0) ||
      (Array.isArray(a.adAccounts) && a.adAccounts.length > 0);

    if (discovered) {
      await upsertEvent({
        name: "meta_ads_discovered",
        userId,
        ts: updatedTs,
        source: "server_backfill",
        dedupeKey: `meta_ads_discovered:${String(a._id)}`,
        props: { backfill: true, sourceCollection: "metaaccounts" },
      });
      counters.meta_ads_discovered = (counters.meta_ads_discovered || 0) + 1;
    }
  }

  console.log("[backfill-pro] done counters:", counters);
  await mongoose.disconnect();
  console.log("[backfill-pro] disconnected");
}

run().catch((e) => {
  console.error("[backfill-pro] fatal:", e);
  process.exit(1);
});
