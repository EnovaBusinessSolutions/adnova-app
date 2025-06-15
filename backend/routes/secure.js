// backend/routes/secure.js
const router = require('express').Router();
router.get('/ping', (req, res) => res.json({ok:true}));
module.exports = router;
