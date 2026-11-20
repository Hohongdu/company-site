const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

const baseUrl = process.env.ORCHESTRA_BASE_URL || 'http://127.0.0.1:3000';
const reportOnly = process.argv.includes('--report-only');
const translations = {
  en: {
    홈: 'Home', '회사 소개': 'About Us', 연혁: 'Company History', '사업 영역': 'Business Areas',
    '연구 개발': 'Research and Development', 공지사항: 'Announcements', 제품몰: 'Store',
    로그인: 'Sign in', '견적 문의': 'Request a Quote', 장바구니: 'Shopping Cart',
    '제품몰 홈': 'Store Home', '전체 상품': 'All Products', '주문 조회': 'Track Orders',
    '회사 사이트': 'Company Website', 검색: 'Search',
    '산업용 세라믹 제품몰': 'Industrial Ceramic Store',
  },
  ja: {
    홈: 'ホーム', '회사 소개': '会社概要', 연혁: '沿革', '사업 영역': '事業分野',
    '연구 개발': '研究開発', 공지사항: 'お知らせ', 제품몰: '製品ストア', 로그인: 'ログイン',
    '견적 문의': '見積もり依頼', 장바구니: 'ショッピングカート', '제품몰 홈': 'ストアホーム',
    '전체 상품': 'すべての商品', '주문 조회': '注文照会', '회사 사이트': '会社ウェブサイト', 검색: '検索',
    '산업용 세라믹 제품몰': '産業用セラミック製品ストア',
  },
  'zh-CN': {
    홈: '首页', '회사 소개': '公司介绍', 연혁: '发展历程', '사업 영역': '业务领域',
    '연구 개발': '研究开发', 공지사항: '公告', 제품몰: '产品商城', 로그인: '登录',
    '견적 문의': '询价', 장바구니: '购物车', '제품몰 홈': '商城首页', '전체 상품': '全部商品',
    '주문 조회': '订单查询', '회사 사이트': '公司网站', 검색: '搜索',
  },
};

async function readLayout(page, selectors) {
  return page.evaluate(({ header, controls }) => {
    function rect(selector) {
      const element = document.querySelector(selector);
      if (!element || !element.getClientRects().length) return null;
      const { x, y, width, height } = element.getBoundingClientRect();
      return [x, y, width, height].map(value => Math.round(value * 10) / 10);
    }
    const root = document.documentElement;
    return {
      scrollX, scrollY, pageWidth: root.scrollWidth, viewportWidth: root.clientWidth,
      header: rect(header), controls: controls.map(rect),
    };
  }, selectors);
}

const company = {
  route: '/', header: '.site-nav',
  controls: ['.site-nav__brand', '.site-nav__menu', '.site-nav__actions', '.site-nav__language .lang-toggle', '.site-nav__hamburger'],
};
const shop = {
  route: '/shop', header: '.shop-header',
  controls: ['.shop-brand', '.shop-header__search', '.shop-header__nav', '.shop-header__tools', '.shop-language .lang-toggle'],
};

