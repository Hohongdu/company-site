/**
 * migrations.js — DB 스키마 보정 함수 모음
 * 중복된 ensure* 함수들을 한 곳에서 관리합니다.
 *
 * M-11 보안 참고:
 * 이 파일의 DDL 쿼리는 모두 하드코딩된 상수 문자열입니다.
 * 외부 입력값을 DDL에 삽입하지 마세요. CREATE TABLE / ALTER TABLE 구문은
 * prepared statement(?바인딩)를 지원하지 않으므로, 동적 값이 필요한 경우
 * 화이트리스트 검증 후 삽입해야 합니다.
 */
const db = require('../db');

// ── 공지 테이블 ───────────────────────────────────────────────────────────────

async function ensureNoticesTable() {
	await db.execute(
		`CREATE TABLE IF NOT EXISTS notices (
      id INT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(200) NOT NULL,
      content TEXT NOT NULL,
      category VARCHAR(30) NOT NULL DEFAULT 'general',
      views INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
	);
}

async function ensureNoticeCategoryColumn() {
	try {
		await db.execute(`ALTER TABLE notices ADD COLUMN category VARCHAR(30) NOT NULL DEFAULT 'general'`);
	} catch (err) {
		if (!String(err?.message || '').includes('Duplicate column')) throw err;
	}
}

// ── 상품 컬럼 ─────────────────────────────────────────────────────────────────

async function ensureProductStockColumn() {
	try {
		await db.execute(`ALTER TABLE products ADD COLUMN stock_quantity INT DEFAULT 0`);
	} catch (err) {
		if (!String(err?.message || '').includes('Duplicate column')) throw err;
	}
}

// admin.js / shop.js 양쪽에서 동일한 로직 — 하나로 통합
async function ensureProductVisibilityColumn() {
	try {
		await db.execute(`ALTER TABLE products ADD COLUMN visibility_status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'`);
	} catch (err) {
		if (!String(err?.message || '').includes('Duplicate column')) throw err;
	}
}

// ── 관리자 활동 로그 ──────────────────────────────────────────────────────────

async function ensureAdminActivityLogTable() {
	await db.execute(
		`CREATE TABLE IF NOT EXISTS admin_activity_logs (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      admin_id BIGINT NULL,
      action VARCHAR(80) NOT NULL,
      metadata JSON NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
	);
}

async function logAdminAction(adminId, action, metadata) {
	try {
		await ensureAdminActivityLogTable();
		await db.execute(`INSERT INTO admin_activity_logs (admin_id, action, metadata) VALUES (?, ?, ?)`, [
			adminId || null,
			action,
			metadata ? JSON.stringify(metadata) : null,
		]);
	} catch (err) {
		console.error('[admin-log]', err);
	}
}

// ── 주문 배송 컬럼 (admin 전용: delivery_status, tracking_number) ────────────

async function ensureOrderDeliveryColumns() {
	try {
		await db.execute(`ALTER TABLE orders ADD COLUMN delivery_status VARCHAR(30) DEFAULT 'READY'`);
	} catch (err) {
		if (!String(err?.message || '').includes('Duplicate column')) throw err;
	}
	try {
		await db.execute(`ALTER TABLE orders ADD COLUMN tracking_number VARCHAR(100)`);
	} catch (err) {
		if (!String(err?.message || '').includes('Duplicate column')) throw err;
	}
}

// ── 주문 배송 컬럼 (shop 전용: shipping_name, shipping_phone, ...) ────────────

async function ensureOrderShippingColumns() {
	const cols = [
		'shipping_name VARCHAR(100)',
		'shipping_phone VARCHAR(30)',
		'shipping_address VARCHAR(500)',
		'discount_amount INT DEFAULT 0',
		'coupon_code VARCHAR(50)',
	];
	for (const col of cols) {
		try {
			await db.execute(`ALTER TABLE orders ADD COLUMN ${col}`);
		} catch (err) {
			if (!String(err?.message || '').includes('Duplicate column')) throw err;
		}
	}
}

// ── 주문 상태 Enum 확장 ───────────────────────────────────────────────────────

async function ensureOrderStatusEnum() {
	try {
		await db.execute(
			`ALTER TABLE orders MODIFY status ENUM('PENDING','PAID','CANCELED','FAILED','CANCEL_REQUESTED') NOT NULL DEFAULT 'PENDING'`,
		);
	} catch (err) {
		const message = String(err?.message || '');
		if (!message.includes('Duplicate') && !message.includes('Data truncated')) {
			throw err;
		}
	}
}

// ── 유저 관련 테이블 ──────────────────────────────────────────────────────────

async function ensureNotificationSettingsTable() {
	await db.execute(
		`CREATE TABLE IF NOT EXISTS user_notification_settings (
      user_id INT PRIMARY KEY,
      email_enabled TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`,
	);
}

async function ensureWishlistTable() {
	await db.execute(
		`CREATE TABLE IF NOT EXISTS user_wishlist (
      user_id INT NOT NULL,
      product_id INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, product_id)
    )`,
	);
}

async function ensureReviewTable() {
	await db.execute(
		`CREATE TABLE IF NOT EXISTS product_reviews (
      id INT AUTO_INCREMENT PRIMARY KEY,
      product_id INT NOT NULL,
      user_id INT NOT NULL,
      rating INT NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
	);
}

async function ensureAddressTable() {
	await db.execute(
		`CREATE TABLE IF NOT EXISTS user_addresses (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      label VARCHAR(80),
      recipient_name VARCHAR(80),
      phone VARCHAR(30),
      address_line1 VARCHAR(255),
      address_line2 VARCHAR(255),
      postal_code VARCHAR(20),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
	);
}

async function ensurePaymentMethodTable() {
	await db.execute(
		`CREATE TABLE IF NOT EXISTS user_payment_methods (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      label VARCHAR(80),
      provider VARCHAR(50),
      last4 VARCHAR(4),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
	);
}

async function ensureCouponTable() {
	await db.execute(
		`CREATE TABLE IF NOT EXISTS user_coupons (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      code VARCHAR(50) NOT NULL,
      description VARCHAR(255),
      discount_pct INT DEFAULT 0,
      expires_at DATE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
	);
}

module.exports = {
	ensureNoticesTable,
	ensureNoticeCategoryColumn,
	ensureProductStockColumn,
	ensureProductVisibilityColumn,
	ensureAdminActivityLogTable,
	logAdminAction,
	ensureOrderDeliveryColumns,
	ensureOrderShippingColumns,
	ensureOrderStatusEnum,
	ensureNotificationSettingsTable,
	ensureWishlistTable,
	ensureReviewTable,
	ensureAddressTable,
	ensurePaymentMethodTable,
	ensureCouponTable,
};
