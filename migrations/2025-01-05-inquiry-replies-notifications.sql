ALTER TABLE inquiries
  ADD COLUMN answer_content TEXT NULL AFTER content,
  ADD COLUMN answered_at DATETIME NULL AFTER answer_content,
  ADD COLUMN notification_channel ENUM('EMAIL', 'NONE') NOT NULL DEFAULT 'NONE' AFTER answered_at,
  ADD COLUMN notification_status ENUM('PENDING', 'SENT', 'FAILED', 'SKIPPED') NULL AFTER notification_channel,
  ADD COLUMN notification_error VARCHAR(255) NULL AFTER notification_status;
