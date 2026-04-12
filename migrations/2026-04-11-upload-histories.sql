-- 엑셀 업로드 히스토리 테이블 (IF NOT EXISTS로 멱등 처리)
CREATE TABLE IF NOT EXISTS upload_histories (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  original_name VARCHAR(255),
  stored_name VARCHAR(255),
  status ENUM('PROCESSING','SUCCESS','FAILED') NOT NULL DEFAULT 'PROCESSING',
  success_count INT NOT NULL DEFAULT 0,
  fail_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 업로드 실패 행 상세 테이블
CREATE TABLE IF NOT EXISTS upload_history_rows (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  upload_id BIGINT NOT NULL,
  `row_number` INT NOT NULL,
  code VARCHAR(100),
  name VARCHAR(255),
  category_name VARCHAR(100),
  price DECIMAL(15,2),
  spec TEXT,
  image VARCHAR(500),
  description TEXT,
  reason TEXT,
  FOREIGN KEY (upload_id) REFERENCES upload_histories(id) ON DELETE CASCADE
);
