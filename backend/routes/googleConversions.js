// backend/routes/googleConversions.js
"use strict";

const express = require("express");
const router = express.Router();

let GoogleAccount;
try {
  GoogleAccount = require("../models/GoogleAccount");
} catch (_) {
  GoogleAccount = null;
}

const safeStr = (v) => String(v || "").trim();
const normDigits = (s) => safeStr(s).replace(/[^\d]/g, "");

/* =========================
 * OAuth helper (refresh token)
 * ========================= */
let OAuth2Client = null;
try {
  ({ OAuth2Client } = require("google-auth-library"));
} catch {
  OAuth2Client = null;
}

function resolveGoogleClientId() {
  return safeStr(process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_OAUTH_CLIENT_ID);
}
function resolveGoogleClientSecret() {
  return safeStr(process.env.GOOGLE_CLIENT_SECRET || process.env.GOOGLE_OAUTH_CLIENT_SECRET);
}

function canRefreshAds(doc) {
  return !!safeStr(doc?.refreshToken);
}

async function getFreshAdsAccessToken(doc) {
  const accessToken = safeStr(doc?.accessToken);
  if (accessToken) return { accessToken, refreshed: false };

  const refreshToken = safeStr(doc?.refreshToken);
  if (!refreshToken) return { accessToken: "", refreshed: false };

  if (!OAuth2Client) return { accessToken: "", refreshed: false };

  const clientId = resolveGoogleClientId();
  const clientSecret = resolveGoogleClientSecret();
  if (!clientId || !clientSecret) return { accessToken: "", refreshed: false };

  const oauth = new OAuth2Client(clientId, clientSecret);
  oauth.setCredentials({ refresh_token: refreshToken });

  const out = await oauth.getAccessToken();
  const token = safeStr(out?.token || out);

  return { accessToken: token, refreshed: !!token };
}

/* =========================
 * Selection helpers
 * ========================= */
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
  // best-effort: si hay tokens, también cuenta como conectado
  return !!(safeStr(doc.refreshToken) || safeStr(doc.accessToken));
}

/**
 * Llamada a Google Ads API REST (searchStream)
 * - Endpoint (v16): https://googleads.googleapis.com/v16/customers/{customerId}/googleAds:searchStream
 */
async function googleAdsSearchStream({
  customerId,
  developerToken,
  loginCustomerId,
  accessToken,
  query,
}) {
  const url = `https://googleads.googleapis.com/v16/customers/${customerId}/googleAds:searchStream`;

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "developer-token": developerToken,
    "Content-Type": "application/json",
  };

  if (loginCustomerId) headers["login-customer-id"] = String(loginCustomerId);

  const body = JSON.stringify({ query });

  const r = await fetch(url, { method: "POST", headers, body });
  const txt = await r.text();

  let json;
  try {
    json = txt ? JSON.parse(txt) : [];
  } catch {
    json = [];
  }

  if (!r.ok) {
    const msg =
      json?.error?.message ||
      (typeof txt === "string" && txt.slice(0, 240)) ||
      `HTTP ${r.status}`;
    const err = new Error(msg);
    err.status = r.status;
    err.raw = txt;
    throw err;
  }

  return Array.isArray(json) ? json : [];
}

function resolveGoogleDeveloperToken() {
  // Render suele usar GOOGLE_DEVELOPER_TOKEN
  return safeStr(process.env.GOOGLE_DEVELOPER_TOKEN || process.env.GOOGLE_ADS_DEVELOPER_TOKEN);
}

function resolveLoginCustomerId(doc) {
  return safeStr(
    doc?.loginCustomerId ||
      process.env.GOOGLE_LOGIN_CUSTOMER_ID ||
      process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID
  );
}

// GET /api/google/ads/conversions
router.get("/ads/conversions", async (req, res) => {
  try {
    const uid = req.user?._id;
    if (!uid) return res.status(401).json({ ok: false, error: "NO_SESSION" });

    if (!GoogleAccount) {
      return res.json({
        ok: true,
        data: [],
        recommendedResource: null,
        reason: "NO_GOOGLE_MODEL",
      });
    }

    // ✅ CRÍTICO: tokens están select:false, por eso usamos el static
    const doc = await GoogleAccount.loadForUserWithTokens(uid).lean();
    if (!doc) {
      return res.json({
        ok: true,
        data: [],
        recommendedResource: null,
        reason: "GOOGLE_NOT_CONNECTED",
      });
    }

    if (!isAdsConnected(doc)) {
      return res.json({
        ok: true,
        data: [],
        recommendedResource: null,
        reason: "ADS_NOT_CONNECTED",
      });
    }

    const customerId = getSelectedCustomerId(doc);
    if (!customerId) {
      return res.json({
        ok: true,
        data: [],
        recommendedResource: null,
        reason: "NO_CUSTOMER_SELECTED",
      });
    }

    const developerToken = resolveGoogleDeveloperToken();
    if (!developerToken) {
      return res.status(500).json({ ok: false, error: "MISSING_GOOGLE_DEVELOPER_TOKEN" });
    }

    // ✅ Access token (refresh si hace falta)
    let accessToken = safeStr(doc?.accessToken);

    if (!accessToken && canRefreshAds(doc)) {
      const fresh = await getFreshAdsAccessToken(doc);
      accessToken = fresh.accessToken;

      // Persistir best-effort para siguientes llamadas
      if (fresh.refreshed && accessToken) {
        try {
          await GoogleAccount.updateOne(
            { $or: [{ user: uid }, { userId: uid }] },
            { $set: { accessToken, updatedAt: new Date() } },
            { upsert: false }
          );
        } catch {
          // noop
        }
      }
    }

    if (!accessToken) {
      return res.json({
        ok: true,
        data: [],
        recommendedResource: null,
        reason: "NO_ACCESS_TOKEN",
      });
    }

    const loginCustomerId = resolveLoginCustomerId(doc);

    const query = `
      SELECT
        conversion_action.resource_name,
        conversion_action.name,
        conversion_action.status,
        conversion_action.type
      FROM conversion_action
      WHERE conversion_action.status != 'REMOVED'
      ORDER BY conversion_action.name
      LIMIT 200
    `.trim();

    const chunks = await googleAdsSearchStream({
      customerId,
      developerToken,
      loginCustomerId: normDigits(loginCustomerId),
      accessToken,
      query,
    });

    // Flatten stream response
    const rows = [];
    for (const ch of chunks) {
      const results = Array.isArray(ch?.results) ? ch.results : [];
      for (const r of results) {
        const ca = r?.conversionAction || r?.conversion_action || {};
        const resourceName = safeStr(ca.resourceName || ca.resource_name);
        if (!resourceName) continue;
        rows.push({
          resourceName,
          name: safeStr(ca.name) || resourceName,
          status: safeStr(ca.status) || null,
          type: safeStr(ca.type) || null,
        });
      }
    }

    // recommended: PURCHASE por nombre (simple y efectivo)
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
    console.error("[google/ads/conversions] error:", e?.message || e);
    return res.status(500).json({
      ok: false,
      error: "GOOGLE_CONVERSIONS_FAILED",
      message: String(e?.message || "Error listando conversiones"),
    });
  }
});

module.exports = router;