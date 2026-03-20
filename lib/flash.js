// lib/flash.js
module.exports = function flashMiddleware(req, res, next) {
  // Read flash from session, expose to locals, clear session flash
  const flash = req.session._flash || {};
  req.session._flash = {};
  res.locals.flash = flash; // { success: '...', error: '...', info: '...' }

  // Helper to set flash before redirect
  req.flash = (type, message) => {
    req.session._flash = req.session._flash || {};
    req.session._flash[type] = message;
  };

  // Also absorb query-param style (backward compat)
  if (!flash.success && req.query.notice) res.locals.flash.success = decodeURIComponent(req.query.notice);
  if (!flash.error && req.query.error) res.locals.flash.error = decodeURIComponent(req.query.error);
  if (!flash.success && req.query.message) res.locals.flash.success = decodeURIComponent(req.query.message);

  next();
};
