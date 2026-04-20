# CLAUDE.md

This file provides shared guidance for Claude Code, Codex, and future agents working in this repository.

## Project

- Project name: `company-site`
- Purpose: operate a production-ready company website with company profile, R&D, shop, admin dashboard, multilingual translation, customer support/inquiries, payment, and email features.
- Architecture: this is an **Express + EJS server-rendered app**, not a React SPA.
- Frontend changes must respect EJS templates, shared partials, Bootstrap layout, server routes, sessions, CSRF, and backend-rendered state.

## Commands

```bash
npm run dev     # Development server with auto-reload (nodemon)
npm start       # Production server
npm test        # Run Node.js built-in tests (node --test)
```

## Stack

- Node.js / Express
- EJS server-rendered templates
- Bootstrap-based UI
- MySQL via `mysql2`
- Session authentication
- Custom CSRF helper in `lib/csurf.js`
- Admin dashboard
- Shop/cart/order/payment flows
- Papago/NCP translation
- Email notification services
- Nginx/HTTPS/reverse proxy production environment

## Architecture Overview

`app.js` boots the server on port `3000`. Middleware order matters:

1. `trust proxy` is set for Nginx/reverse proxy deployment.
2. Body parsers and static files.
3. Helmet security headers.
4. `express-session`.
5. Custom CSRF tokens via `lib/csurf.js`.
6. Common locals injected into EJS views: session user, CSRF token, cart count, company info.
7. Route mounts.

Main route files:

| Mount | File | Purpose |
| --- | --- | --- |
| `/` | `routes/company.js` | Homepage, about, history, notices, contact/customer support, business, R&D |
| `/auth` | `routes/auth.js` | Register, login, logout, password recovery |
| `/shop` | `routes/shop.js` | Product listing, detail, cart, account, checkout, orders |
| `/admin` | `routes/admin.js` | Admin dashboard, products, orders, inquiries, notices |
| `/api` | `routes/api/` | API endpoints |

Database:

- MySQL pool exported from `db.js`.
- SQL is mostly inline in route/service files. There is no ORM.
- Migrations live in `migrations/`.
- Important tables include `users`, `products`, `orders`, `order_items`, `order_payments`, `carts`, `cart_items`, `inquiries`, `notices`.

Auth:

- Session auth. After login, `req.session.user` contains `{ id, email, name, is_admin }`.
- `middleware/auth.js` exports `requireLogin` and `requireAdmin`.
- `is_admin === 1` grants admin access.
- Passwords use bcrypt.

Cart:

- Guest cart is stored in `req.session.cart`.
- Logged-in cart is stored in DB via `carts` and `cart_items`.
- Guest cart is merged into DB cart after login.
- Do not break either mode when changing cart/order flows.

## Existing Features That Must Not Be Reintroduced As New

### Kakao Pay

Kakao Pay is already partially implemented.

- `services/kakaopay.service.js`
- `routes/shop.js`
  - `/checkout/kakao`
  - `/checkout/kakao/approve`
  - `/checkout/kakao/cancel`
  - `/checkout/kakao/fail`
- `views/shop/cart.ejs` shows the Kakao Pay button when `paymentEnabled` is true.

Rules:

- Do not propose Kakao Pay as if it does not exist.
- Keep the existing flow intact when adding payment features.
- Production requires `.env` values: `KAKAO_ADMIN_KEY`, `KAKAO_CID`, `BASE_URL`.
- Kakao Developers redirect URLs must match production URLs.
- Payment approval issues may involve session, `pg_token`, `tid`, `BASE_URL`, HTTPS/domain mismatch, secure cookies, or `trust proxy`.
- Current implementation may clear cart after payment success without fully persisting an order in every flow. Verify DB behavior before changing it.

### Papago Translation

Papago translation is already implemented with NCP credentials.

- `services/papago.service.js`
- Uses `PAPAGO_CLIENT_ID` and `PAPAGO_CLIENT_SECRET`.
- Uses the NCP/Papago endpoint.

Rules:

- Do not propose Papago/NCP translation as if it does not exist.
- When changing translation, check buttons, menus, dynamic UI text, admin/user text, and mobile drawer text.
- Watch for malformed `.env` values such as `BASE_URL=+https://...`.
- Verify translated text does not break header/menu layout.

### Planned Features

These have already been discussed or planned:

- Naver Cloud Platform Outbound Mailer based email.
- Product/homepage search keyword data analysis.

Do not repeatedly suggest them as brand-new ideas. If working on them, first inspect existing code and prior discussion traces.

