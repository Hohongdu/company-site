const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function read(file) {
	return fs.readFileSync(file, 'utf8');
}

test('shop 상품 목록/상세 템플릿에 자동 번역 마커가 포함된다', () => {
	const products = read('views/shop/products.ejs');
	const detail = read('views/shop/product-detail.ejs');

	assert.match(products, /data-i18n-auto/);
	assert.match(detail, /data-i18n-auto/);
});

test('admin/company/shop 레이아웃에서 main.js가 로드된다', () => {
	assert.match(read('views/layouts/company-bottom.ejs'), /\/js\/main\.js/);
	assert.match(read('views/layouts/shop-bottom.ejs'), /\/js\/main\.js/);
	assert.match(read('views/layouts/admin-bottom.ejs'), /\/js\/main\.js/);
});
