const crypto = require('crypto');

const DEFAULT_IGNORE = ['GET', 'HEAD', 'OPTIONS'];

module.exports = (options = {}) => {
	const ignoreMethods = options.ignoreMethods || DEFAULT_IGNORE;

	return (req, res, next) => {
		if (!req.session) {
			const err = new Error('Session is required for CSRF protection');
			err.code = 'EBADCSRFTOKEN';
			return next(err);
		}

		if (!req.session.csrfToken) {
			req.session.csrfToken = crypto.randomBytes(16).toString('hex');
		}

		req.csrfToken = () => req.session.csrfToken;

		if (ignoreMethods.includes(req.method)) {
			return next();
		}

		const token =
			(req.body && req.body._csrf) ||
			req.headers['x-csrf-token'] ||
			(req.query && req.query._csrf);

		// [M-1] 타이밍 안전 비교: 단순 !== 비교는 타이밍 오라클 공격에 취약
		// crypto.timingSafeEqual은 항상 동일 시간에 비교하여 토큰 추측 방지
		let tokenValid = false;
		try {
			const tokenBuf = Buffer.from(String(token));
			const expectedBuf = Buffer.from(req.session.csrfToken);
			tokenValid = tokenBuf.length === expectedBuf.length &&
				crypto.timingSafeEqual(tokenBuf, expectedBuf);
		} catch (_) {
			tokenValid = false;
		}
		if (!tokenValid) {
			const err = new Error('Invalid CSRF token');
			err.code = 'EBADCSRFTOKEN';
			return next(err);
		}

		return next();
	};
};
