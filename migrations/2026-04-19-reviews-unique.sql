-- 2026-04-19: product_reviews 사용자별 중복 리뷰 방지
-- 동일 상품에 동일 회원이 리뷰를 여러 번 등록할 수 없도록 UNIQUE 제약 추가
-- ON DUPLICATE KEY 에러로 앱 레벨 코드 버그가 있어도 DB가 최종 방어

-- 기존 중복 행 제거 (id가 큰 것을 삭제 — 가장 오래된 리뷰 유지)
DELETE r1 FROM product_reviews r1
INNER JOIN product_reviews r2
  ON r1.product_id = r2.product_id
 AND r1.user_id    = r2.user_id
 AND r1.id > r2.id;

-- UNIQUE 인덱스 추가
ALTER TABLE product_reviews
  ADD UNIQUE KEY uq_review_user_product (product_id, user_id);
