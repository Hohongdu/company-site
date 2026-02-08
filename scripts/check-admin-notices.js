const fs = require('fs');
const path = require('path');
const assert = require('assert');

const viewPath = path.join(__dirname, '..', 'views', 'admin', 'notices.ejs');
const contents = fs.readFileSync(viewPath, 'utf8');

assert.ok(contents.includes('공지'), 'Admin notices view should include notice text.');

const routesPath = path.join(__dirname, '..', 'routes', 'admin.js');
const routesContents = fs.readFileSync(routesPath, 'utf8');

assert.ok(routesContents.includes("router.get('/notices'"), 'Admin notices list route missing.');
assert.ok(routesContents.includes("router.post('/notices'"), 'Admin notices create route missing.');

console.log('✅ Admin notices view and routes look present.');
