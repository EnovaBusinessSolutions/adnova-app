// backend/routes/googleConversions.js
"use strict";

const express = require("express");
const router = express.Router();

const { OAuth2Client } = require("google-auth-library");

// ✅ Reusar tu servicio GAQL que ya funciona en prod
const Ads = require("../services/googleAdsService");

let GoogleAccount;
try {
  GoogleAccount = require("../models/GoogleAccount");
} catch (_) {
  GoogleAccount = null;
}

const safeStr = (v) => String(v || "").trim();
const normDigits = (s) => safeStr(s).replace(/[^\d]/g, "");

// ===== Auth guard (mismo estilo que insights) =====
function requireAuth(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
}

// ===== customer selection =====
function getSelectedCustomerId(doc) {
  if (!doc) return "";
  const sel =
    Array.isArray(doc.selectedCustomerIds) && doc.selectedCustomerIds.length
      ? doc.selectedCustomerIds[0]
      : "";
  const def = safeStr(doc.defaultCustomerId);
  const raw = safeStr(sel) || def;
  return normDigits(raw);
}

function isAdsConnected(doc) {
  if (!doc) return false;
  if (doc.connectedAds === true) return true;
  return !!(safeStr(doc.refreshToken) || safeStr(doc.accessToken));
}

// ===== OAuth client (igual que insights) =====
function oauth() {
  return new OAuth2Client({
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: process.env.GOOGLE_REDIRECT_URI || process.env.GOOGLE_CONNECT_CALLBACK_URL,
  });
}

/**
 * Devuelve un access_token vigente usando accessToken o refreshToken.
 * Actualiza Mongo si logra refresh con nueva expiración.
 * (Copiado conceptualmente de googleAdsInsights.js para consistencia)
 */
async function getFreshAccessToken(gaDoc) {
  if (gaDoc?.accessToken && gaDoc?.expiresAt) {
    const ms = new Date(gaDoc.expiresAt).getTime() - Date.now();
    if (ms > 60_000) return gaDoc.accessToken; // válido > 60s
  }

  const client = oauth();
  client.setCredentials({
    refresh_token: gaDoc?.refreshToken || undefined,
    access_token: gaDoc?.accessToken || undefined,
  });

  // 1) refreshAccessToken (con expiry)
  try {
    const { credentials } = await client.refreshAccessToken();
    const access = credentials.access_token;
    if (access) {
      await GoogleAccount.updateOne(
        { _id: gaDoc._id },
        {
          $set: {
            accessToken: access,
            expiresAt: credentials.expiry_date ? new Date(credentials.expiry_date) : null,
            updatedAt: new Date(),
          },
        }
      );
      return access;
    }
  } catch (_) {
    // ignore y probamos getAccessToken
  }

  // 2) getAccessToken (sin expiry)
  const t = await client.getAccessToken().catch(() => null);
  if (t?.token) return t.token;

  if (gaDoc?.accessToken) return gaDoc.accessToken;
  throw new Error("NO_ACCESS_OR_REFRESH_TOKEN");
}

// ===== shape normalizer para rows GAQL =====
function extractConversionAction(row = {}) {
  // En GAQL stream normalmente viene como row.conversionAction
  // Pero dejamos fallbacks por compat
  return (
    row.conversionAction ||
    row.conversion_action ||
    row?.conversion_action?.conversionAction ||
    row?.conversionAction ||
    null
  );
}

// GET /api/google/ads/conversions
router.get("/ads/conversions", requireAuth, async (req, res) => {
  try {
    const uid = req.user?._id;
    if (!uid) return res.status(401).json({ ok: false, error: "NO_SESSION" });

    if (!GoogleAccount) {
      return res.json({ ok: true, data: [], recommendedResource: null, reason: "NO_GOOGLE_MODEL" });
    }

    // ✅ tokens select:false => usamos static con tokens
    const ga = await GoogleAccount.loadForUserWithTokens(uid)
      .select("selectedCustomerIds defaultCustomerId connectedAds expiresAt")
      .lean();

    if (!ga) {
      return res.json({ ok: true, data: [], recommendedResource: null, reason: "GOOGLE_NOT_CONNECTED" });
    }

    if (!isAdsConnected(ga)) {
      return res.json({ ok: true, data: [], recommendedResource: null, reason: "ADS_NOT_CONNECTED" });
    }

    const customerId = getSelectedCustomerId(ga);
    if (!customerId) {
      return res.json({ ok: true, data: [], recommendedResource: null, reason: "NO_CUSTOMER_SELECTED" });
    }

    // ✅ Multi-token: mismo refresh que insights
    let accessToken;
    try {
      accessToken = await getFreshAccessToken(ga);
    } catch {
      accessToken = safeStr(ga?.accessToken);
    }

    if (!accessToken) {
      return res.json({ ok: true, data: [], recommendedResource: null, reason: "NO_ACCESS_TOKEN" });
    }

    const GAQL = `
      SELECT
        conversion_action.resource_name,
        conversion_action.name,
        conversion_action.status,
        conversion_action.type
      FROM conversion_action
      WHERE conversion_action.status != 'REMOVED'
      ORDER BY conversion_action.name
      LIMIT 200
    `.replace(/\s+/g, " ").trim();

    // ✅ Reusar tu método probado (maneja tu versión/config)
    const rowsRaw = await Ads.searchGAQLStream(accessToken, customerId, GAQL);

    const rows = (Array.isArray(rowsRaw) ? rowsRaw : [])
      .map((r) => {
        const ca = extractConversionAction(r) || {};
        const resourceName = safeStr(ca.resourceName || ca.resource_name);
        if (!resourceName) return null;

        return {
          resourceName,
          name: safeStr(ca.name) || resourceName,
          status: safeStr(ca.status) || null,
          type: safeStr(ca.type) || null,
        };
      })
      .filter(Boolean);

    // recommended: PURCHASE por nombre
    const re = /purchase|compra|checkout|order|pedido|conversion/i;
    let recommendedResource = null;
    const pick = rows.find((x) => re.test(x.name || ""));
    if (pick) recommendedResource = pick.resourceName;
    else if (rows.length === 1) recommendedResource = rows[0].resourceName;

    return res.json({
      ok: true,
      data: rows,
      recommendedResource,
      meta: { customerId },
    });
  } catch (e) {
    const detail = e?.api?.error || e?.response?.data || e?.message || String(e);
    const apiLog = e?.api?.log || null;

    console.error("[google/ads/conversions] error:", detail);
    return res.status(500).json({
      ok: false,
      error: "GOOGLE_CONVERSIONS_FAILED",
      message: String(detail),
      apiLog,
    });
  }
});

module.exports = router;