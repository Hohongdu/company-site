const test = require('node:test');
const assert = require('node:assert/strict');

const notificationService = require('../services/notification.service');

test('EMAIL_WEBHOOK_URL 미설정이면 SKIPPED와 안내 메시지를 반환한다', async () => {
	const prevUrl = process.env.EMAIL_WEBHOOK_URL;
	delete process.env.EMAIL_WEBHOOK_URL;

	const result = await notificationService.sendInquiryReplyEmail({
		to: 'user@example.com',
		subject: 'test',
		html: '<p>hello</p>',
	});

	assert.equal(result.status, 'SKIPPED');
	assert.match(result.message || '', /건너뜁니다/);
	assert.equal(result.error, null);

	if (prevUrl) process.env.EMAIL_WEBHOOK_URL = prevUrl;
});
