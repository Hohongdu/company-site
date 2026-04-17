# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev     # Development server with auto-reload (nodemon)
npm start       # Production server
npm test        # Run Node.js built-in tests (node --test)
```

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
| `/payments/kakao/*` | inside shop routes | Kakao Pay callbacks |

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

### Services

| File | Purpose |
|------|---------|
| `services/email.service.js` | Gmail SMTP via Nodemailer |
| `services/notification.service.js` | Sends notifications for inquiry replies and password resets |
| `services/kakao-pay.service.js` | Kakao Pay payment API integration |
| `services/file-transfer.service.js` | File upload handling |
| `services/translation.service.js` | Papago (Naver) translation API |

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

---

## 작업 규칙 (Claude 준수 사항)

### 기능 보존 원칙
**구현된 기능은 명시적 요청 없이 삭제하지 않는다.**

- 버그 수정·리팩터링 중에도 기존에 동작하던 기능(라우트, UI 요소, API, 서비스)을 제거하려면 반드시 사용자에게 먼저 확인해야 한다.
- 커밋 메시지에 기능 제거가 포함될 경우 사전에 명시하고 승인을 받는다.
- UI 개편 시 네비게이션 링크·버튼·메뉴 항목을 '정리'하는 행위도 동일하게 금지한다.
- 위반 사례: `b5c885b` 커밋에서 쇼핑몰 아이콘/링크가 명시적 요청 없이 제거됨 → `company-top.ejs` 복원 필요.

### 배포 스크립트 관리
`deploy_lederberg.py`는 Pi(192.168.1.250)로 파일을 SFTP 업로드하는 배포 도구다.
- 백엔드 파일(routes, services, controllers, lib)과 프론트엔드 파일(CSS, JS, EJS)은 반드시 **세트로** 배포 목록에 포함해야 한다.
- 새 파일을 추가하거나 기존 파일을 수정한 경우 배포 목록을 업데이트한다.
