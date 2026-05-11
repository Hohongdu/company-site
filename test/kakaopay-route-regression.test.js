const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const shopSource = fs.readFileSync(path.join(__dirname, '..', 'routes', 'shop.js'), 'utf8');

test('app.js no longer registers legacy app-level Kakao payment callbacks', () => {
	assert.doesNotMatch(appSource, /app\.post\('\/payments\/ready'/);
	assert.doesNotMatch(appSource, /app\.get\('\/payments\/kakao\/(?:success|cancel|fail)'/);
});

test('shop routes remain the canonical Kakao payment callback endpoints', () => {
	assert.match(shopSource, /router\.post\('\/checkout\/kakao'/);
	assert.match(shopSource, /router\.get\('\/checkout\/kakao\/approve'/);
	assert.match(shopSource, /router\.get\('\/checkout\/kakao\/cancel'/);
	assert.match(shopSource, /router\.get\('\/checkout\/kakao\/fail'/);
});
