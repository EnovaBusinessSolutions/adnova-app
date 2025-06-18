// backend/routes/secure.js
const express = require('express');
const router = express.Router();
const verifySessionToken = require('../../middlewares/verifySessionToken');

router.use(verifySessionToken);

router.get('/ping', (req, res) => {
  return res.json({
    ok: true,
    shop: req.shopFromToken,  
    user: req.userId           
  });
});

module.exports = router;
