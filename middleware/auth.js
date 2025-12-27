// middleware/auth.js
function requireLogin(req, res, next) {
	if (!req.session.user) return res.redirect('/auth/login');
	next();
}

function requireAdmin(req, res, next) {
	if (!req.session.user) return res.redirect('/auth/login');
	if (Number(req.session.user.is_admin) !== 1) return res.status(403).send('관리자만 접근 가능합니다.');
	next();
}

module.exports = { requireLogin, requireAdmin };
