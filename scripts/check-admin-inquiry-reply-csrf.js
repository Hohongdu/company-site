const fs = require('fs');
const path = require('path');
const assert = require('assert');

const filePath = path.join(__dirname, '..', 'views', 'admin', 'inquiries.ejs');
const contents = fs.readFileSync(filePath, 'utf8');

const hasCsrfInput = /name="_csrf"/.test(contents);

assert.ok(
	hasCsrfInput,
	'admin inquiries reply form should include a CSRF hidden input named "_csrf".',
);

console.log('✅ CSRF hidden input exists in admin inquiries reply form.');
