const express = require('express');
const db = require('../../db');
const router = express.Router();
const dbHealthTimeoutMs = 3000;

// 외부 모니터링용 헬스체크 — UptimeRobot 등에서 5분 간격 폴링 권장
// DB ping 실패 시 ok:false + 503 으로 응답해 다운으로 감지되도록 함
router.get('/health', async (req, res) => {
	const memory = process.memoryUsage();
	let dbStatus = 'ok';
	let dbError = null;
	let timeout;

	try {
		const deadline = new Promise((_, reject) => {
			timeout = setTimeout(() => {
				reject(Object.assign(new Error('Database health check timed out'), { code: 'DB_HEALTH_TIMEOUT' }));
			}, dbHealthTimeoutMs);
		});
		await Promise.race([db.query({ sql: 'SELECT 1', timeout: dbHealthTimeoutMs }), deadline]);
	} catch (err) {
		dbStatus = 'fail';
		dbError = err.code || 'unknown';
	} finally {
		clearTimeout(timeout);
	}

	const healthy = dbStatus === 'ok';
	res.status(healthy ? 200 : 503).json({
		ok: healthy,
		ts: Date.now(),
		uptime: Number(process.uptime().toFixed(1)),
		memory: {
			rss: memory.rss,
			heapUsed: memory.heapUsed,
		},
		db: dbStatus,
		...(dbError ? { dbError } : {}),
	});
});

router.use('/inquiry', require('./inquiry.api'));
router.use('/translate', require('./translation.api'));

module.exports = router;
