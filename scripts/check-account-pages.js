const fs = require('fs');
const path = require('path');
const assert = require('assert');

const viewsDir = path.join(__dirname, '..', 'views', 'shop');
const files = ['account.ejs', 'account-inquiries.ejs', 'account-orders.ejs'];

files.forEach((file) => {
	const filePath = path.join(viewsDir, file);
	const contents = fs.readFileSync(filePath, 'utf8');
	assert.ok(contents.includes('내 정보') || contents.includes('주문 내역') || contents.includes('문의 내역'));
});

const routesPath = path.join(__dirname, '..', 'routes', 'shop.js');
const routesContents = fs.readFileSync(routesPath, 'utf8');

assert.ok(routesContents.includes("router.get('/account'"), 'Account page route missing.');
assert.ok(routesContents.includes("router.get('/account/inquiries'"), 'Account inquiries route missing.');
assert.ok(routesContents.includes("router.get('/account/orders'"), 'Account orders route missing.');

console.log('✅ Account pages and routes look present.');
