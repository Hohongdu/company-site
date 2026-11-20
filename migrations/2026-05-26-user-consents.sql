-- 회원가입 동의 기록 컬럼 추가
-- 개인정보 보호법 제15조 (구분 동의) 분쟁 대비 증거 보존 목적
-- 약관/개인정보처리방침은 필수, 마케팅은 선택

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS terms_agreed_at         DATETIME NULL COMMENT '이용약관 동의 시각',
  ADD COLUMN IF NOT EXISTS privacy_agreed_at       DATETIME NULL COMMENT '개인정보처리방침 동의 시각',
  ADD COLUMN IF NOT EXISTS marketing_agreed_at     DATETIME NULL COMMENT '마케팅 수신 동의 시각 (선택)',
  ADD COLUMN IF NOT EXISTS consent_ip              VARCHAR(64) NULL COMMENT '동의 당시 IP (분쟁 증거)',
  ADD COLUMN IF NOT EXISTS consent_user_agent      VARCHAR(255) NULL COMMENT '동의 당시 User-Agent';
