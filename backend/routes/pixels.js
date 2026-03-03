// backend/routes/pixels.js
"use strict";

const express = require("express");
const router = express.Router();

const PixelSelection = require("../models/PixelSelection");

const safeStr = (v) => String(v || "").trim();

function getUid(req) {
  return req.user?._id || null;
}

// POST /api/pixels/select
router.post("/select", async (req, res) => {
  try {
    const uid = getUid(req);
    if (!uid) return res.status(401).json({ ok: false, error: "NO_SESSION" });

    const body = req.body || {};
    const provider = safeStr(body.provider);
    const selectedId = safeStr(body.selectedId || body.id || body.resourceName);
    const selectedName = safeStr(body.selectedName || body.name);

    if (!provider || !["meta", "google_ads"].includes(provider)) {
      return res.status(400).json({ ok: false, error: "INVALID_PROVIDER" });
    }
    if (!selectedId) {
      return res.status(400).json({ ok: false, error: "MISSING_SELECTED_ID" });
    }

    const meta = body.meta && typeof body.meta === "object" ? body.meta : {};

    // ✅ MAX_SELECT=1: upsert por userId + provider
    const doc = await PixelSelection.findOneAndUpdate(
      { userId: uid, provider },
      {
        $set: {
          userId: uid,
          user: uid, // compat
          provider,
          selectedId,
          selectedName,
          meta: {
            adAccountId: safeStr(meta.adAccountId),
            customerId: safeStr(meta.customerId),
            source: safeStr(meta.source),
          },
          updatedAt: new Date(),
        },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true, new: true }
    );

    return res.json({ ok: true, data: doc?.toPublic ? doc.toPublic() : doc });
  } catch (e) {
    console.error("[pixels/select] error:", e?.message || e);
    return res.status(500).json({ ok: false, error: "PIXEL_SELECT_FAILED" });
  }
});

// GET /api/pixels/status
router.get("/status", async (req, res) => {
  try {
    const uid = getUid(req);
    if (!uid) return res.status(401).json({ ok: false, error: "NO_SESSION" });

    const docs = await PixelSelection.find({ userId: uid }).lean();
    const meta = docs.find((d) => d.provider === "meta") || null;
    const gads = docs.find((d) => d.provider === "google_ads") || null;

    return res.json({
      ok: true,
      data: {
        meta: meta
          ? {
              provider: "meta",
              selectedId: meta.selectedId,
              selectedName: meta.selectedName || null,
              confirmedAt: meta.confirmedAt || null,
              meta: meta.meta || {},
            }
          : null,
        google_ads: gads
          ? {
              provider: "google_ads",
              selectedId: gads.selectedId, // resourceName
              selectedName: gads.selectedName || null,
              confirmedAt: gads.confirmedAt || null,
              meta: gads.meta || {},
            }
          : null,
      },
    });
  } catch (e) {
    console.error("[pixels/status] error:", e?.message || e);
    return res.status(500).json({ ok: false, error: "PIXELS_STATUS_FAILED" });
  }
});

// (Opcional) POST /api/pixels/confirm  -> para Continue
router.post("/confirm", async (req, res) => {
  try {
    const uid = getUid(req);
    if (!uid) return res.status(401).json({ ok: false, error: "NO_SESSION" });

    const provider = safeStr(req.body?.provider || "");
    if (!provider || !["meta", "google_ads"].includes(provider)) {
      return res.status(400).json({ ok: false, error: "INVALID_PROVIDER" });
    }

    const doc = await PixelSelection.findOneAndUpdate(
      { userId: uid, provider },
      { $set: { confirmedAt: new Date(), updatedAt: new Date() } },
      { new: true }
    );

    return res.json({ ok: true, data: doc ? (doc.toPublic ? doc.toPublic() : doc) : null });
  } catch (e) {
    console.error("[pixels/confirm] error:", e?.message || e);
    return res.status(500).json({ ok: false, error: "PIXELS_CONFIRM_FAILED" });
  }
});

module.exports = router;