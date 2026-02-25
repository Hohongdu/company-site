const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('라즈베리파이 n8n 설치 문서가 존재한다', () => {
	const md = fs.readFileSync('docs/raspberrypi-n8n-install.md', 'utf8');
	assert.match(md, /Docker 설치/);
	assert.match(md, /docker compose up -d/);
	assert.match(md, /EMAIL_WEBHOOK_URL/);
});

test('n8n docker compose 템플릿이 존재한다', () => {
	const yml = fs.readFileSync('deploy/n8n/docker-compose.yml', 'utf8');
	assert.match(yml, /n8nio\/n8n:latest/);
	assert.match(yml, /\.\/data:\/home\/node\/.n8n/);
});
