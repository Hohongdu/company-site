require('dotenv').config();

const { sendInquiryReplyEmail } = require('../services/notification.service');

async function main() {
	const result = await sendInquiryReplyEmail({
		to: process.env.TEST_EMAIL_TO || 'test@example.com',
		subject: '[테스트] n8n 웹훅 이메일',
		html: '<p>n8n webhook test</p>',
	});

	console.log('[webhook-test-result]', result);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
