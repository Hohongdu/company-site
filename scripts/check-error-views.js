const fs = require('fs');
const path = require('path');
const assert = require('assert');

const viewPath = path.join(__dirname, '..', 'views', '403.ejs');
const contents = fs.readFileSync(viewPath, 'utf8');

assert.ok(contents.includes('403'), '403 view should include status code text.');
assert.ok(contents.includes('접근 권한'), '403 view should include a permission message.');

const appPath = path.join(__dirname, '..', 'app.js');
const appContents = fs.readFileSync(appPath, 'utf8');

assert.ok(appContents.includes("render('403'"), 'app.js should render the 403 view on CSRF errors.');

const authPath = path.join(__dirname, '..', 'middleware', 'auth.js');
const authContents = fs.readFileSync(authPath, 'utf8');

assert.ok(authContents.includes("render('403'"), 'auth middleware should render the 403 view on admin access denial.');

console.log('✅ 403 error view and handlers are in place.');
