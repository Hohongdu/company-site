const express = require('express');
const os = require('os');
const { exec } = require('child_process');
const db = require('../../db');

const router = express.Router();

/* =========================
   유틸
========================= */
function pct(part, total) {
	if (!total) return 0;
	return Math.round((part / total) * 100);
}

function healthLabel(level) {
	if (level === 'good') return { text: '좋음', badge: 'success' };
	if (level === 'warn') return { text: '주의', badge: 'warning' };
	return { text: '위험', badge: 'danger' };
}

function loadHealth(load1, cpuCores) {
	// 코어 대비 0.7 미만 = good, 0.7~1.0 = warn, 1.0 이상 = bad
	const ratio = cpuCores ? load1 / cpuCores : load1;
	if (ratio < 0.7) return { level: 'good', ratio };
	if (ratio < 1.0) return { level: 'warn', ratio };
	return { level: 'bad', ratio };
}

function diskHealth(usedPct) {
	if (usedPct < 70) return 'good';
	if (usedPct < 85) return 'warn';
	return 'bad';
}

function execAsync(cmd) {
	return new Promise((resolve) => {
		exec(cmd, (err, stdout) => {
			if (err) return resolve('');
			resolve(String(stdout || '').trim());
		});
	});
}

/* =========================
   관리자 메인 → 대시보드
========================= */
router.get('/', (req, res) => res.redirect('/admin/dashboard'));

