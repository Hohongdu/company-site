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
