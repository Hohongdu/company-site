const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('n8n compose 파일에 version 키가 없다', () => {
	const yml = fs.readFileSync('deploy/n8n/docker-compose.yml', 'utf8');
	assert.doesNotMatch(yml, /^version:/m);
	assert.match(yml, /services:/);
});

test('n8n bootstrap 스크립트가 .env 생성 동작을 포함한다', () => {
	const sh = fs.readFileSync('deploy/n8n/bootstrap.sh', 'utf8');
	assert.match(sh, /cp \.env\.example \.env/);
	assert.match(sh, /mkdir -p data/);
});
