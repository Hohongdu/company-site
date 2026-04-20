const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function read(file) {
	return fs.readFileSync(file, 'utf8');
}

test('문의 페이지는 문의 전용 필드만 포함한다', () => {
	const contact = read('views/company/contact.ejs');
	assert.match(contact, /name="name"/);
	assert.match(contact, /name="email"/);
	assert.match(contact, /name="message"/);
	assert.doesNotMatch(contact, /senderEmail/);
	assert.doesNotMatch(contact, /recipientEmail/);
	assert.doesNotMatch(contact, /name="file"/);
});

test('관리자 문의 답변 폼은 첨부 없이 이메일 발송 선택을 지원한다', () => {
	const adminInquiries = read('views/admin/inquiries.ejs');
	assert.doesNotMatch(adminInquiries, /multipart\/form-data/);
	assert.doesNotMatch(adminInquiries, /name="attachmentFile"/);
	assert.match(adminInquiries, /name="sendEmail"/);
	assert.match(adminInquiries, /답변 내용을 이메일로 발송/);
	assert.match(adminInquiries, /이메일 주소가 없어 발송 불가/);
});
