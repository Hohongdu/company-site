// middleware/auth.js
// 경로가 /api/ 로 시작하는지 판별 (API 요청은 JSON 응답, 그 외는 리다이렉트)
function isApiRequest(req) {
	return req.path.startsWith('/api') || (req.headers.accept || '').includes('application/json');
}

function requireLogin(req, res, next) {
	if (!req.session.user) {
		if (isApiRequest(req)) {
			return res.status(401).json({ ok: false, error: '로그인이 필요합니다.' });
		}
		const redirect = encodeURIComponent(req.originalUrl || '/');
		return res.redirect(`/auth/login?redirect=${redirect}`);
	}
	next();
}

function requireAdmin(req, res, next) {
	if (!req.session.user) {
		if (isApiRequest(req)) {
			return res.status(401).json({ ok: false, error: '로그인이 필요합니다.' });
		}
		const redirect = encodeURIComponent(req.originalUrl || '/');
		return res.redirect(`/auth/login?redirect=${redirect}`);
	}
	if (Number(req.session.user.is_admin) !== 1) {
		if (isApiRequest(req)) {
			return res.status(403).json({ ok: false, error: '관리자만 접근 가능합니다.' });
		}
		return res.status(403).render('403', { message: '관리자만 접근 가능합니다.' });
	}
	next();
}

module.exports = { requireLogin, requireAdmin };
