const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const path = require('path');

const notificationService = require('../services/notification.service');

test('이메일 설정이 없으면 로컬 아웃박스에 저장되고 SKIPPED를 반환한다', async () => {
	const prevUrl = process.env.EMAIL_WEBHOOK_URL;
	const prevSendmail = process.env.EMAIL_SENDMAIL_BIN;
	const prevOutbox = process.env.EMAIL_OUTBOX_DIR;

	delete process.env.EMAIL_WEBHOOK_URL;
	delete process.env.EMAIL_SENDMAIL_BIN;
	process.env.EMAIL_OUTBOX_DIR = path.join(__dirname, '..', 'tmp', 'mail-outbox-test');

	await fs.rm(process.env.EMAIL_OUTBOX_DIR, { recursive: true, force: true });

	const result = await notificationService.sendInquiryReplyEmail({
		to: 'user@example.com',
		subject: 'test',
		html: '<p>hello</p>',
	});

	assert.equal(result.status, 'SKIPPED');
	assert.match(result.message || '', /로컬 아웃박스/);
	assert.equal(result.provider, 'LOCAL_OUTBOX');

	const files = await fs.readdir(process.env.EMAIL_OUTBOX_DIR);
	assert.equal(files.length, 1);

	if (prevUrl) process.env.EMAIL_WEBHOOK_URL = prevUrl;
	if (prevSendmail) process.env.EMAIL_SENDMAIL_BIN = prevSendmail;
	if (prevOutbox) process.env.EMAIL_OUTBOX_DIR = prevOutbox;
	else delete process.env.EMAIL_OUTBOX_DIR;
});
