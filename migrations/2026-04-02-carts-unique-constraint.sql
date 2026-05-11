-- 2026-04-02: carts.user_id UNIQUE 제약 추가
-- lib/cart.js의 ON DUPLICATE KEY UPDATE가 정상 동작하려면 UNIQUE 제약이 필요.
-- 제약이 없으면 동시 요청 시 중복 cart 행이 생성되어 장바구니 항목이 분산될 수 있음.
--
-- 실행 전: 중복된 user_id가 있으면 아래 정리 쿼리를 먼저 실행하세요.
--
-- -- 중복 확인
-- SELECT user_id, COUNT(*) FROM carts GROUP BY user_id HAVING COUNT(*) > 1;
--
-- -- 중복 정리 (최신 cart 유지, 나머지 삭제)
-- DELETE c1 FROM carts c1
--   INNER JOIN carts c2
--   WHERE c1.user_id = c2.user_id AND c1.id < c2.id;

ALTER TABLE carts ADD UNIQUE KEY uq_carts_user_id (user_id);
