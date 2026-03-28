// services/search-log.service.js
// 검색 키워드 로깅 및 통계 서비스
// search_logs 테이블에 키워드/결과수/세션 정보를 기록하고 분석 쿼리를 제공한다.

'use strict';

const crypto = require('crypto');
const db = require('../db');

// ── 테이블 초기화 (모듈 로드 시 1회 실행) ────────────────
let _tableReady = false;
async function ensureTable() {
	if (_tableReady) return;
	await db.execute(`
    CREATE TABLE IF NOT EXISTS search_logs (
      id            BIGINT AUTO_INCREMENT PRIMARY KEY,
      keyword       VARCHAR(200) NOT NULL,
      normalized_kw VARCHAR(200) NOT NULL,
      result_count  INT          NOT NULL DEFAULT 0,
      category_filter VARCHAR(100) DEFAULT NULL,
      user_id       INT          DEFAULT NULL,
      session_hash  VARCHAR(64)  DEFAULT NULL,
      is_logged_in  TINYINT(1)   NOT NULL DEFAULT 0,
      source_path   VARCHAR(255) DEFAULT NULL,
      searched_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_nkw   (normalized_kw),
      INDEX idx_date  (searched_at),
      INDEX idx_hits  (result_count)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
	_tableReady = true;
}

// 모듈 로드 시 바로 테이블 생성 시도
ensureTable().catch((err) => console.error('[search-log] 테이블 초기화 실패:', err));

// ── 정규화 ────────────────────────────────────────────────
// 소문자 변환 + 연속 공백 제거 (영/한 통합 처리)
function normalize(kw) {
	return kw.toLowerCase().replace(/\s+/g, ' ').trim();
}

// ── 세션 해시 ─────────────────────────────────────────────
// 세션 ID 원문 대신 SHA-256 해시를 저장 → PII 최소화
function hashSession(sessionId) {
	if (!sessionId) return null;
	return crypto.createHash('sha256').update(sessionId).digest('hex');
}

// ── 1. 검색 로깅 (non-blocking) ────────────────────────────
/**
 * 검색 키워드를 비동기로 로깅한다. 응답 속도에 영향을 주지 않는다.
 * @param {{ keyword: string, resultCount: number, req: import('express').Request, categoryFilter?: string }} opts
 */
async function logSearch({ keyword, resultCount, req, categoryFilter = null }) {
	if (!keyword || !keyword.trim()) return;

	try {
		await ensureTable();

		const normalized = normalize(keyword);
		const sessionHash = req?.session?.id ? hashSession(req.session.id) : null;
		const userId = req?.session?.user?.id || null;
		const isLoggedIn = userId ? 1 : 0;
		const sourcePath = req?.originalUrl?.slice(0, 255) || null;

		await db.execute(
			`INSERT INTO search_logs
         (keyword, normalized_kw, result_count, category_filter,
          user_id, session_hash, is_logged_in, source_path)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			[keyword.slice(0, 200), normalized.slice(0, 200), resultCount, categoryFilter, userId, sessionHash, isLoggedIn, sourcePath],
		);
	} catch (err) {
		// 로깅 실패는 무시 — 사용자 요청 흐름에 영향 없음
		console.error('[search-log] logSearch 실패:', err.message);
	}
}

// ── 2. 인기 검색어 TOP N ────────────────────────────────────
/**
 * @param {{ days?: number, limit?: number }} opts
 * @returns {Promise<Array<{ keyword: string, search_count: number, avg_results: number }>>}
 */
async function getTopKeywords({ days = 30, limit = 20 } = {}) {
	await ensureTable();
	const [rows] = await db.execute(
		`SELECT normalized_kw AS keyword,
              COUNT(*)             AS search_count,
              AVG(result_count)    AS avg_results
       FROM   search_logs
       WHERE  searched_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
         AND  normalized_kw <> ''
       GROUP  BY normalized_kw
       ORDER  BY search_count DESC, avg_results DESC
       LIMIT  ?`,
		[days, limit],
	);
	return rows;
}

// ── 3. 결과 없는 검색어 (상품 추가 힌트) ─────────────────────
/**
 * @param {{ days?: number, limit?: number }} opts
 * @returns {Promise<Array<{ keyword: string, search_count: number }>>}
 */
async function getNoHitKeywords({ days = 30, limit = 20 } = {}) {
	await ensureTable();
	const [rows] = await db.execute(
		`SELECT normalized_kw AS keyword,
              COUNT(*) AS search_count
       FROM   search_logs
       WHERE  searched_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
         AND  result_count = 0
         AND  normalized_kw <> ''
       GROUP  BY normalized_kw
       ORDER  BY search_count DESC
       LIMIT  ?`,
		[days, limit],
	);
	return rows;
}

// ── 4. 일별 검색량 (차트용) ───────────────────────────────────
/**
 * @param {{ days?: number }} opts
 * @returns {Promise<Array<{ date: string, total: number, no_hit: number }>>}
 */
async function getDailySearchVolume({ days = 30 } = {}) {
	await ensureTable();
	const [rows] = await db.execute(
		`SELECT DATE(searched_at)              AS date,
              COUNT(*)                       AS total,
              SUM(result_count = 0)          AS no_hit
       FROM   search_logs
       WHERE  searched_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
       GROUP  BY DATE(searched_at)
       ORDER  BY date ASC`,
		[days],
	);
	return rows;
}

// ── 5. 요약 통계 (대시보드 KPI) ───────────────────────────────
/**
 * @param {{ days?: number }} opts
 * @returns {Promise<{ total: number, uniqueKeywords: number, noHitRate: number, loginRate: number }>}
 */
async function getSummary({ days = 30 } = {}) {
	await ensureTable();
	const [[row]] = await db.execute(
		`SELECT COUNT(*)                                       AS total,
              COUNT(DISTINCT normalized_kw)                 AS unique_keywords,
              ROUND(SUM(result_count = 0) / COUNT(*) * 100, 1) AS no_hit_rate,
              ROUND(SUM(is_logged_in)    / COUNT(*) * 100, 1) AS login_rate
       FROM  search_logs
       WHERE searched_at >= DATE_SUB(NOW(), INTERVAL ? DAY)`,
		[days],
	);
	return {
		total: Number(row.total || 0),
		uniqueKeywords: Number(row.unique_keywords || 0),
		noHitRate: Number(row.no_hit_rate || 0),
		loginRate: Number(row.login_rate || 0),
	};
}

module.exports = { logSearch, getTopKeywords, getNoHitKeywords, getDailySearchVolume, getSummary };
