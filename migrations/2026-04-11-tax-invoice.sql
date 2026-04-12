-- 세금계산서 발행 요청 테이블
CREATE TABLE IF NOT EXISTS tax_invoice_requests (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  order_id BIGINT NOT NULL,
  order_number VARCHAR(50) NOT NULL,
  business_name VARCHAR(100) NOT NULL,
  business_reg_no VARCHAR(20) NOT NULL,
  rep_name VARCHAR(50) NOT NULL,
  contact_email VARCHAR(100) NOT NULL,
  status ENUM('REQUESTED', 'PROCESSING', 'ISSUED', 'REJECTED') NOT NULL DEFAULT 'REQUESTED',
  admin_note TEXT,
  requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  processed_at TIMESTAMP NULL,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);