### Dark Mode

Dark mode has been removed.

- Do not treat dark mode as a default test item.
- Do not include old dark mode bugs in current recurring issue lists.
- Do not propose reintroducing dark mode unless explicitly requested.

## High-Priority Recurring Issues

When touching related areas, always handle the full cause -> fix -> verification loop.

### UI / Design

1. Shop account duplicate menu/button
   - On `shop/account` and related pages, hide duplicate navigation to the current page.
   - Check both desktop web and mobile/app-style UI.

2. Inquiry/customer support page design
   - Check list/detail/write/edit pages as a group.
   - Verify spacing, alignment, button placement, card heights, and responsive behavior.
   - Keep customer support wording consistent.

3. Admin product management layout overlap
   - Long product names must not invade other columns.
   - Use Bootstrap table/grid/flex, `overflow-wrap`, `text-break`, `word-break`, and sane widths.
   - Admin screens should prioritize readable dense information over decorative whitespace.

4. Accordion text alignment
   - Text should be vertically centered.
   - Check title, description, and icon baseline alignment together.

5. Mobile/app bottom tab exposure
   - App-only UI must not leak into normal web pages.
   - Check `shop/account` and related pages.

6. Admin dashboard residual UI
   - Remove debug text, placeholder DOM, strange loaders, and footer/layout leftovers.
   - Check shared admin partials if residue appears on multiple pages.

### Functionality

1. Email test button not working
   - Check frontend click handler, server route, email service integration, success/failure response, and user notification.

2. CSRF error when adding products to cart
   - Check forms, fetch/axios calls, partial-rendered buttons, login/session regeneration, and token refresh.

3. Excel upload not reflected
   - Check upload success, parsing, column mapping, validation, DB writes, and admin list reload.

4. Product image upload not reflected
   - Check `multipart/form-data`, multer middleware, storage path/permissions, DB filename, and rendered image path.

5. Cart UX
   - Do not immediately redirect to cart after adding an item.
   - Show a confirmation such as "장바구니로 이동할까요?" with Yes/No.
   - Let the user stay on the current page.

6. Kakao Pay approval says "결제 승인 정보가 없습니다."
   - Check session-stored `pg_token`/`tid`.
   - Check `BASE_URL`, HTTPS/domain, Kakao redirect URLs.
   - Check `express-session`, secure cookie behavior, Nginx reverse proxy, and `trust proxy`.

## Company Content And Menu Rules

Current company menu/content requirements:

- Business areas: 진공 브레이징, 특수 소재, 세라믹, 가공.
- R&D: 자외선 램프.
- Use "고객 지원" instead of "문의" for customer-facing menu labels.

When changing content, search for duplicates across:

- Header
- Sidebar
- Mobile drawer
- Breadcrumbs
- Button labels
- SEO title/description
- Footer
- Admin settings and labels

Header changes must be verified on desktop, tablet, and mobile. Consider multilingual menu length expansion.

## Work Process Rules

Before changing code, inspect:

- Related files
- Shared layouts/partials
- Server routes
- Frontend events
- Common CSS
- DB writes/migrations
- Session/auth/CSRF impact
- Production environment impact

Modification principles:

- Do not patch only the visible symptom if the root cause is shared.
- Follow route -> service -> middleware -> view -> CSS flow where applicable.
- Prefer common styles or common logic for recurring problems.
- Keep page-specific hotfixes small and justified.
- Preserve existing features unless the user explicitly asks to remove them.
- Do not do broad refactors unless required for the requested task.
- Separate user-facing errors from developer logs.
- Always consider admin authorization for admin features.

## Regression Checklist

After every meaningful change, check relevant items from this list.

Common:

- No server errors.
- No obvious browser console errors.
- No failed network requests.
- CSRF/session/auth still works.
- Responsive layout is intact.
- Multilingual switching does not break UI.
- Admin and user pages are not accidentally affected.

Shop:

- Product list.
- Product detail.
- Cart.
- Order/payment.
- Account pages.
- Mobile view.
- Product images.
- Excel upload reflection.
- Product create/edit/delete.

Admin:

- Product table layout.
- Button click behavior.
- Upload features.
- Save/edit/delete reflected in lists.
- No residual footer/debug/layout artifacts.

Customer support:

- List/detail/write/edit pages.
- Design alignment.
- Button alignment.
- Responsive behavior.

Automation/repeated checks:

