-- 회원가입 동의 기록 컬럼 추가
-- 개인정보 보호법 제15조 (구분 동의) 분쟁 대비 증거 보존 목적
-- 약관/개인정보처리방침은 필수, 마케팅은 선택

SET @missing_consent_columns = (
  SELECT CONCAT_WS(', ',
    IF(MAX(COLUMN_NAME = 'terms_agreed_at'), NULL,
       'ADD COLUMN terms_agreed_at DATETIME NULL COMMENT ''이용약관 동의 시각'''),
    IF(MAX(COLUMN_NAME = 'privacy_agreed_at'), NULL,
       'ADD COLUMN privacy_agreed_at DATETIME NULL COMMENT ''개인정보처리방침 동의 시각'''),
    IF(MAX(COLUMN_NAME = 'marketing_agreed_at'), NULL,
       'ADD COLUMN marketing_agreed_at DATETIME NULL COMMENT ''마케팅 수신 동의 시각 (선택)'''),
    IF(MAX(COLUMN_NAME = 'consent_ip'), NULL,
       'ADD COLUMN consent_ip VARCHAR(64) NULL COMMENT ''동의 당시 IP (분쟁 증거)'''),
    IF(MAX(COLUMN_NAME = 'consent_user_agent'), NULL,
       'ADD COLUMN consent_user_agent VARCHAR(255) NULL COMMENT ''동의 당시 User-Agent''')
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
);

SET @consent_migration_sql = IF(
  @missing_consent_columns = '',
  'SELECT 1',
  CONCAT('ALTER TABLE users ', @missing_consent_columns)
);
PREPARE consent_migration FROM @consent_migration_sql;
EXECUTE consent_migration;
DEALLOCATE PREPARE consent_migration;
