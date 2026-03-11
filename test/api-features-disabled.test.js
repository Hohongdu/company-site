const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const apiIndex = fs.readFileSync('routes/api/index.js', 'utf8');

test('API 라우터에서 AI 기능 라우팅을 제거했다', () => {
	assert.doesNotMatch(apiIndex, /router\.use\('\/ai'/);
});

test('API 라우터에서 이메일 전송용 파일 전송 라우팅을 제거했다', () => {
	assert.doesNotMatch(apiIndex, /router\.use\('\/file-transfer'/);
});
