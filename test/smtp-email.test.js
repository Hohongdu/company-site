const test = require('node:test');
const assert = require('node:assert/strict');
const nodemailer = require('nodemailer');

test('SMTP는 HTML 본문에서 텍스트를 만들고 지정된 텍스트는 그대로 사용한다', async (t) => {
	const previousUser = process.env.SMTP_USER;
	const previousPassword = process.env.SMTP_PASS;
	process.env.SMTP_USER = 'sender@example.test';
	process.env.SMTP_PASS = 'test-password';
	t.after(() => {
		if (previousUser === undefined) delete process.env.SMTP_USER;
		else process.env.SMTP_USER = previousUser;
		if (previousPassword === undefined) delete process.env.SMTP_PASS;
		else process.env.SMTP_PASS = previousPassword;
	});

	const transport = { sendMail: t.mock.fn(async () => ({ messageId: 'test-message' })) };
	t.mock.method(nodemailer, 'createTransport', () => transport);
	const { sendMail } = require('../services/smtp-email.service');
	const options = {
		to: 'recipient@example.test',
		subject: '주문 안내',
		html: '<p>주문이 접수되었습니다.</p>\n<strong>접수번호</strong> <> 4 < 5',
	};

	assert.equal((await sendMail(options)).ok, true);
	assert.equal(transport.sendMail.mock.calls[0].arguments[0].text, '주문이 접수되었습니다.\n접수번호 <> 4 < 5');

	assert.equal((await sendMail({ ...options, text: '지정된 텍스트' })).ok, true);
	assert.equal(transport.sendMail.mock.calls[1].arguments[0].text, '지정된 텍스트');
});