1. Load the live homepage.
2. Check main/header/footer.
3. Check business/R&D/customer support menus.
4. Check shop list/detail/cart/account/payment.
5. Check admin dashboard, product list, image upload, Excel upload, save/edit/delete.
6. Check inquiry/customer support screens.
7. Check email test button.
8. Check error logs.
9. If a fix is deployed, repeat the same failing path.

## Deployment Notes

- Production domain: `https://enermade.com`.
- The app runs behind Nginx/reverse proxy; keep `trust proxy` and secure session behavior in mind.
- Required production environment includes DB, session secret, file transfer secret, BASE_URL, Kakao, Papago, and email configuration as relevant.
- `deploy_lederberg.py` has been referenced as a Pi SFTP deploy tool for `192.168.1.250`, but it may not be present in this checkout. If it exists, update deploy file lists whenever backend and frontend files change.
- Backend files (`routes`, `services`, `controllers`, `lib`, migrations) and frontend files (`views`, CSS, JS) must be deployed as a coherent set.

## Current Handoff Notes

As of the latest update:

- `origin/master` includes the `funny-lederberg` changes and the cherry-picked payment-detail feature.
- Payment detail feature commit added:
  - `routes/shop.js`
  - `views/shop/order-detail.ejs`
  - `views/shop/payment-detail.ejs`
- Cleanup already removed merged remote branches:
  - `claude/funny-lederberg`
  - `claude/check-work-status-SjHcM`
- Remaining remote branches:
  - `origin/chore/figma-sync`
  - `origin/claude/epic-sammet`
- Local verification passed:
  - `npm ci --no-audit --no-fund`
  - `npm test` with 22/22 passing.
- Live site static assets for homepage/company pages matched current HEAD at the time checked.
- Live `/shop/orders/TEST/payment` still returned generic 404, meaning the production Node app may not yet have pulled/restarted with latest `master`.
- SSH to Pi `192.168.1.250` was blocked by authentication: `Permission denied (publickey,password)`.

## Required Result Report Format

For each completed task, report in Korean. Start with an intuitive final-result summary before details:

- Put the user-facing outcome first: what is now done, what changed, what remains.
- Prefer concise tables for comparisons, status, before/after lists, and branch/deployment state.
- When a visual issue or UI change is involved, attach screenshots/images first when available, then explain.
- Keep the detailed root-cause and verification notes below the summary.

Use this structure:

```text
[최종 결과 요약]
- 사용자가 바로 이해할 수 있게 완료/미완료/다음 행동을 직관적으로 요약
- 필요하면 표, 스크린샷, 이미지 링크를 먼저 첨부

[작업 요약]
- 무엇을 수정했는지 1~3줄 요약

[원인]
- 문제가 발생한 실제 원인

[수정 파일]
- routes/shop.js
- views/shop/account.ejs
- public/css/...

[핵심 수정 내용]
- 무엇을 어떻게 바꿨는지
- 임시방편인지 구조적 해결인지 명시

[회귀 테스트]
- 어떤 화면/기능에서 다시 확인해야 하는지

[주의사항]
- 다음 작업자가 조심할 점
- 환경변수/도메인/세션 관련 이슈
- 남아 있는 TODO

[새로 확인된 오류 포인트]
- 재발하거나 새로 발견된 오류

[이번에 추가된 기능]
- 실제로 새로 구현한 기능만 기록

[다음 작업 우선순위]
- 즉시 수정할 것
- 다음 배포 전 확인할 것
- 추후 개선할 것
```

## Absolute Prohibitions

- Do not treat existing Kakao Pay, Papago/NCP translation, planned Outbound Mailer, or planned search keyword analysis as nonexistent.
- Do not leave duplicate current-page buttons/menus.
- Do not fix admin layout overlap with only cosmetic margin/padding.
- Do not diagnose CSRF/session/upload/payment approval problems from frontend code alone.
- Do not expose app-only bottom UI in normal web pages without proper branching.
- Do not remove existing features without explicit user approval.

## Compressed Core Rules

1. This is an EJS server-rendered project, not React.
2. Existing Kakao Pay and Papago/NCP translation must be preserved.
3. Planned NCP Outbound Mailer and search analytics are known; do not duplicate-propose them.
4. Dark mode is removed and is not a default check item.
5. Account duplicate buttons, admin product overlap, and customer support design bugs are recurring priority risks.
6. CSRF/session/upload/payment approval issues require server/middleware/env checks, not frontend-only fixes.
7. Always leave regression test notes.
8. End work with the new error points / added features / next priorities memo.
