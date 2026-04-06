/**
 * demo-preview.js — 7-Feature standalone 데모 서버 (DB 없음)
 * Feature 1: 글로벌 수출 모드 (언어 스위처 + Papago 번역)
 * Feature 2: 무검색어 회수 엔진 (No-Hit Recovery)
 * Feature 3: 견적 요청 빌더 (RFQ Builder)
 * Feature 4: 납기 예측 뱃지 (Lead-time Badge)
 * Feature 5: 기술자료실 (Technical Data Room)
 * Feature 6: 대량 SKU 업로드 (Bulk SKU Order)
 * Feature 7: 샘플 요청 드로어 (Sample Request Drawer)
 */
const http = require('http');
const path = require('path');
const fs   = require('fs');

const PORT = 3002;

// Demo data
const DEMO_PRODUCTS = [
  { id: 1, name: '알루미나 세라믹 절연체 A40', code: 'INS-A40-001', spec: 'Φ40mm × H80mm, 순도 96%', price: 12000, category_name: '절연부품' },
  { id: 2, name: '지르코니아 노즐 Z12', code: 'NOZ-Z12-003', spec: 'ID 12mm, 내마모 코팅', price: 28500, category_name: '노즐/분사' },
  { id: 3, name: '고온 세라믹 라이너 HT200', code: 'LNR-HT200', spec: '200×150×20mm, 내열 1650℃', price: 54000, category_name: '내화라이너' },
];
const DEMO_NO_HIT_SUGGESTIONS = [
  { keyword: '알루미나' }, { keyword: '절연체' }, { keyword: '노즐' },
  { keyword: '세라믹 튜브' }, { keyword: '방열판' }, { keyword: '지르코니아' },
];

const PRODUCT_DETAIL = DEMO_PRODUCTS[0];

function render(templateFn, req) {
  const csrfToken = 'demo-csrf-token-' + Math.random().toString(36).slice(2);
  return templateFn({ products: DEMO_PRODUCTS, noHitSuggestions: DEMO_NO_HIT_SUGGESTIONS, product: PRODUCT_DETAIL, csrfToken, user: null });
}

// Read CSS files
function getCss() {
  const cssFiles = [
    path.join(__dirname, 'public/css/app-ui.css'),
    path.join(__dirname, 'public/css/main.css'),
  ];
  return cssFiles.map(f => {
    try { return fs.readFileSync(f, 'utf8'); } catch { return ''; }
  }).join('\n');
}

// Read main.js
function getMainJs() {
  try { return fs.readFileSync(path.join(__dirname, 'public/js/main.js'), 'utf8'); } catch { return ''; }
}

