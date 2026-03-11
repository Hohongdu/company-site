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

test('관리자 문의 답변 폼은 이메일/첨부 전송 UI 없이 답변 저장만 지원한다', () => {
	const adminInquiries = read('views/admin/inquiries.ejs');
	assert.doesNotMatch(adminInquiries, /multipart\/form-data/);
	assert.doesNotMatch(adminInquiries, /name="attachmentFile"/);
	assert.doesNotMatch(adminInquiries, /name="sendEmail"/);
	assert.match(adminInquiries, /답변 저장만 가능합니다/);
});
