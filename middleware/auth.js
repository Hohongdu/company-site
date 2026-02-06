// middleware/auth.js
function requireLogin(req, res, next) {
	if (!req.session.user) {
		const redirect = encodeURIComponent(req.originalUrl || '/');
		return res.redirect(`/auth/login?redirect=${redirect}`);
	}
	next();
}

function requireAdmin(req, res, next) {
	if (!req.session.user) {
		const redirect = encodeURIComponent(req.originalUrl || '/');
		return res.redirect(`/auth/login?redirect=${redirect}`);
	}
	if (Number(req.session.user.is_admin) !== 1) {
		return res.status(403).render('403', { message: '관리자만 접근 가능합니다.' });
	}
	next();
}

module.exports = { requireLogin, requireAdmin };
