const crypto = require('crypto');

function createCsrf(options = {}) {
	const ignoreMethods = options.ignoreMethods || ['GET', 'HEAD', 'OPTIONS'];

	return (req, res, next) => {
		if (!req.session) {
			const err = new Error('세션이 설정되지 않았습니다.');
			err.code = 'EBADCSRFTOKEN';
			return next(err);
		}

		if (!req.session.csrfToken) {
			req.session.csrfToken = crypto.randomBytes(24).toString('hex');
		}

		req.csrfToken = () => req.session.csrfToken;

		if (ignoreMethods.includes(req.method)) {
			return next();
		}

		const token =
			(req.body && req.body._csrf) ||
			req.headers['x-csrf-token'] ||
			req.headers['x-csrf-token'.toLowerCase()];

		if (!token || token !== req.session.csrfToken) {
			const err = new Error('CSRF 토큰이 유효하지 않습니다.');
			err.code = 'EBADCSRFTOKEN';
			return next(err);
		}

		return next();
	};
}

module.exports = createCsrf;
