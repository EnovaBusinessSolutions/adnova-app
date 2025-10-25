'use strict';

module.exports = function ensureAuthenticated(req, res, next) {
  // Passport/session
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  // Si ya hay usuario inyectado por algún middleware/token
  if (req.user) return next();

  const wantsJSON =
    req.xhr ||
    (req.headers.accept || '').includes('application/json') ||
    req.path.startsWith('/api/');

  if (wantsJSON) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  return res.redirect('/login');
};
