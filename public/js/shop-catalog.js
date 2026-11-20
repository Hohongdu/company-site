(() => {
  const lookup = document.querySelector('[data-order-lookup]');
  if (lookup) {
    const methods = lookup.querySelector('.shop-lookup-method');
    const fields = lookup.querySelectorAll('[data-order-contact]');
    const updateContactField = () => {
      const method = lookup.elements.confirmationMethod.value;
      for (const field of fields) {
        const active = field.dataset.orderContact === method;
        const input = field.querySelector('input');
        field.hidden = !active;
        input.disabled = !active;
        input.required = active;
      }
    };
    methods.hidden = false;
    methods.addEventListener('change', updateContactField);
    updateContactField();
  }

  for (const form of document.querySelectorAll('[data-catalog-cart]')) {
    const button = form.querySelector('button[type="submit"]');
    const feedback = form.parentElement.querySelector('[role="status"]');
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (button.disabled) return;
      button.disabled = true;
      feedback.textContent = '';
      try {
        const response = await fetch(form.action, {
          method: 'POST',
          headers: { Accept: 'application/json' },
          body: new URLSearchParams(new FormData(form)),
        });
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.message || '장바구니에 담지 못했습니다.');
        const badge = document.querySelector('.shop-cart-badge');
        if (badge) badge.textContent = result.cartCount || '';
        feedback.textContent = '장바구니에 담았습니다.';
      } catch (error) {
        feedback.textContent = error instanceof SyntaxError ? '장바구니에 담지 못했습니다.' : error.message;
      } finally {
        button.disabled = false;
      }
    });
  }

  const bulkForm = document.getElementById('bulk-order-form');
  if (bulkForm) {
    const button = bulkForm.querySelector('button[type="submit"]');
    const feedback = bulkForm.querySelector('[role="status"]');
    bulkForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (button.disabled) return;
      button.disabled = true;
      feedback.textContent = '처리 중입니다.';
      try {
        const response = await fetch('/shop/cart/bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': bulkForm.dataset.csrf },
          body: JSON.stringify({ skuList: bulkForm.elements.skuList.value }),
        });
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.message || '상품을 담지 못했습니다.');
        const missing = (result.results || []).filter((item) => item.status === 'not_found').map((item) => item.code);
        const added = result.addedCount || 0;
        if (added > 0) {
          feedback.textContent = added + '개 품목을 장바구니에 담았습니다.';
          if (missing.length) feedback.textContent += ' 찾을 수 없는 코드: ' + missing.join(', ');
          setTimeout(() => location.reload(), missing.length ? 3500 : 1200);
          return;
        }
        feedback.textContent = missing.length ? '찾을 수 없는 코드: ' + missing.join(', ') : '제품코드와 수량을 확인해주세요.';
      } catch (error) {
        feedback.textContent = error instanceof SyntaxError ? '상품을 담지 못했습니다.' : error.message;
      }
      button.disabled = false;
    });
  }
})();
