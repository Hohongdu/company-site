const test = require('node:test');
const assert = require('node:assert/strict');
const { execSync } = require('node:child_process');

test('웹훅 env 생성 스크립트가 IP 기준 값을 출력한다', () => {
	const out = execSync('bash scripts/generate-webhook-env.sh --ip 192.168.0.120', { encoding: 'utf8' });
	assert.match(out, /WEBHOOK_URL=http:\/\/192\.168\.0\.120:5678\//);
	assert.match(out, /EMAIL_WEBHOOK_URL=http:\/\/192\.168\.0\.120:5678\/webhook\/company-site-email/);
	assert.match(out, /EMAIL_WEBHOOK_TOKEN=[0-9a-f]{64}/);
});
