const fs = require('fs');
const path = require('path');
const assert = require('assert');

const viewsDir = path.join(__dirname, '..', 'views', 'company');
['history.ejs', 'notices.ejs', 'notice-detail.ejs', 'account.ejs'].forEach((file) => {
	const contents = fs.readFileSync(path.join(viewsDir, file), 'utf8');
	assert.ok(contents.length > 0, `${file} should not be empty.`);
});

const routesPath = path.join(__dirname, '..', 'routes', 'company.js');
const routesContents = fs.readFileSync(routesPath, 'utf8');

assert.ok(routesContents.includes("router.get('/history'"), 'History route missing.');
assert.ok(routesContents.includes("router.get('/notices'"), 'Notices route missing.');
assert.ok(routesContents.includes("router.get('/notices/:id'"), 'Notice detail route missing.');
assert.ok(routesContents.includes("router.get('/account'"), 'Account route missing.');

console.log('✅ Company pages and routes look present.');
