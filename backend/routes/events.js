"use strict";

const express = require("express");
const router = express.Router();
const { trackEvent } = require("../services/trackEvent");

// Reutiliza tu auth real. Si ya tienes middleware, úsalo.
function requireAuth(req, res, next) {
  if (!req.user?._id) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
  next();
}

router.post("/events", requireAuth, async (req, res) => {
  const userId = req.user._id;
  const { name, props, dedupeKey } = req.body || {};

  await trackEvent({
    name,
    userId,
    props,
    dedupeKey,
  });

  res.json({ ok: true });
});

module.exports = router;
