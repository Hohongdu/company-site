const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const ejs = require('ejs');

function renderShopPage(template, locals) {
  return ejs.renderFile(path.join(__dirname, '../views/shop', template + '.ejs'), {
    user: null,
    company: { name: 'ENERMADE' },
    cartCount: 0,
    csrfToken: 'test-token',
    ...locals,
  });
}

test('비회원 주문 상세는 주문 상품을 표시하고 주문 조회로 연결된다', async () => {
  const html = await renderShopPage('order-detail', {
    currentPath: '/shop/orders/guest',
    isGuestLookup: true,
    order: { order_number: 'ORD-TEST', status: 'PENDING', total_amount: 1000, created_at: '2026-01-01' },
    items: [{ product_id: 1, product_name: '세라믹 링', unit_price: 1000, quantity: 1, total_price: 1000 }],
    payment: { status: 'PENDING' },
  });

  assert.match(html, /<h1[^>]*>주문 상세<\/h1>/);
  assert.match(html, /세라믹 링/);
  assert.ok(/<a href="\/shop\/orders\/guest"[^>]*>(?:(?!<\/a>)[\s\S])*다른 주문 조회\s*<\/a>/.test(html),
    '주문 상세의 다른 주문 조회 링크가 비회원 주문 조회로 연결되어야 합니다.');
  assert.doesNotMatch(html, /href="\/shop\/orders\/ORD-TEST\/payment"/);
});

test('장바구니에는 대량 담기 창과 제출 폼이 하나씩만 렌더링된다', async () => {
  const html = await renderShopPage('cart', { currentPath: '/shop/cart', cartError: null, items: [] });

  assert.equal((html.match(/id="bulkOrderSheet"/g) || []).length, 1);
  assert.equal((html.match(/id="bulk-order-form"/g) || []).length, 1);
  assert.equal((html.match(/id="bulkSubmitBtn"/g) || []).length, 1);
});

test('결제 상세에서 해당 주문 상세로 돌아갈 수 있다', async () => {
  const html = await renderShopPage('payment-detail', {
    currentPath: '/shop/orders/ORD-TEST/payment',
    order: { order_number: 'ORD-TEST', total_amount: 1000 },
    payment: { provider: 'BANK', amount: 1000 },
  });

  assert.match(html, /<a href="\/shop\/orders\/ORD-TEST"[^>]*>주문 상세<\/a>/);
});