const DEMO_HTML = (data) => `<!DOCTYPE html>
<html lang="ko" data-theme="">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>ENERMADE Shop — 3-Feature Preview</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
  <style>
${getCss()}

/* Demo nav */
.demo-nav {
  position:sticky;top:0;z-index:1000;
  background:#1e293b;color:#fff;
  padding:10px 16px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;
  font-size:13px;
}
.demo-nav a {
  color:#94a3b8;text-decoration:none;padding:4px 10px;
  border-radius:6px;transition:background .15s;
}
.demo-nav a:hover, .demo-nav a.active { background:#334155;color:#fff; }
.demo-badge {
  background:#ea580c;color:#fff;font-size:10px;font-weight:700;
  border-radius:4px;padding:2px 6px;margin-left:4px;letter-spacing:.04em;
}
.feature-section {
  border:2px solid var(--c-border,#e5e7eb);border-radius:12px;
  padding:24px;margin:20px 0;
}
.feature-section h3 {
  font-size:15px;font-weight:700;margin-bottom:4px;color:var(--c-text,#111);
}
.feature-section .feature-desc {
  font-size:12px;color:var(--c-muted,#6b7280);margin-bottom:16px;
}
  </style>
</head>
<body>

<!-- Demo Navigation -->
<div class="demo-nav">
  <strong style="color:#f8fafc;font-size:14px;">🏭 ENERMADE</strong>
  <span style="color:#475569;">|</span>
  <a href="#feature1" class="active">🌐 F1 글로벌</a>
  <a href="#feature2">🔍 F2 No-Hit</a>
  <a href="#feature3">📋 F3 견적</a>
  <a href="#feature4">⚡ F4 납기뱃지</a>
  <a href="#feature5">📄 F5 기술자료</a>
  <a href="#feature6">📦 F6 SKU대량</a>
  <a href="#feature7">🧪 F7 샘플</a>
  <span style="margin-left:auto;color:#64748b;font-size:11px;">Test Drive Preview</span>
</div>

<div id="app-main" style="max-width:480px;margin:0 auto;background:var(--c-bg,#fff);min-height:100vh;">

<!-- ═══════════════════════════════════════════
  FEATURE 1: 글로벌 수출 모드 (Language Switcher)
  main.js가 이미 완전 구현 — 언어 버튼이 우측 하단에 뜸
═══════════════════════════════════════════ -->
<div id="feature1" class="app-section--pad" style="padding-top:24px;">
  <div class="feature-section">
    <h3>🌐 Feature 1 — 글로벌 수출 모드 <span class="demo-badge">LIVE</span></h3>
    <p class="feature-desc">
      오른쪽 하단 🌐 버튼 클릭 → 언어 선택 → 페이지 내 <code>data-i18n-auto</code> 요소 자동 번역<br>
      <small>※ Papago API 키 없으면 번역 실패 — UI 동작은 확인 가능</small>
    </p>

    <p style="font-size:12px;color:var(--c-muted);margin-bottom:12px;">아래 카드 텍스트에 <code>data-i18n-auto</code>가 붙어 있어 언어 전환 시 번역됩니다:</p>

    <!-- 상품 카드 3개 (번역 대상 요소 포함) -->
    <div class="app-product-grid">
      ${DEMO_PRODUCTS.map(p => `
      <div class="app-product-card">
        <div class="app-product-card__thumb">
          <div class="app-product-card__placeholder">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
              <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" stroke-width="1.5"/>
            </svg>
          </div>
        </div>
        <div class="app-product-card__body">
          <span class="app-product-card__cat" data-i18n-auto>${p.category_name}</span>
          <div class="app-product-card__name">
            <span data-i18n-auto>${p.name}</span>
          </div>
          <div class="app-product-card__spec" data-i18n-auto>${p.spec}</div>
          <div class="app-product-card__price">${p.price.toLocaleString()}<span>원</span></div>
        </div>
      </div>
      `).join('')}
    </div>
  </div>
</div>

<!-- ═══════════════════════════════════════════
  FEATURE 2: 무검색어 회수 엔진 (No-Hit Recovery)
═══════════════════════════════════════════ -->
<div id="feature2" class="app-section--pad" style="padding-top:8px;">
  <div class="feature-section">
    <h3>🔍 Feature 2 — 무검색어 회수 엔진 <span class="demo-badge">NEW</span></h3>
    <p class="feature-desc">
      검색 결과 0건일 때 빈 화면 대신 인기 검색어 + 문의 CTA 표시.<br>
      <strong>Before:</strong> "다른 키워드를 시도해보세요" 정적 텍스트뿐 → 이탈률 높음<br>
      <strong>After:</strong> 인기 키워드 칩 + 제품 문의 CTA
    </p>

    <!-- No-Hit 화면 — 실제 products.ejs 변경 내용 -->
    <div style="border:1px solid var(--c-border,#e5e7eb);border-radius:10px;padding:16px;background:var(--c-bg,#fff);">
      <p style="font-size:11px;font-weight:600;color:var(--c-muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:.06em;">
        검색: "탄화규소" → 0건 결과 화면
      </p>
      <div class="app-empty">
        <div class="app-empty__icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
            <circle cx="11" cy="11" r="8" stroke="currentColor" stroke-width="1.5"/>
            <path d="M21 21l-4.35-4.35" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </div>
        <p class="app-empty__title" data-i18n-auto>검색 결과가 없어요</p>
        <p class="app-empty__desc">
          "<strong>탄화규소</strong>"에 해당하는 상품을 찾지 못했습니다
        </p>

        <!-- ★ 신규: 인기 검색어 제안 -->
        <div style="margin:20px 0 8px;">
          <p style="font-size:12px;color:var(--c-muted);margin-bottom:10px;" data-i18n-auto>
            💡 다른 고객이 많이 찾은 검색어
          </p>
          <div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center;">
            ${DEMO_NO_HIT_SUGGESTIONS.map(kw => `
            <a class="app-chip" href="/shop/products?q=${encodeURIComponent(kw.keyword)}"
               style="cursor:pointer;">${kw.keyword}</a>
            `).join('')}
          </div>
        </div>

        <div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap;justify-content:center;">
          <a href="#" class="app-btn app-btn--outline app-btn--sm" data-i18n-auto>전체 상품 보기</a>
          <a href="#feature3" class="app-btn app-btn--primary app-btn--sm" data-i18n-auto>제품 문의하기</a>
        </div>
      </div>
    </div>
  </div>
</div>

<!-- ═══════════════════════════════════════════
  FEATURE 3: 견적 요청 빌더 (RFQ Builder)
═══════════════════════════════════════════ -->
<div id="feature3" class="app-section--pad" style="padding-top:8px;">
  <div class="feature-section">
    <h3>📋 Feature 3 — 견적 요청 빌더 <span class="demo-badge">NEW</span></h3>
    <p class="feature-desc">
      상품상세 Sticky CTA에서 <strong>📋 견적 요청</strong> 버튼 클릭 → 슬라이드 드로어 열림.<br>
      수량 / 목표단가 / 희망납기 / 담당자 / 이메일 → POST /shop/inquiries/rfq
    </p>

    <!-- Sticky CTA 미리보기 -->
    <p style="font-size:11px;font-weight:600;color:var(--c-muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:.06em;">
      상품상세 하단 Sticky CTA
    </p>
    <div style="border:1px solid var(--c-border,#e5e7eb);border-radius:10px;padding:12px;">
      <div class="app-bottom-cta__inner" style="position:relative;display:flex;gap:8px;align-items:center;">
        <div class="app-qty">
          <button class="app-qty__btn" type="button">−</button>
          <input class="app-qty__input" type="number" min="1" value="1" style="width:48px;text-align:center;">
          <button class="app-qty__btn" type="button">+</button>
        </div>
        <button class="app-btn app-btn--outline" style="flex:1;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" stroke="currentColor" stroke-width="2"/><line x1="3" y1="6" x2="21" y2="6" stroke="currentColor" stroke-width="2"/><path d="M16 10a4 4 0 01-8 0" stroke="currentColor" stroke-width="2"/></svg>
          담기
        </button>
        <!-- ★ 신규 버튼 -->
        <button class="app-btn app-btn--primary" style="flex:1.6;"
                onclick="document.getElementById('rfqSheet').classList.add('is-open');document.getElementById('rfqOverlay').classList.add('is-open');document.body.style.overflow='hidden'">
          📋 견적 요청
        </button>
      </div>
    </div>
  </div>
</div><!-- /feature3 -->

<!-- ═══════════════════════════════════════════
  FEATURE 4: 납기 예측 뱃지 (Lead-time Badge)
═══════════════════════════════════════════ -->
<div id="feature4" class="app-section--pad" style="padding-top:8px;">
  <div class="feature-section">
    <h3>⚡ Feature 4 — 납기 예측 뱃지 <span class="demo-badge">NEW</span></h3>
    <p class="feature-desc">
      상품 상세 가격 옆에 재고 상태에 따라 자동으로 배지가 표시됩니다.<br>
      <code>stock_quantity > 0</code> → 즉시출고 · <code>= 0</code> → 제작 2주 · <code>null</code> → 납기 협의
    </p>

    <!-- 3가지 상태 미리보기 카드 -->
    <div style="display:flex;flex-direction:column;gap:12px;">

      <!-- 즉시출고 -->
      <div style="border:1px solid var(--c-border,#e5e7eb);border-radius:10px;padding:14px 16px;">
        <div style="font-size:10px;font-weight:700;color:var(--c-muted);letter-spacing:.08em;margin-bottom:8px;text-transform:uppercase;">
          stock_quantity = 5 (재고 있음)
        </div>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          <div class="app-detail-price" style="margin-bottom:0;">12,000<span>원</span></div>
          <span style="background:#dcfce7;color:#15803d;font-size:11px;font-weight:700;padding:3px 8px;border-radius:20px;letter-spacing:.02em;">⚡ 즉시출고</span>
        </div>
        <div style="font-size:11px;color:var(--c-muted);margin-top:6px;">알루미나 세라믹 절연체 A40 · INS-A40-001</div>
      </div>

      <!-- 제작 2주 -->
      <div style="border:1px solid var(--c-border,#e5e7eb);border-radius:10px;padding:14px 16px;">
        <div style="font-size:10px;font-weight:700;color:var(--c-muted);letter-spacing:.08em;margin-bottom:8px;text-transform:uppercase;">
          stock_quantity = 0 (주문 제작)
        </div>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          <div class="app-detail-price" style="margin-bottom:0;">28,500<span>원</span></div>
          <span style="background:#fff7ed;color:#c2410c;font-size:11px;font-weight:700;padding:3px 8px;border-radius:20px;">🏭 제작 2주</span>
        </div>
        <div style="font-size:11px;color:var(--c-muted);margin-top:6px;">지르코니아 노즐 Z12 · NOZ-Z12-003</div>
      </div>

      <!-- 납기 협의 -->
      <div style="border:1px solid var(--c-border,#e5e7eb);border-radius:10px;padding:14px 16px;">
        <div style="font-size:10px;font-weight:700;color:var(--c-muted);letter-spacing:.08em;margin-bottom:8px;text-transform:uppercase;">
          stock_quantity = NULL (협의 필요)
        </div>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          <div class="app-detail-price" style="margin-bottom:0;">54,000<span>원</span></div>
          <span style="background:#f1f5f9;color:#64748b;font-size:11px;font-weight:700;padding:3px 8px;border-radius:20px;">📞 납기 협의</span>
        </div>
        <div style="font-size:11px;color:var(--c-muted);margin-top:6px;">고온 세라믹 라이너 HT200 · LNR-HT200</div>
      </div>

    </div>
    <p style="font-size:11px;color:var(--c-muted);margin-top:12px;padding:8px 12px;background:#f8fafc;border-radius:6px;">
      💡 EJS 템플릿 한 줄 조건으로 동작 — DB schema 변경 없음 (stock_quantity 컬럼 기존 존재)
    </p>
  </div>
</div><!-- /feature4 -->

<!-- ═══════════════════════════════════════════
  FEATURE 5: 기술자료실 (Technical Data Room)
═══════════════════════════════════════════ -->
<div id="feature5" class="app-section--pad" style="padding-top:8px;">
  <div class="feature-section">
    <h3>📄 Feature 5 — 기술자료실 <span class="demo-badge">NEW</span></h3>
    <p class="feature-desc">
      상품 상세에 기술문서 다운로드 섹션 추가. 데이터시트·도면은 로그인 게이트, 인증서는 공개 제공.<br>
      로그인 시 🔒 → 다운로드 버튼으로 변환. <strong>Before:</strong> 스펙만 텍스트 나열 → <strong>After:</strong> 문서 카드 UI
    </p>

    <!-- 미로그인 상태 -->
    <p style="font-size:11px;font-weight:700;color:var(--c-muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:.06em;">
      비로그인 상태
    </p>
    <div style="margin-bottom:16px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
        <span style="font-size:13px;font-weight:700;color:var(--c-text);">📄 기술문서</span>
        <a href="#" style="font-size:11px;color:var(--c-accent);">로그인 후 다운로드</a>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;">
        ${[
          { icon:'📑', label:'데이터시트 (PDF)', size:'1.2 MB', locked:true },
          { icon:'📐', label:'도면 (CAD/DXF)', size:'842 KB', locked:true },
          { icon:'🏅', label:'ISO 9001 인증서', size:'380 KB', locked:false, ext:'PDF' },
        ].map(doc => `
        <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:8px;border:1px solid var(--c-border,#e5e7eb);background:var(--c-bg,#fff);">
          <span style="font-size:18px;flex-shrink:0;">${doc.icon}</span>
          <div style="flex:1;min-width:0;">
            <div style="font-size:12px;font-weight:600;color:var(--c-text);">${doc.label}</div>
            <div style="font-size:11px;color:var(--c-muted);">${doc.size}</div>
          </div>
          ${doc.locked
            ? `<a href="#" style="font-size:11px;padding:4px 10px;border-radius:6px;background:#f1f5f9;color:#64748b;text-decoration:none;">🔒 로그인</a>`
            : `<span style="font-size:10px;font-weight:700;padding:3px 7px;border-radius:4px;background:#dbeafe;color:#1d4ed8;letter-spacing:.04em;">${doc.ext}</span>`
          }
        </div>
        `).join('')}
      </div>
    </div>

    <!-- 로그인 상태 -->
    <p style="font-size:11px;font-weight:700;color:var(--c-muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:.06em;">
      로그인 상태 (잠금 해제)
    </p>
    <div style="display:flex;flex-direction:column;gap:8px;">
      ${[
        { icon:'📑', label:'데이터시트 (PDF)', size:'1.2 MB', ext:'PDF' },
        { icon:'📐', label:'도면 (CAD/DXF)', size:'842 KB', ext:'DXF' },
        { icon:'🏅', label:'ISO 9001 인증서', size:'380 KB', ext:'PDF' },
      ].map(doc => `
      <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:8px;border:1px solid #bbf7d0;background:#f0fdf4;">
        <span style="font-size:18px;flex-shrink:0;">${doc.icon}</span>
        <div style="flex:1;min-width:0;">
          <div style="font-size:12px;font-weight:600;color:var(--c-text);">${doc.label}</div>
          <div style="font-size:11px;color:var(--c-muted);">${doc.size}</div>
        </div>
        <a href="#" onclick="return false" style="font-size:11px;padding:4px 10px;border-radius:6px;background:#16a34a;color:#fff;text-decoration:none;font-weight:600;">
          ↓ ${doc.ext}
        </a>
      </div>
      `).join('')}
    </div>
    <p style="font-size:11px;color:var(--c-muted);margin-top:10px;padding:8px 12px;background:#f8fafc;border-radius:6px;">
      💡 실제 파일은 미구현 (UI/UX 데모) — 로그인 여부는 EJS <code>user</code> 변수로 분기
    </p>
  </div>
</div><!-- /feature5 -->

<!-- ═══════════════════════════════════════════
  FEATURE 6: 대량 SKU 업로드 (Bulk SKU Order)
═══════════════════════════════════════════ -->
<div id="feature6" class="app-section--pad" style="padding-top:8px;">
  <div class="feature-section">
    <h3>📦 Feature 6 — 대량 SKU 업로드 <span class="demo-badge">NEW</span></h3>
    <p class="feature-desc">
      제품코드+수량을 여러 줄 붙여넣기 → 일괄 장바구니 추가. B2B 구매 담당자용.<br>
      구분자: 콤마·탭·2칸 공백 자유 인식 / POST <code>/shop/cart/bulk</code>
    </p>

    <div style="background:var(--c-bg-2,#f8f8f8);border-radius:10px;padding:14px;">
      <label style="font-size:12px;font-weight:600;color:var(--c-text);display:block;margin-bottom:8px;">
        📋 제품코드·수량 붙여넣기
      </label>
      <textarea id="bulkDemoTa" rows="6" style="width:100%;font-family:monospace;font-size:12px;padding:10px;border:1.5px solid var(--c-border,#e5e7eb);border-radius:8px;background:var(--c-bg,#fff);color:var(--c-text);resize:vertical;box-sizing:border-box;"
        placeholder="INS-A40-001  5&#10;NOZ-Z12-003, 20&#10;LNR-HT200	3">INS-A40-001  5
NOZ-Z12-003, 20
LNR-HT200	3</textarea>
      <div style="display:flex;gap:8px;margin-top:10px;">
        <button class="app-btn app-btn--outline app-btn--sm" type="button"
                onclick="parseBulkDemo()" style="flex:1;">
          🔍 파싱 미리보기
        </button>
        <button class="app-btn app-btn--primary app-btn--sm" type="button"
                onclick="submitBulkDemo()" style="flex:2;">
          📦 장바구니에 추가
        </button>
      </div>
    </div>

    <div id="bulkDemoResult" style="margin-top:12px;display:none;"></div>

    <p style="font-size:11px;color:var(--c-muted);margin-top:10px;padding:8px 12px;background:#f8fafc;border-radius:6px;">
      💡 최대 100줄 / 줄당 수량 cap 999 / POST <code>/shop/cart/bulk</code> → JSON 응답
    </p>
  </div>
</div><!-- /feature6 -->

<!-- ═══════════════════════════════════════════
  FEATURE 7: 샘플 요청 드로어 (Sample Request Drawer)
═══════════════════════════════════════════ -->
<div id="feature7" class="app-section--pad" style="padding-top:8px;padding-bottom:120px;">
  <div class="feature-section">
    <h3>🧪 Feature 7 — 샘플 요청 드로어 <span class="demo-badge">NEW</span></h3>
    <p class="feature-desc">
      상품 상세 Sticky CTA에 🧪 샘플 버튼 추가 → 슬라이드 드로어 열림.<br>
      최대 5개 · 적용 용도 필수 입력 · POST <code>/shop/inquiries/sample</code>
    </p>

    <!-- 업데이트된 Sticky CTA 미리보기 -->
    <p style="font-size:11px;font-weight:600;color:var(--c-muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:.06em;">
      상품상세 Sticky CTA — 기존 2버튼 → 3버튼
    </p>
    <div style="border:1px solid var(--c-border,#e5e7eb);border-radius:10px;padding:12px;margin-bottom:16px;">
      <div style="display:flex;gap:8px;align-items:center;">
        <div class="app-qty">
          <button class="app-qty__btn" type="button">−</button>
          <input class="app-qty__input" type="number" min="1" value="1" style="width:44px;text-align:center;">
          <button class="app-qty__btn" type="button">+</button>
        </div>
        <button class="app-btn app-btn--outline app-btn--sm" style="flex:1;">담기</button>
        <button class="app-btn app-btn--outline app-btn--sm" style="flex:1;font-size:11px;"
                onclick="document.getElementById('sampleDemoSheet').classList.add('is-open');document.getElementById('sampleDemoOverlay').classList.add('is-open');document.body.style.overflow='hidden'">
          🧪 샘플
        </button>
        <button class="app-btn app-btn--primary app-btn--sm" style="flex:1.4;font-size:11px;"
                onclick="document.getElementById('rfqSheet').classList.add('is-open');document.getElementById('rfqOverlay').classList.add('is-open');document.body.style.overflow='hidden'">
          📋 견적
        </button>
      </div>
    </div>

    <div style="background:#eff6ff;border-radius:8px;padding:10px 14px;font-size:12px;color:#1e40af;">
      <strong>🧪 샘플 신청 버튼 클릭 →</strong> 하단에서 슬라이드 드로어 올라옵니다
    </div>
  </div>
</div><!-- /feature7 -->

</div><!-- /app-main -->

<!-- Sample Demo Sheet Overlay -->
<div class="app-sheet-overlay" id="sampleDemoOverlay"
     onclick="this.classList.remove('is-open');document.getElementById('sampleDemoSheet').classList.remove('is-open');document.body.style.overflow=''"></div>

<!-- Sample Demo Slide-up Drawer -->
<div class="app-sheet" id="sampleDemoSheet" role="dialog" aria-modal="true">
  <div class="app-sheet__handle"></div>
  <div class="app-sheet__head">
    <h2 class="app-sheet__title">🧪 샘플 요청</h2>
    <button class="app-sheet__close" type="button"
            onclick="document.getElementById('sampleDemoSheet').classList.remove('is-open');document.getElementById('sampleDemoOverlay').classList.remove('is-open');document.body.style.overflow=''">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
        <path d="M6 6l12 12M18 6l-12 12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
      </svg>
    </button>
  </div>
  <div class="app-sheet__body" style="overflow-y:auto;">
    <div style="background:#eff6ff;border-radius:10px;padding:12px 14px;margin-bottom:20px;font-size:12px;color:#1e40af;">
      <strong>📦 샘플 정책</strong><br>
      최대 5개까지 평가용 샘플을 신청할 수 있습니다. 2~3 영업일 내 배송됩니다.
    </div>
    <form id="sampleDemoForm">
      <div class="app-field" style="margin-bottom:14px;">
        <label class="app-field__label">샘플 수량 (최대 5개)</label>
        <div style="display:flex;align-items:center;gap:8px;">
          <div class="app-qty">
            <button class="app-qty__btn" type="button" onclick="var i=document.getElementById('sdQty');i.value=Math.max(1,parseInt(i.value)-1)">−</button>
            <input class="app-qty__input" id="sdQty" name="quantity" type="number" min="1" max="5" value="1" style="width:44px;text-align:center;">
            <button class="app-qty__btn" type="button" onclick="var i=document.getElementById('sdQty');i.value=Math.min(5,parseInt(i.value)+1)">+</button>
          </div>
          <span style="font-size:12px;color:var(--c-muted);">개</span>
        </div>
      </div>
      <div class="app-field" style="margin-bottom:14px;">
        <label class="app-field__label">적용 장비 / 용도 <span style="color:var(--c-accent);">*</span></label>
        <input class="app-field__input" id="sdApp" name="application" type="text" placeholder="예: 고온 소결로 내부 라이너 교체" required>
      </div>
      <div class="app-field" style="margin-bottom:14px;">
        <label class="app-field__label">시험 조건 (선택)</label>
        <input class="app-field__input" name="testCondition" type="text" placeholder="예: 1400℃, H2 분위기">
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px;">
        <div class="app-field">
          <label class="app-field__label">담당자 <span style="color:var(--c-accent);">*</span></label>
          <input class="app-field__input" id="sdName" name="contactName" type="text" placeholder="홍길동" required>
        </div>
        <div class="app-field">
          <label class="app-field__label">이메일 <span style="color:var(--c-accent);">*</span></label>
          <input class="app-field__input" id="sdEmail" name="contactEmail" type="email" placeholder="contact@company.com" required>
        </div>
      </div>
      <div id="sampleDemoAlert" style="display:none;padding:12px;border-radius:8px;margin-bottom:12px;font-size:13px;"></div>
    </form>
  </div>
  <div class="app-sheet__footer">
    <button class="app-btn app-btn--outline" style="flex:1;" type="button"
            onclick="document.getElementById('sampleDemoSheet').classList.remove('is-open');document.getElementById('sampleDemoOverlay').classList.remove('is-open');document.body.style.overflow=''">취소</button>
    <button class="app-btn app-btn--primary" style="flex:2;" type="button"
            onclick="handleSampleDemoSubmit()">샘플 신청</button>
  </div>
</div><!-- /sampleDemoSheet -->

<!-- RFQ Sheet Overlay -->
<div class="app-sheet-overlay" id="rfqOverlay"
     onclick="this.classList.remove('is-open');document.getElementById('rfqSheet').classList.remove('is-open');document.body.style.overflow=''"></div>

<!-- RFQ Slide-up Drawer -->
<div class="app-sheet" id="rfqSheet" role="dialog" aria-modal="true">
  <div class="app-sheet__handle"></div>
  <div class="app-sheet__head">
    <h2 class="app-sheet__title">📋 견적 요청</h2>
    <button class="app-sheet__close" type="button"
            onclick="document.getElementById('rfqSheet').classList.remove('is-open');document.getElementById('rfqOverlay').classList.remove('is-open');document.body.style.overflow=''">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
        <path d="M6 6l12 12M18 6l-12 12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
      </svg>
    </button>
  </div>

  <div class="app-sheet__body" style="overflow-y:auto;">
    <!-- 상품 요약 -->
    <div style="background:var(--c-bg-2,#f8f8f8);border-radius:var(--r-lg,8px);padding:12px 14px;margin-bottom:20px;display:flex;align-items:center;gap:12px;">
      <div style="width:44px;height:44px;background:#e5e7eb;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="2" stroke="#9ca3af" stroke-width="1.5"/></svg>
      </div>
      <div>
        <div style="font-size:13px;font-weight:700;" data-i18n-auto>${PRODUCT_DETAIL.name}</div>
        <div style="font-size:11px;color:var(--c-muted);">CODE: ${PRODUCT_DETAIL.code}</div>
      </div>
    </div>

    <form id="rfqDemoForm" onsubmit="handleRfqSubmit(event)">
      <!-- 수량 -->
      <div class="app-field" style="margin-bottom:14px;">
        <label class="app-field__label" data-i18n-auto>수량</label>
        <div style="display:flex;align-items:center;gap:8px;">
          <div class="app-qty">
            <button class="app-qty__btn" type="button" onclick="var i=document.getElementById('rfqDemoQty');i.value=Math.max(1,parseInt(i.value)-1)">−</button>
            <input class="app-qty__input" id="rfqDemoQty" name="quantity" type="number" min="1" value="1" style="width:52px;text-align:center;">
            <button class="app-qty__btn" type="button" onclick="var i=document.getElementById('rfqDemoQty');i.value=parseInt(i.value)+1">+</button>
          </div>
          <span style="font-size:12px;color:var(--c-muted);" data-i18n-auto>개</span>
        </div>
      </div>

      <!-- 2열: 목표단가 / 희망납기 -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px;">
        <div class="app-field">
          <label class="app-field__label" data-i18n-auto>목표 단가</label>
          <input class="app-field__input" name="targetPrice" type="text" placeholder="예: 5,000원/개">
        </div>
        <div class="app-field">
          <label class="app-field__label" data-i18n-auto>희망 납기</label>
          <input class="app-field__input" name="deliveryDate" type="date">
        </div>
      </div>

      <!-- 회사명 -->
      <div class="app-field" style="margin-bottom:14px;">
        <label class="app-field__label" data-i18n-auto>회사명</label>
        <input class="app-field__input" name="companyName" type="text" placeholder="(주)에너메이드">
      </div>

      <!-- 2열: 담당자 / 이메일 -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px;">
        <div class="app-field">
          <label class="app-field__label" data-i18n-auto>담당자 <span style="color:var(--c-accent);">*</span></label>
          <input class="app-field__input" name="contactName" type="text" placeholder="홍길동" required>
        </div>
        <div class="app-field">
          <label class="app-field__label" data-i18n-auto>이메일 <span style="color:var(--c-accent);">*</span></label>
          <input class="app-field__input" name="contactEmail" type="email" placeholder="contact@company.com" required>
        </div>
      </div>

      <!-- 요청사항 -->
      <div class="app-field" style="margin-bottom:20px;">
        <label class="app-field__label" data-i18n-auto>요청사항</label>
        <textarea class="app-field__input" name="message" rows="3"
                  placeholder="특수 규격, 재질, 수량 할인 조건 등 자유롭게 입력해주세요."></textarea>
      </div>

      <div id="rfqDemoAlert" style="display:none;padding:12px;border-radius:8px;margin-bottom:12px;font-size:13px;"></div>
    </form>
  </div>

  <div class="app-sheet__footer">
    <button class="app-btn app-btn--outline" style="flex:1;" type="button"
            onclick="document.getElementById('rfqSheet').classList.remove('is-open');document.getElementById('rfqOverlay').classList.remove('is-open');document.body.style.overflow=''"
            data-i18n-auto>취소</button>
    <button class="app-btn app-btn--primary" style="flex:2;" type="button"
            onclick="handleRfqSubmit()"
            data-i18n-auto>견적 요청 전송</button>
  </div>
</div><!-- /rfqSheet -->

<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>
<script>window.__SITE_USER_IS_ADMIN = false;</script>
<script>
${getMainJs()}
</script>

<script>
// ── Bulk SKU Demo ──────────────────────────
var DEMO_SKUS = {
  'INS-A40-001': { name:'알루미나 세라믹 절연체 A40', price:12000 },
  'NOZ-Z12-003': { name:'지르코니아 노즐 Z12', price:28500 },
  'LNR-HT200':   { name:'고온 세라믹 라이너 HT200', price:54000 },
};

function parseBulkLines(text) {
  return text.trim().split(/\\n/).slice(0, 100).map(function(line) {
    if (!line.trim()) return null;
    var m = line.trim().match(/^([A-Za-z0-9_-]+)[\\s,\\t]+(\\d+)$/);
    if (!m) return { code: line.trim(), qty: null, error: '파싱 실패' };
    return { code: m[1], qty: Math.min(999, parseInt(m[2])) };
  }).filter(Boolean);
}

function parseBulkDemo() {
  var ta = document.getElementById('bulkDemoTa');
  var result = document.getElementById('bulkDemoResult');
  var lines = parseBulkLines(ta.value);
  if (!lines.length) { result.style.display='none'; return; }

  var html = '<div style="font-size:12px;border:1px solid var(--c-border,#e5e7eb);border-radius:8px;overflow:hidden;">';
  html += '<div style="background:#f8fafc;padding:8px 12px;font-weight:600;color:var(--c-muted);font-size:11px;text-transform:uppercase;letter-spacing:.05em;">파싱 결과 (' + lines.length + '줄)</div>';
  lines.forEach(function(l) {
    var p = DEMO_SKUS[l.code];
    var ok = !l.error && p;
    html += '<div style="padding:10px 12px;border-top:1px solid var(--c-border,#e5e7eb);display:flex;align-items:center;gap:10px;">';
    html += '<span style="font-size:14px;">' + (ok ? '✅' : '❌') + '</span>';
    html += '<div style="flex:1;">';
    html += '<div style="font-weight:600;color:var(--c-text);font-size:12px;">' + l.code + '</div>';
    if (ok) html += '<div style="font-size:11px;color:var(--c-muted);">' + p.name + ' · ' + p.price.toLocaleString() + '원</div>';
    else html += '<div style="font-size:11px;color:#dc2626;">' + (l.error || '코드 없음') + '</div>';
    html += '</div>';
    if (l.qty) html += '<span style="font-size:12px;font-weight:700;color:var(--c-text);">' + l.qty + '개</span>';
    html += '</div>';
  });
  html += '</div>';
  result.innerHTML = html;
  result.style.display = 'block';
}

function submitBulkDemo() {
  var ta = document.getElementById('bulkDemoTa');
  var result = document.getElementById('bulkDemoResult');
  var lines = parseBulkLines(ta.value);
  var validLines = lines.filter(function(l){ return DEMO_SKUS[l.code] && l.qty; });
  var total = validLines.reduce(function(sum, l){ return sum + (DEMO_SKUS[l.code].price * l.qty); }, 0);

  result.innerHTML = '<div style="padding:14px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;font-size:13px;color:#166534;">' +
    '✅ <strong>' + validLines.length + '개 SKU</strong>가 장바구니에 추가되었습니다. ' +
    '소계 <strong>' + total.toLocaleString() + '원</strong><br>' +
    '<small style="color:#4ade80;">(Demo — 실제 서버에서는 DB cart에 저장됩니다)</small></div>';
  result.style.display = 'block';
}

// ── Sample Demo ──────────────────────────
function handleSampleDemoSubmit() {
  var alertEl = document.getElementById('sampleDemoAlert');
  var name  = document.getElementById('sdName').value.trim();
  var email = document.getElementById('sdEmail').value.trim();
  var app   = document.getElementById('sdApp').value.trim();

  if (!name || !email || !app) {
    alertEl.style.display='block';
    alertEl.style.background='#fef2f2';alertEl.style.color='#dc2626';
    alertEl.textContent='⚠️ 담당자명, 이메일, 적용 용도는 필수입니다.';
    return;
  }
  alertEl.style.display='block';
  alertEl.style.background='#f0fdf4';alertEl.style.color='#16a34a';
  alertEl.textContent='✅ 샘플 요청이 접수되었습니다. 2~3 영업일 내 배송 안내 드립니다. (Demo)';

  setTimeout(function() {
    document.getElementById('sampleDemoSheet').classList.remove('is-open');
    document.getElementById('sampleDemoOverlay').classList.remove('is-open');
    document.body.style.overflow='';
    alertEl.style.display='none';
  }, 2500);
}

// ── RFQ Demo ──────────────────────────
function handleRfqSubmit(e) {
  if (e) e.preventDefault();
  var form = document.getElementById('rfqDemoForm');
  var alertEl = document.getElementById('rfqDemoAlert');
  var name = form.contactName.value.trim();
  var email = form.contactEmail.value.trim();

  if (!name || !email) {
    alertEl.style.display = 'block';
    alertEl.style.background = '#fef2f2';
    alertEl.style.color = '#dc2626';
    alertEl.textContent = '⚠️ 담당자명과 이메일은 필수입니다.';
    return;
  }

  alertEl.style.display = 'block';
  alertEl.style.background = '#f0fdf4';
  alertEl.style.color = '#16a34a';
  alertEl.textContent = '✅ 견적 요청이 접수되었습니다. (Demo — 실제 서버에서는 DB에 저장됩니다)';

  setTimeout(function() {
    document.getElementById('rfqSheet').classList.remove('is-open');
    document.getElementById('rfqOverlay').classList.remove('is-open');
    document.body.style.overflow = '';
    alertEl.style.display = 'none';
  }, 2500);
}
</script>

</body>
</html>`;

// Static file serving
const MIME = {
  '.css': 'text/css',
  '.js':  'application/javascript',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const server = http.createServer((req, res) => {
  // Serve static files from /public
  if (req.url.startsWith('/css/') || req.url.startsWith('/js/') || req.url.startsWith('/images/')) {
    const filePath = path.join(__dirname, 'public', req.url);
    const ext = path.extname(filePath);
    try {
      const content = fs.readFileSync(filePath);
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      res.end(content);
    } catch {
      res.writeHead(404); res.end('Not found');
    }
    return;
  }

  // Mock bulk cart endpoint
  if (req.method === 'POST' && req.url === '/shop/cart/bulk') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      console.log('[Bulk Demo] Received:', body.slice(0, 200));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, addedCount: 3, message: '3개 SKU가 장바구니에 추가되었습니다.' }));
    });
    return;
  }

  // Mock sample endpoint
  if (req.method === 'POST' && req.url === '/shop/inquiries/sample') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      console.log('[Sample Demo] Received:', body.slice(0, 200));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, message: '2~3 영업일 내 배송 안내 드립니다.' }));
    });
    return;
  }

  // Mock RFQ endpoint
  if (req.method === 'POST' && req.url === '/shop/inquiries/rfq') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      console.log('[RFQ Demo] Received:', body.slice(0, 200));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, message: '견적 요청이 접수되었습니다. 빠른 시일 내에 연락드리겠습니다.' }));
    });
    return;
  }

  // Mock translate endpoint
  if (req.method === 'POST' && req.url === '/api/translate') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      const data = JSON.parse(body || '{}');
      const mockTranslations = {
        'en': { '절연부품': 'Insulating Parts', '노즐/분사': 'Nozzle/Spray', '내화라이너': 'Refractory Liner',
                '제품코드': 'Product Code', '규격/스펙': 'Spec', '수량': 'Quantity', '개': 'pcs',
                '목표 단가': 'Target Price', '희망 납기': 'Delivery Date', '담당자': 'Contact',
                '이메일': 'Email', '요청사항': 'Request', '취소': 'Cancel', '견적 요청 전송': 'Send RFQ',
                '견적 요청': 'Request Quote', '검색 결과가 없어요': 'No results found',
                '전체 상품 보기': 'View All Products', '제품 문의하기': 'Contact Us',
                '💡 다른 고객이 많이 찾은 검색어': '💡 Popular searches by other customers' },
        'ja': { '절연부품': '絶縁部品', '수량': '数量', '개': '個', '견적 요청': '見積依頼', '취소': 'キャンセル' },
        'zh-CN': { '절연부품': '绝缘零件', '수량': '数量', '개': '个', '견적 요청': '询价', '취소': '取消' },
      };
      const translations = mockTranslations[data.target] || {};
      const translated = translations[data.text] || `[${data.target}] ${data.text}`;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, translatedText: translated, sourceLang: 'ko' }));
    });
    return;
  }

  if (req.url === '/api/translate/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, hasCredentials: true, provider: 'demo-mock', message: 'Demo mock active' }));
    return;
  }

  // Main demo page
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(DEMO_HTML({}));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[DEMO] Preview server running at http://127.0.0.1:${PORT}`);
  console.log('[DEMO] 7-Feature Preview (F1-F7):');
  console.log('  #feature1 - 글로벌 수출 모드 (🌐 언어 스위처)');
  console.log('  #feature2 - 무검색어 회수 엔진 (인기 검색어 제안)');
  console.log('  #feature3 - 견적 요청 빌더 (📋 RFQ 드로어)');
  console.log('  #feature4 - 납기 예측 뱃지 (⚡🏭📞 3가지 상태)');
  console.log('  #feature5 - 기술자료실 (로그인 게이트 문서 카드)');
  console.log('  #feature6 - 대량 SKU 업로드 (Bulk 장바구니)');
  console.log('  #feature7 - 샘플 요청 드로어 (🧪 신청 플로우)');
});
