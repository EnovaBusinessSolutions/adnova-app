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

/**
 * ✅ IMPORTANTE:
 * Para listar conversion actions necesitas un access token válido.
 * - Si en tu proyecto ya tienes helper para refrescar tokens (OAuth2Client),
 *   úsalo aquí y reemplaza esta función.
 */
function getGoogleAccessToken(doc) {
  return safeStr(doc?.accessToken);
}

/**
 * Llamada a Google Ads API REST.
 * - Endpoint (v16): https://googleads.googleapis.com/v16/customers/{customerId}/googleAds:searchStream
 * - Query: SELECT conversion_action.resource_name, conversion_action.name, conversion_action.status, conversion_action.type
 */
async function googleAdsSearchStream({ customerId, developerToken, loginCustomerId, accessToken, query }) {
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
  // por tu memoria previa: Render usa GOOGLE_DEVELOPER_TOKEN
  return safeStr(process.env.GOOGLE_DEVELOPER_TOKEN || process.env.GOOGLE_ADS_DEVELOPER_TOKEN);
}
function resolveLoginCustomerId(doc) {
  return safeStr(doc?.loginCustomerId || process.env.GOOGLE_LOGIN_CUSTOMER_ID || process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID);
}

// GET /api/google/ads/conversions
router.get("/ads/conversions", async (req, res) => {
  try {
    const uid = req.user?._id;
    if (!uid) return res.status(401).json({ ok: false, error: "NO_SESSION" });

    if (!GoogleAccount) {
      return res.json({ ok: true, data: [], recommendedResource: null, reason: "NO_GOOGLE_MODEL" });
    }

    const doc = await GoogleAccount.findOne({ $or: [{ user: uid }, { userId: uid }] }).lean();
    if (!doc) {
      return res.json({ ok: true, data: [], recommendedResource: null, reason: "GOOGLE_NOT_CONNECTED" });
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

    const accessToken = getGoogleAccessToken(doc);
    if (!accessToken) {
      return res.json({ ok: true, data: [], recommendedResource: null, reason: "NO_ACCESS_TOKEN" });
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

    // recommended: PURCHASE por nombre (y si luego quieres category, lo metemos)
    const re = /purchase|compra|checkout|order|pedido/i;
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