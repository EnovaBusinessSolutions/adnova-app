"use strict";

const express = require("express");
const crypto = require("crypto");
const { OAuth2Client } = require("google-auth-library");

const router = express.Router();

/** =========================
 * Helpers
 * ========================= */
function baseUrl(req) {
  const proto = (req.headers["x-forwarded-proto"] || req.protocol || "https")
    .split(",")[0]
    .trim();
  const host = (req.headers["x-forwarded-host"] || req.get("host") || "")
    .split(",")[0]
    .trim();
  if (!host) return "https://adray.ai";
  return `${proto}://${host}`;
}

function safeDecodeState(rawState) {
  try {
    const s = typeof rawState === "string" ? rawState : "";
    if (!s) return null;
    const json = Buffer.from(s, "base64url").toString("utf8");
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function getUserIdFromReq(req) {
  const userId =
    req.user?._id ||
    req.user?.id ||
    req.session?.userId ||
    req.session?.user?._id ||
    req.session?.passport?.user; // passport a veces guarda aquí
  if (!userId) return null;
  return String(userId);
}

function getOAuthClient() {
  const clientId = process.env.GOOGLE_GA4_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_GA4_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_GA4_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Missing GOOGLE_GA4_CLIENT_ID/SECRET/REDIRECT_URI env vars");
  }
  return new OAuth2Client(clientId, clientSecret, redirectUri);
}

/** =========================
 * Model (robusto)
 * ========================= */
let GoogleAccount = null;
try {
  GoogleAccount = require("../models/GoogleAccount");
} catch (_) {
  GoogleAccount = null;
}

/** =========================
 * Config
 * ========================= */
const STATE_TTL_MS = 15 * 60 * 1000; // 15 min (ajustable)
const GA4_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/analytics.readonly",
];

/**
 * GET /auth/google/ga4/start
 * Inicia OAuth solo GA4
 */
router.get("/auth/google/ga4/start", async (req, res) => {
  const userId = getUserIdFromReq(req);
  if (!userId) return res.status(401).send("Not authenticated");

  let oauth;
  try {
    oauth = getOAuthClient();
  } catch (err) {
    return res.status(500).send(err.message);
  }

  const state = {
    kind: "ga4",
    userId,
    nonce: crypto.randomBytes(16).toString("hex"),
    redirect: "/dashboard/settings?tab=integrations&ga4=ok",
    ts: Date.now(),
  };

  // Guarda nonce en sesión para validar (si existe sesión)
  if (req.session) req.session.ga4OauthStateNonce = state.nonce;

  const url = oauth.generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // importante para refresh_token
    include_granted_scopes: true,
    scope: GA4_SCOPES,
    state: Buffer.from(JSON.stringify(state)).toString("base64url"),
  });

  return res.redirect(url);
});

/**
 * GET /auth/google/ga4/callback
 * Callback OAuth GA4
 */
router.get("/auth/google/ga4/callback", async (req, res) => {
  const code = String(req.query.code || "").trim();
  const stateObj = safeDecodeState(req.query.state);

  if (!code) return res.status(400).send("Missing code");

  // Validar state básico
  const userIdFromState = stateObj?.userId ? String(stateObj.userId) : null;
  const userId = userIdFromState || getUserIdFromReq(req);
  if (!userId) return res.status(401).send("Not authenticated");

  // Validar expiración state (si venía)
  if (stateObj?.ts && typeof stateObj.ts === "number") {
    const age = Date.now() - stateObj.ts;
    if (age > STATE_TTL_MS) {
      return res.status(400).send("OAuth state expired. Please try again.");
    }
  }

  // Validación nonce contra sesión
  if (req.session && stateObj?.nonce && req.session.ga4OauthStateNonce) {
    if (String(stateObj.nonce) !== String(req.session.ga4OauthStateNonce)) {
      return res.status(400).send("Invalid OAuth state");
    }
    req.session.ga4OauthStateNonce = null;
  }

  let oauth;
  try {
    oauth = getOAuthClient();
  } catch (err) {
    return res.status(500).send(err.message);
  }

  try {
    const { tokens } = await oauth.getToken(code);
    const now = new Date();

    if (!GoogleAccount) {
      return res
        .status(500)
        .send("GoogleAccount model not found. Fix require path.");
    }

    // ✅ Guardado robusto:
    // - Guardamos en "ga4.*" (si tu schema lo permite)
    // - Y además guardamos campos planos ga4AccessToken/ga4RefreshToken...
    //   para que NO dependas de schema estricto.
    const patch = {
      // nested (si el schema lo acepta)
      "ga4.accessToken": tokens.access_token || null,
      ...(tokens.refresh_token ? { "ga4.refreshToken": tokens.refresh_token } : {}),
      "ga4.expiresAt": tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      "ga4.scope": tokens.scope || null,
      "ga4.connectedAt": now,

      // flat (ultra-compatible)
      ga4AccessToken: tokens.access_token || null,
      ...(tokens.refresh_token ? { ga4RefreshToken: tokens.refresh_token } : {}),
      ga4ExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      ga4Scope: tokens.scope || null,
      ga4ConnectedAt: now,

      updatedAt: now,
    };

    // Query multi-campo por compat
    const query = {
      $or: [{ owner: userId }, { userId }, { user: userId }],
    };

    await GoogleAccount.findOneAndUpdate(
      query,
      { $set: patch, $setOnInsert: { owner: userId, userId, createdAt: now } },
      { upsert: true, new: true }
    );

    const redirectPath =
      typeof stateObj?.redirect === "string" && stateObj.redirect.startsWith("/")
        ? stateObj.redirect
        : "/dashboard/settings?tab=integrations&ga4=ok";

    return res.redirect(`${baseUrl(req)}${redirectPath}`);
  } catch (err) {
  console.error("GA4 OAuth callback error:", err?.response?.data || err);

  const msg =
    err?.response?.data?.error_description ||
    err?.response?.data?.error ||
    err?.message ||
    "Unknown error";

  return res.status(500).type("text/plain").send(`GA4 OAuth failed: ${msg}`);
}
});

module.exports = router;