async function verifyPage(browser, site, viewport) {
  const page = await browser.newPage({ viewport, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let holdEnglish;
  try {
    await page.route('**/api/translate', route => {
      const { text, target } = route.request().postDataJSON();
      if (holdEnglish && target === 'en' && text === '산업용 세라믹 제품몰') {
        return holdEnglish(route);
      }
      return route.fulfill({ json: { ok: true, translatedText: translations[target]?.[text] || text } });
    });
    assert.equal((await page.goto(baseUrl + site.route)).status(), 200);
    await page.evaluate(async (top) => {
      await document.fonts.ready;
      window.scrollTo({ top, behavior: 'instant' });
    }, site === shop && viewport.height <= 320 ? 0 : 400);
    const language = page.locator('.lang-toggle');
    const menu = page.getByRole('listbox', { name: '언어' });
    const initial = await readLayout(page, site);
    const states = {};
    await language.click();
    await menu.waitFor();
    states.opened = await readLayout(page, site);
    await page.keyboard.press('End');
    assert.ok(await menu.getByRole('option').last().evaluate(element => element === document.activeElement));
    assert.ok(await menu.evaluate(element => element.scrollHeight <= element.clientHeight || element.scrollTop > 0));
    states.end = await readLayout(page, site);
    await page.keyboard.press('Escape');
    assert.ok(await language.evaluate(element => element === document.activeElement));
    assert.equal(await language.getAttribute('aria-expanded'), 'false');
    states.closed = await readLayout(page, site);

    for (const [code, label] of [['en', 'English'], ['ja', '日本語'], ['zh-CN', '中文(简体)'], ['ko', '한국어']]) {
      await language.click();
      await menu.getByRole('option', { name: label, exact: true }).click();
      await page.waitForFunction(lang => window.__I18N_LOGS.some(entry => entry.message === 'apply done' && entry.payload.lang === lang), code);
      assert.equal(await page.locator('html').getAttribute('lang'), code);
      states[code] = await readLayout(page, site);
    }

    const changes = Object.entries(states).filter(([state, layout]) => {
      // Translated body text may reflow. Opening and navigating the picker must not move the page.
      const compareScroll = ['opened', 'end', 'closed'].includes(state);
      const geometry = result => ({
        ...result,
        scrollY: compareScroll ? result.scrollY : undefined,
      });
      return JSON.stringify(geometry(initial)) !== JSON.stringify(geometry(layout));
    });
    if (changes.length || errors.length) {
      console.log(JSON.stringify({ route: site.route, viewport, initial, changes, errors }));
    }
    if (!reportOnly) {
      assert.deepEqual(changes, [], `${site.route} at ${viewport.width}×${viewport.height} shifted`);
      assert.ok(initial.pageWidth <= initial.viewportWidth, 'Page has horizontal overflow');
      assert.deepEqual(errors, []);
    }
    await verifyNearbyMenu(page, site, viewport, initial);
    if (!reportOnly && site === shop && viewport.width === 390) {
      await page.goto(baseUrl + site.route);
      await page.evaluate(() => localStorage.removeItem('site_i18n_cache_v1'));
      const pendingEnglish = new Promise(resolve => {
        holdEnglish = (route) => {
          let release;
          const completion = new Promise(done => { release = done; }).then(() =>
            route.fulfill({ json: { ok: true, translatedText: translations.en['산업용 세라믹 제품몰'] } }).catch(() => {}),
          );
          resolve({ release, completion });
          return completion;
        };
      });
      await language.click();
      await Promise.all([
        page.waitForRequest(request => request.url().endsWith('/api/translate')
          && request.postDataJSON()?.target === 'en'
          && request.postDataJSON()?.text === '산업용 세라믹 제품몰'),
        menu.getByRole('option', { name: 'English', exact: true }).click(),
      ]);
      const english = await pendingEnglish;
      await language.click();
      await menu.getByRole('option', { name: '日本語', exact: true }).click();
      await page.getByRole('heading', { name: translations.ja['산업용 세라믹 제품몰'] }).waitFor();
      english.release();
      await english.completion;
      await page.waitForFunction(() => window.__I18N_LOGS.some(entry => entry.message === 'apply done' && entry.payload.lang === 'ja'));
      assert.equal(await page.locator('h1').innerText(), translations.ja['산업용 세라믹 제품몰']);
    }
    console.log(`${site.route} ${viewport.width}×${viewport.height}: ${changes.length ? changes.map(([state]) => state).join(', ') : 'stable'}`);
  } finally {
    await page.close();
  }
}

async function verifyNearbyMenu(page, site, viewport, initial) {
  if (site === company) {
    if (viewport.width <= 991) {
      const hamburger = page.locator('#navHamburger');
      await hamburger.click();
      assert.equal(await hamburger.getAttribute('aria-expanded'), 'true');
      assert.deepEqual((await readLayout(page, site)).header, initial.header);
      await page.keyboard.press('Escape');
      assert.equal(await hamburger.getAttribute('aria-expanded'), 'false');
    } else {
      const button = page.locator('.site-nav__drop-toggle');
      await button.focus();
      await page.keyboard.press('Enter');
      assert.ok(await page.locator('#businessNavMenu').isVisible());
      assert.deepEqual((await readLayout(page, site)).header, initial.header);
      await page.keyboard.press('Escape');
      assert.ok(!await page.locator('#businessNavMenu').isVisible());
      await page.locator('.site-nav__login').click();
      assert.ok(await page.locator('#loginOverlay').isVisible());
      assert.deepEqual((await readLayout(page, site)).header, initial.header);
      await page.keyboard.press('Escape');
      assert.ok(!await page.locator('#loginOverlay').isVisible());
    }
  } else if (viewport.width <= 799 && viewport.height >= 400) {
    await page.goto(baseUrl + '/shop/products');
    const filter = page.locator('.shop-catalog__mobile-filter');
    const before = (await readLayout(page, site)).header;
    await filter.locator('summary').press('Enter');
    assert.equal(await filter.getAttribute('open'), '');
    assert.ok(await filter.getByRole('link', { name: '전체 상품', exact: true }).isVisible());
    assert.deepEqual((await readLayout(page, site)).header, before);
    if (viewport.width === 390) {
      await page.setViewportSize({ width: 390, height: 500 });
      await page.goto(baseUrl + '/shop/cart');
      const trigger = page.locator('[data-sheet-open="bulkOrderSheet"]');
      await trigger.scrollIntoViewIfNeeded();
      const beforeSheet = await readLayout(page, site);
      await trigger.click();
      const sheet = page.locator('#bulkOrderSheet');
      await sheet.waitFor();
      assert.deepEqual((await readLayout(page, site)).header, beforeSheet.header);
      assert.equal(await page.locator('html').evaluate(element => getComputedStyle(element).overflowY), 'hidden');
      await sheet.locator('.app-sheet__close').click();
      await sheet.waitFor({ state: 'hidden' });
      assert.deepEqual((await readLayout(page, site)).header, beforeSheet.header);
    }
  }
}

(async () => {
  const executablePath = process.env.ORCHESTRA_BROWSER_PATH;
  const browser = await chromium.launch(executablePath ? { executablePath } : { channel: 'chrome' });
  try {
    for (const [width, height] of [[1440, 900], [1024, 768], [800, 600], [799, 600], [390, 844], [320, 568], [320, 160]]) {
      for (const site of [company, shop]) {
        await verifyPage(browser, site, { width, height });
      }
    }
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
