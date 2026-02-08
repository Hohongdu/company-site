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

		if (token !== req.session.csrfToken) {
			const err = new Error('Invalid CSRF token');
			err.code = 'EBADCSRFTOKEN';
			return next(err);
		}

		return next();
	};
};
