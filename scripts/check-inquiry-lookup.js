const fs = require('fs');
const path = require('path');
const assert = require('assert');

const viewPath = path.join(__dirname, '..', 'views', 'shop', 'inquiry-lookup.ejs');
const contents = fs.readFileSync(viewPath, 'utf8');

assert.ok(contents.includes('비회원 문의 조회'), 'Inquiry lookup view should include title.');

const routesPath = path.join(__dirname, '..', 'routes', 'shop.js');
const routesContents = fs.readFileSync(routesPath, 'utf8');

assert.ok(routesContents.includes("router.get('/inquiries/guest'"), 'Inquiry lookup GET route missing.');
assert.ok(routesContents.includes("router.post('/inquiries/guest'"), 'Inquiry lookup POST route missing.');

console.log('✅ Inquiry lookup page and routes look present.');