router.get('/dashboard', async (req, res) => {
	try {
		const [[productCnt]] = await db.execute('SELECT COUNT(*) AS cnt FROM products');
		const [[categoryCnt]] = await db.execute('SELECT COUNT(*) AS cnt FROM categories');
		const [[orderCnt]] = await db.execute('SELECT COUNT(*) AS cnt FROM orders');
		const [[inquiryCnt]] = await db.execute('SELECT COUNT(*) AS cnt FROM inquiries');

		let recentOrders = [];
		try {
			[recentOrders] = await db.execute(
				`SELECT o.id,
                COALESCE(o.order_number, CONCAT('ORD-', o.id)) AS order_number,
                o.status, o.total_amount, o.created_at,
                u.name AS user_name, o.guest_name
               FROM orders o
               LEFT JOIN users u ON u.id = o.user_id
               ORDER BY o.created_at DESC
               LIMIT 5`,
			);
		} catch (_) {}

		let recentInquiries = [];
		try {
			[recentInquiries] = await db.execute(
				`SELECT i.title, i.status, i.created_at,
                u.name AS user_name, i.guest_name
               FROM inquiries i
               LEFT JOIN users u ON u.id = i.user_id
               ORDER BY i.created_at DESC
               LIMIT 5`,
			);
		} catch (_) {}

		let monthlyOrders = [];
		try {
			[monthlyOrders] = await db.execute(
				`SELECT DATE_FORMAT(created_at, '%Y-%m') AS ym,
                COUNT(*) AS cnt,
                COALESCE(SUM(total_amount), 0) AS revenue
               FROM orders
               WHERE created_at >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 5 MONTH), '%Y-%m-01')
               GROUP BY ym
               ORDER BY ym ASC`,
			);
		} catch (_) {}

		let monthlyInquiries = [];
		try {
			[monthlyInquiries] = await db.execute(
				`SELECT DATE_FORMAT(created_at, '%Y-%m') AS ym,
                COUNT(*) AS cnt
               FROM inquiries
               WHERE created_at >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 5 MONTH), '%Y-%m-01')
               GROUP BY ym
               ORDER BY ym ASC`,
			);
		} catch (_) {}

		const monthLabels = [];
		const now = new Date();
		for (let i = 5; i >= 0; i -= 1) {
			const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
			const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
			monthLabels.push(ym);
		}

		const orderMap = new Map(monthlyOrders.map((row) => [row.ym, Number(row.cnt || 0)]));
		const revenueMap = new Map(monthlyOrders.map((row) => [row.ym, Number(row.revenue || 0)]));
		const inquiryMap = new Map(monthlyInquiries.map((row) => [row.ym, Number(row.cnt || 0)]));

		const chartData = {
			labels: monthLabels.map((ym) => ym.slice(5).replace('-', '/')),
			orders: monthLabels.map((ym) => orderMap.get(ym) || 0),
			inquiries: monthLabels.map((ym) => inquiryMap.get(ym) || 0),
			revenue: monthLabels.map((ym) => revenueMap.get(ym) || 0),
		};

		// --- 시스템 상태 ---
		const cpuCores = os.cpus().length;
		const load = os.loadavg(); // [1m,5m,15m]
		const totalMem = os.totalmem();
		const freeMem = os.freemem();
		const usedMem = totalMem - freeMem;

		const memUsedPct = pct(usedMem, totalMem);
		const loadInfo = loadHealth(load[0], cpuCores);

		// 플랫폼별(라즈베리파이/리눅스 vs 윈도우) 처리
		let diskTotal = 'N/A';
		let diskUsed = 'N/A';
		let diskAvail = 'N/A';
		let diskUsedPct = 0;

		let nginxHead = 'N/A';
		let vnstatDaily = 'N/A';
		let vnstatMonthly = 'N/A';

		if (process.platform !== 'win32') {
			// 디스크 사용량(루트)
			const dfLine = await execAsync(`df -h / | tail -n 1 | awk '{print $2,$3,$4,$5}'`);
			// 예: "29G 7.5G 20G 28%"
			const [t, u, a, pctRaw] = (dfLine || '').split(/\s+/);
			diskTotal = t || '';
			diskUsed = u || '';
			diskAvail = a || '';
			diskUsedPct = Number(String(pctRaw || '0').replace('%', '')) || 0;

			// nginx 응답 체크 (너가 8080 프록시로 쓰는 전제)
			nginxHead = await execAsync(`curl -I -s http://127.0.0.1:8080/ | head -n 1`);

			// vnstat (있으면)
			vnstatDaily = await execAsync(`vnstat -d 2>/dev/null | tail -n 1`);
			vnstatMonthly = await execAsync(`vnstat -m 2>/dev/null | tail -n 1`);
		}

		// 재고 부족 상품 (stock_quantity가 있는 경우만)
		let lowStockProducts = [];
		try {
			const [lsRows] = await db.execute(
				`SELECT id, name, code, stock_quantity FROM products
         WHERE stock_quantity IS NOT NULL AND stock_quantity <= 5 AND stock_quantity >= 0
         ORDER BY stock_quantity ASC LIMIT 10`,
			);
			lowStockProducts = lsRows;
		} catch (_) {}

		// 미처리 문의 수
		let pendingInquiries = 0;
		try {
			const [[piRow]] = await db.execute(`SELECT COUNT(*) AS cnt FROM inquiries WHERE status = 'NEW'`);
			pendingInquiries = Number(piRow?.cnt || 0);
		} catch (_) {}

		// 이번달 매출
		let thisMonthRevenue = 0;
		try {
			const [[tmr]] = await db.execute(
				`SELECT COALESCE(SUM(total_amount),0) AS rev FROM orders
         WHERE status IN ('PAID','PROCESSING','SHIPPED','DELIVERED')
           AND DATE_FORMAT(created_at,'%Y-%m') = DATE_FORMAT(CURDATE(),'%Y-%m')`,
			);
			thisMonthRevenue = Number(tmr?.rev || 0);
		} catch (_) {}

		res.render('admin/dashboard', {
			stats: {
				totalProducts: productCnt.cnt,
				totalCategories: categoryCnt.cnt,
				totalOrders: orderCnt.cnt,
				totalInquiries: inquiryCnt.cnt,
				pendingInquiries,
				thisMonthRevenue,
			},
			lowStockProducts,
			sys: {
				load1: load[0],
				load5: load[1],
				load15: load[2],
				cpuCores,
				memTotalMB: Math.round(totalMem / 1024 / 1024),
				memUsedMB: Math.round(usedMem / 1024 / 1024),
				memFreeMB: Math.round(freeMem / 1024 / 1024),
				memUsedPct,

				diskTotal,
				diskUsed,
				diskAvail,
				diskUsedPct,

				nginxHead, // "HTTP/1.1 200 OK" or "N/A"
				vnstatDaily,
				vnstatMonthly,

				// 해석(비전공자용)
				cpuStatus: healthLabel(loadInfo.level),
				cpuRatioPct: Math.round(loadInfo.ratio * 100), // 코어 대비 %
				memStatus: healthLabel(memUsedPct < 70 ? 'good' : memUsedPct < 85 ? 'warn' : 'bad'),
				diskStatus: healthLabel(diskHealth(diskUsedPct)),
				nginxStatus: String(nginxHead || '').includes('200') ? healthLabel('good') : healthLabel('warn'),
			},
			recentOrders,
			recentInquiries,
			chartData,
		});
	} catch (err) {
		console.error(err);
		res.status(500).send('대시보드 로딩 오류');
	}
});

module.exports = router;
