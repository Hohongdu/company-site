const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const workflow = JSON.parse(fs.readFileSync('workflows/n8n-email-webhook.json', 'utf8'));

test('n8n 템플릿에 필수 노드가 포함된다', () => {
	const nodeNames = workflow.nodes.map((n) => n.name);
	assert.ok(nodeNames.includes('Webhook'));
	assert.ok(nodeNames.includes('If Auth OK'));
	assert.ok(nodeNames.includes('Send Gmail'));
	assert.ok(nodeNames.includes('Respond OK'));
});

test('n8n 템플릿 웹훅 경로가 정의된다', () => {
	const webhookNode = workflow.nodes.find((n) => n.name === 'Webhook');
	assert.equal(webhookNode.parameters.path, 'company-site-email');
	assert.equal(webhookNode.parameters.httpMethod, 'POST');
});
