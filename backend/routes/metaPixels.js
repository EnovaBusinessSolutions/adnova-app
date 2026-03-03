// backend/routes/metaPixels.js
"use strict";

const express = require("express");
const router = express.Router();

let MetaAccount;
try {
  MetaAccount = require("../models/MetaAccount");
} catch (_) {
  MetaAccount = null;
}

// Helpers
const safeStr = (v) => String(v || "").trim();
const normActId = (s) => safeStr(s).replace(/^act_/, "").replace(/[^\d]/g, "");

function getMetaToken(doc) {
  if (!doc) return "";
  // varios esquemas posibles
  return (
    safeStr(doc.longLivedToken) ||
    safeStr(doc.longlivedToken) ||
    safeStr(doc.accessToken) ||
    safeStr(doc.access_token) ||
    safeStr(doc.token)
  );
}

function getSelectedAdAccountId(doc) {
  if (!doc) return "";
  const sel =
    Array.isArray(doc.selectedAccountIds) && doc.selectedAccountIds.length
      ? doc.selectedAccountIds[0]
      : "";
  const def = safeStr(doc.defaultAccountId);

  const raw = safeStr(sel) || def;
  const digits = normActId(raw);
  return digits ? `act_${digits}` : "";
}

async function graphGET(path, accessToken) {
  const base = "https://graph.facebook.com/v19.0";
  const url =
    base +
    path +
    (path.includes("?") ? "&" : "?") +
    "access_token=" +
    encodeURIComponent(accessToken);

  const r = await fetch(url);
  const txt = await r.text();
  let json = {};
  try {
    json = txt ? JSON.parse(txt) : {};
  } catch {
    json = { raw: txt };
  }
  if (!r.ok) {
    const msg =
      json?.error?.message ||
      (typeof txt === "string" && txt.slice(0, 200)) ||
      `HTTP ${r.status}`;
    const err = new Error(msg);
    err.status = r.status;
    err.meta = json;
    throw err;
  }
  return json;
}

// GET /api/meta/pixels
router.get("/pixels", async (req, res) => {
  try {
    const uid = req.user?._id;
    if (!uid) return res.status(401).json({ ok: false, error: "NO_SESSION" });

    if (!MetaAccount) {
      return res.json({ ok: true, data: [], recommendedId: null, reason: "NO_META_MODEL" });
    }

    const doc = await MetaAccount.findOne({ $or: [{ user: uid }, { userId: uid }] }).lean();
    const token = getMetaToken(doc);
    if (!token) {
      return res.json({ ok: true, data: [], recommendedId: null, reason: "META_NOT_CONNECTED" });
    }

    const actId = getSelectedAdAccountId(doc);
    if (!actId) {
      return res.json({
        ok: true,
        data: [],
        recommendedId: null,
        reason: "NO_AD_ACCOUNT_SELECTED",
      });
    }

    // Pixels del ad account seleccionado
    const out = await graphGET(`/${actId}/adspixels?fields=id,name`, token);
    const pixelsRaw = Array.isArray(out?.data) ? out.data : [];

    const data = pixelsRaw
      .map((p) => ({
        id: safeStr(p?.id),
        name: safeStr(p?.name) || safeStr(p?.id),
        hint: actId,
      }))
      .filter((p) => !!p.id);

    // Recommended: prioriza “conversiones” por nombre (heurística simple)
    const re = /(purchase|compra|checkout|order|pedido|conversion)/i;
    let recommendedId = null;
    const conv = data.find((p) => re.test(p.name));
    if (conv) recommendedId = conv.id;
    else if (data.length === 1) recommendedId = data[0].id;

    return res.json({
      ok: true,
      data,
      recommendedId,
      meta: { adAccountId: actId },
    });
  } catch (e) {
    console.error("[meta/pixels] error:", e?.message || e);
    return res.status(500).json({
      ok: false,
      error: "META_PIXELS_FAILED",
      message: String(e?.message || "Error listando pixeles"),
    });
  }
});

module.exports = router;