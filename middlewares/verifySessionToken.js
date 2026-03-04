// middlewares/verifySessionToken.js

"use strict";

const jwt = require("jsonwebtoken");

function parseBearerToken(req) {
  // Standard
  const auth = String(req.get("Authorization") || "").trim();
  if (auth) {
    // case-insensitive "Bearer <token>"
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (m && m[1]) return m[1].trim();
    // If they accidentally send token directly
    if (!auth.includes(" ")) return auth;
  }

  // Optional fallbacks (won't hurt; helps if something sends non-standard headers)
  const alt =
    String(req.get("X-Shopify-Authorization") || "").trim() ||
    String(req.get("X-Shopify-Session-Token") || "").trim();

  return alt || "";
}

function shopFromDest(dest) {
  // dest is usually: https://{shop}.myshopify.com
  const s = String(dest || "").trim();
  if (!s) return "";
  try {
    const u = new URL(s);
    return u.host || "";
  } catch {
    // if it's already a host
    return s.replace(/^https?:\/\//i, "").split("/")[0] || "";
  }
}

function shopFromIss(iss) {
  // iss is usually: https://{shop}.myshopify.com/admin
  const s = String(iss || "").trim();
  if (!s) return "";
  try {
    const u = new URL(s);
    return u.host || "";
  } catch {
    return s.replace(/^https?:\/\//i, "").split("/")[0] || "";
  }
}

module.exports = (req, res, next) => {
  const token = parseBearerToken(req);

  if (!token) {
    return res.status(401).json({ error: "Missing session token" });
  }

  const secret = process.env.SHOPIFY_API_SECRET;
  const apiKey = process.env.SHOPIFY_API_KEY;

  if (!secret) {
    console.error("ERROR: SHOPIFY_API_SECRET is not set in environment.");
    return res.status(500).json({ error: "Server configuration error" });
  }
  if (!apiKey) {
    console.error("ERROR: SHOPIFY_API_KEY is not set in environment.");
    return res.status(500).json({ error: "Server configuration error" });
  }

  try {
    // Verify signature + exp/nbf automatically
    // Also validate aud (audience) must match API Key
    const payload = jwt.verify(token, secret, {
      algorithms: ["HS256"],
      audience: apiKey,
      clockTolerance: 5, // small tolerance for skew
    });

    // Extract shop safely (prefer dest; fallback iss)
    const shopHost =
      shopFromDest(payload?.dest) ||
      shopFromIss(payload?.iss) ||
      "";

    if (!shopHost) {
      // If we can't infer shop, treat as invalid (prevents downstream confusion)
      res.set("X-Shopify-Retry-Invalid-Session-Request", "1");
      return res.status(401).json({
        error: "invalid session token",
        details: "missing dest/iss",
      });
    }

    // Attach verified info to request
    req.shopFromToken = shopHost; // e.g. "your-store.myshopify.com"
    req.userId = String(payload?.sub || ""); // Shopify user id (usually gid string)

    // Some routes like having direct access:
    req.shop = req.shopFromToken;

    return next();
  } catch (e) {
    console.warn("Session Token Verification Failed:", e?.message || e);
    // Tells App Bridge it should retry / re-auth
    res.set("X-Shopify-Retry-Invalid-Session-Request", "1");
    return res.status(401).json({
      error: "invalid session token",
      details: e?.message || String(e),
    });
  }
};