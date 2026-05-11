# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev     # Development server with auto-reload (nodemon)
npm start       # Production server
npm test        # Run Node.js built-in tests (node --test)
```

## Review Notes

- Latest security review: `docs/security-review-2026-04-15.md`

## Architecture Overview

This is a Korean company website with an e-commerce storefront, built with **Express.js + EJS + MySQL**.

### Entry Point & Middleware Chain

`app.js` bootstraps the server on port 3000. Middleware order matters:
1. Helmet (security headers)
2. Body parsers + static files
3. `express-session` (2-hour TTL, httpOnly cookies)
4. Custom CSRF (`/lib/csurf.js`) — session-based tokens applied to `/auth` and `/admin` routes (multipart admin routes bypass CSRF)
5. Common locals injected into every view (session user, CSRF token, cart count)

The app runs behind an Nginx reverse proxy (`trust proxy` is set).

### Routing

| Mount | File | Purpose |
|-------|------|---------|
| `/` | `routes/company.js` | Homepage, about, notices, contact |
| `/auth` | `routes/auth.js` | Register, login, logout, password recovery |
| `/shop` | `routes/shop.js` | Product listing, cart, checkout |
| `/admin` | `routes/admin.js` | Admin dashboard (products, orders, inquiries) |
| `/api` | `routes/api/` | API endpoints |
| `/shop/checkout/kakao/*` | `routes/shop.js` | Kakao Pay checkout + callbacks |

### Authentication

Session-based auth. After login, `req.session.user` contains `{ id, email, name, is_admin }`.

- `middleware/auth.js` exports `requireLogin` and `requireAdmin` guards
- Passwords hashed with bcrypt (10 rounds)
- `is_admin === 1` grants admin access

### Database

MySQL via `mysql2` promise pool (`db.js`). Pool is exported and used directly in route files — there are no ORM models. SQL is written inline in routes and services.

Key tables: `users`, `products`, `orders`, `order_items`, `order_payments`, `carts`, `cart_items`, `inquiries`, `notices`.

Schema migrations are in `/migrations/`.

### Cart Logic

`/lib/cart.js` handles dual-mode carts:
- **Guest:** stored in `req.session.cart`
- **Logged-in:** stored in DB (`carts` + `cart_items` tables)
- Cart is merged from session into DB on login

### Routing Guardrails

- Do not reintroduce app-level `/payments/*` routes in `app.js`
- Kakao Pay flow is owned by `routes/shop.js` under `/shop/checkout/kakao/*`
- Keep payment routes mounted before 404/500 handlers; dead callback code should be removed or explicitly disabled with a regression test

### Services

| File | Purpose |
|------|---------|
| `services/email.service.js` | Gmail SMTP via Nodemailer |
| `services/notification.service.js` | Sends notifications for inquiry replies and password resets |
| `services/kakao-pay.service.js` | Kakao Pay payment API integration |
| `services/file-transfer.service.js` | File upload handling |
| `services/translation.service.js` | Papago (Naver) translation API |

### Notification Guardrails

- When mail sending is intentionally disabled, notification helpers must return `status: 'DISABLED'` and `provider: 'NONE'`
- Admin inquiry replies are save-only; keep the UI and route contract aligned with "답변 저장만 가능합니다."

### Environment Variables

Copy `.env.example` to `.env`. Required vars:

```
SESSION_SECRET, DB_HOST, DB_USER, DB_PASS, DB_NAME
SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM
BASE_URL, KAKAO_ADMIN_KEY, KAKAO_CID
```

Optional: `PAPAGO_CLIENT_ID`, `PAPAGO_CLIENT_SECRET`

### Views

EJS templates in `/views/`. Layouts and partials are in `/views/layouts/` and `/views/partials/`. The view engine root is set to `/views`.

## 개발 규칙 (절대 준수)

### 쿠폰 / 할인 기능 금지
쿠폰, 할인코드, 프로모션, 포인트, 적립금 등 가격 할인과 관련된 기능은 **어떤 형태로도 추가하지 않는다.**
- 장바구니, 결제, 주문 플로우에 할인 적용 로직 추가 금지
- DB 스키마에 `discount_*`, `coupon_*` 컬럼/테이블 추가 금지
- UI에 쿠폰 선택 / 할인 금액 표시 추가 금지
- `user_coupons` 테이블은 기존 데이터 보존용으로만 유지하며 결제에 연동하지 않는다

### EJS 템플릿 — 라우트 데이터 누락 방지
EJS 뷰에서 변수를 사용할 때 해당 변수가 라우트 `res.render()` 호출에 반드시 포함되어야 한다.
- 템플릿에 `typeof X !== 'undefined'` 조건이 있더라도 라우트에서 쿼리 + 전달을 생략하면 기능이 무음으로 비활성화됨
- 신규 섹션 추가 시: 라우트 쿼리 → render() 전달 → 템플릿 사용 3단계를 모두 구현

### notification.service.js 반환값 형식
`sendInquiryReplyEmail`, `sendTemporaryPasswordEmail` 등 모든 send 함수는 반드시 `{ ok, status, provider, error }` 형태로 반환해야 한다.
- 비활성화(DISABLED) 반환: `{ ok: false, status: 'DISABLED', provider: 'NONE', error: '...' }`
- 성공 반환: `{ ok: true, status: 'SUCCESS', provider: 'SMTP' }`

### 엑셀 수식 주입 방지
관리자 CSV/엑셀 export 라우트에서 셀 값을 그대로 출력하지 않는다.
- `=`, `+`, `-`, `@`, `\t`, `\r` 로 시작하는 문자열은 탭(`\t`) 접두어를 붙여 무력화
- `sanitizeCell()` / `sanitizeRows()` 유틸이 `routes/admin.js`에 구현되어 있으니 export 라우트에 반드시 적용

### 작업 완료 전 재발 방지 체크리스트
**모든 작업을 마치기 전에 아래 항목이 재발하지 않았는지 확인한다:**
1. EJS 템플릿에서 사용하는 변수가 라우트 render() 에 모두 전달되는가?
2. notification.service.js 반환값에 `provider` 필드가 포함되어 있는가?
3. 관리자 엑셀 export 라우트에 `sanitizeRows()` 가 적용되어 있는가?
4. 쿠폰/할인 관련 코드가 추가되지 않았는가?
5. `npm test` 22개 테스트가 모두 통과하는가?
