const test = require('node:test');
const assert = require('node:assert/strict');

const notificationService = require('../services/notification.service');

test('문의 답변 이메일 전송 요청은 비활성화 상태를 반환한다', async () => {
	const result = await notificationService.sendInquiryReplyEmail({
		to: 'user@example.com',
		subject: 'test',
		html: '<p>hello</p>',
	});

	assert.equal(result.status, 'DISABLED');
	assert.equal(result.provider, 'NONE');
	assert.match(result.error || '', /비활성화/);
});

test('임시 비밀번호 이메일 전송 요청도 비활성화 상태를 반환한다', async () => {
	const result = await notificationService.sendTemporaryPasswordEmail({
		to: 'user@example.com',
		userName: '홍길동',
		temporaryPassword: 'Temp1234',
	});

	assert.equal(result.status, 'DISABLED');
	assert.equal(result.provider, 'NONE');
});
