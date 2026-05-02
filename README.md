<div align="center">

# ENERMADE Company Website

**세라믹 가공 솔루션 전문기업의 풀스택 기업 웹사이트**

[![Node.js](https://img.shields.io/badge/Node.js-18.x-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Express](https://img.shields.io/badge/Express-4.x-000000?logo=express&logoColor=white)](https://expressjs.com)
[![MySQL](https://img.shields.io/badge/MySQL-8.0-4479A1?logo=mysql&logoColor=white)](https://mysql.com)
[![PM2](https://img.shields.io/badge/PM2-Deployed-2B037A?logo=pm2&logoColor=white)](https://pm2.keymetrics.io)
[![Live](https://img.shields.io/badge/Live-enermade.com-E65C00?logo=googlechrome&logoColor=white)](https://enermade.com)

</div>

---

## 🛠 기술 스택

| 레이어 | 기술 |
|--------|------|
| **Runtime** | Node.js 18 |
| **Web Framework** | Express.js 4 |
| **Template Engine** | EJS |
| **Database** | MySQL 8 via `mysql2` Promise Pool |
| **CSS Framework** | Bootstrap 5 + Custom CSS Variables |
| **Authentication** | express-session + bcrypt |
| **Payment** | Kakao Pay REST API |
| **Translation** | Naver Papago API (KO↔EN/JA/ZH 실시간) |
| **Email** | Nodemailer (Gmail SMTP) |
| **Process Manager** | PM2 |
| **Reverse Proxy** | Nginx |
| **Server** | Raspberry Pi 5 (ARM64, Debian) |

---

## ✨ 주요 기능

### 🌐 다국어 실시간 번역 (KO / EN / JA / ZH)
- 우측 하단 언어 위젯으로 즉시 전환
- Naver Papago API를 서버 프록시(`/api/translate`)로 호출
- `data-i18n`, `data-i18n-html`, `data-i18n-placeholder` 명시 태그 지원
- **자동 스캔 시스템**: `<main>` 내 정적 요소를 뷰 파일 수정 없이 전 페이지 자동 번역
- `localStorage` 캐시로 동일 텍스트 재번역 방지

### 🛒 이커머스 쇼핑몰
- **카트**: 비로그인(세션) ↔ 로그인(DB) 이중 저장 + 로그인 시 자동 병합 (트랜잭션 보장)
- **결제**: Kakao Pay REST API 연동 (준비 → 승인 → 콜백 전 과정)
- **결제 idempotency**: `SELECT FOR UPDATE` + 상태 사전 체크로 중복 승인 방지
- **주문 조회**: 비회원도 주문번호 + 이름으로 조회 가능
- **대량주문**: SKU 코드 일괄 입력 → 장바구니 일괄 추가
- **상품 관리**: 어드민 대시보드에서 CRUD + Excel 일괄 업로드

### 🔐 인증 & 보안
- 세션 기반 인증 (`express-session`, 2시간 TTL, httpOnly, sameSite: lax)
- 비밀번호 bcrypt 해싱 (10 rounds)
- 커스텀 CSRF 미들웨어 (`/lib/csurf.js`) — `crypto.timingSafeEqual` 타이밍 공격 방지
- 로그인/비밀번호 찾기 브루트포스 방지: `express-rate-limit`
- 결제 요청 rate limiting (1분/10회)
- 세션 고정 공격 방지: 로그인 시 `session.regenerate()`
- 이메일 XSS 방지: `esc()` 헬퍼로 모든 사용자 입력 이스케이프
- `/forgot` 타이밍 공격 방지: 존재하지 않는 이메일 경로에서도 bcrypt 실행
- Helmet.js 보안 헤더
- SESSION_SECRET 미설정 시 production 환경 시작 거부
- DB 시작 검증: `SELECT 1` 후 실패 시 프로세스 종료

### 👑 관리자 대시보드 (`/admin`)
- 상품 등록/수정/삭제 + 이미지 업로드 (sharp 최적화 옵션)
- Excel 파일로 상품 일괄 등록
- 주문 목록 조회 (50건/페이지 페이지네이션)
- 문의 목록 조회 (50건/페이지 페이지네이션) + 이메일 답변
- 공지사항 관리
- 방문 로그 / 검색어 통계

---

## 🗂 프로젝트 구조

```
company-site/
├── app.js                  # 엔트리포인트 — 미들웨어 체인
├── routes/
│   ├── company.js          # 홈, 소개, 공지, 문의
│   ├── auth.js             # 회원가입, 로그인, 비밀번호 찾기
│   ├── shop.js             # 상품, 장바구니, 결제
│   ├── admin.js            # 관리자 전용
│   └── api/                # REST API 엔드포인트
│       └── translate.js    # Papago 번역 프록시
├── services/
│   ├── kakaopay.service.js # Kakao Pay API 래퍼 (try/catch 포함)
│   ├── email.service.js    # Gmail SMTP 드라이버
│   └── notification.service.js  # 문의/주문 알림 이메일 (XSS 이스케이프)
├── middleware/
│   └── auth.js             # requireLogin / requireAdmin 가드
├── lib/
│   ├── csurf.js            # 커스텀 CSRF — timingSafeEqual 적용
│   └── cart.js             # 세션/DB 이중 카트 로직 (트랜잭션)
├── views/
│   ├── company/            # 기업 사이트 EJS 템플릿
│   ├── shop/               # 쇼핑몰 EJS 템플릿
│   ├── auth/               # 인증 페이지
│   └── admin/              # 관리자 대시보드
├── public/
│   ├── css/
│   │   ├── main.css        # CSS 변수 시스템
│   │   ├── company.css
│   │   └── shop.css
│   └── js/
│       └── main.js         # 번역 엔진 + UI 스크립트
├── db.js                   # mysql2 Promise Pool
└── migrations/             # DB 스키마 마이그레이션
```

---

## ⚙️ 시작하기

### 사전 요구 사항

- Node.js 18+
- MySQL 8.0+

### 설치

```bash
git clone https://github.com/Hohongdu/company-site.git
cd company-site
npm install
cp .env.example .env
# .env 파일에 필요한 값 입력
```

### 환경변수 (`.env`)

```env
# 서버
SESSION_SECRET=your_secret_here        # 필수 — production에서 미설정 시 시작 거부
BASE_URL=https://yourdomain.com

# 데이터베이스
DB_HOST=127.0.0.1
DB_USER=your_db_user
DB_PASS=your_db_password
DB_NAME=company_site

# 이메일 (Gmail SMTP)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your@gmail.com
SMTP_PASS=your_app_password
EMAIL_FROM=your@gmail.com

# Kakao Pay
KAKAO_ADMIN_KEY=your_kakao_admin_key
KAKAO_CID=TC0ONETIME                   # 운영 환경에서는 실제 CID로 교체

# Naver Papago 번역 (선택)
PAPAGO_CLIENT_ID=your_papago_client_id
PAPAGO_CLIENT_SECRET=your_papago_secret
```

### 실행

```bash
npm run dev    # 개발 서버 (nodemon auto-reload)
npm start      # 프로덕션
npm test       # 테스트 (Node.js built-in test runner)
```

---

## 🚀 배포 구성

```
Internet → Nginx (80/443) → PM2 [company-site] (127.0.0.1:3000)
                                       ↓
                              MySQL (127.0.0.1:3306)
```

- **서버**: Raspberry Pi 5 (ARM64, Debian)
- **프로세스**: PM2 `fork` 모드, 자동 재시작
- **HTTPS**: Let's Encrypt (Certbot)
- **정적 파일**: Express `static` → Nginx 캐싱

---

## 🔑 핵심 구현 포인트

### 결제 idempotency (이중 승인 방지)

```javascript
// SELECT FOR UPDATE로 행 잠금 → 상태 사전 확인 → 동일 트랜잭션 내 처리
const [[order]] = await connection.execute(
  'SELECT id, status FROM orders WHERE id = ? FOR UPDATE', [orderId]
);
if (order.status === 'PAID') {
  await connection.commit();
  return res.redirect('/shop/orders/' + orderNumber);
}
// ... Kakao Pay approve API 호출 ...
await connection.commit();
```

### 카트 세션↔DB 이중 저장 (트랜잭션)

```javascript
// lib/cart.js — 로그인 시 게스트 카트를 DB로 원자적 병합
// 성공 후에만 세션 초기화 (실패 시 다음 로그인 때 재시도)
await connection.commit();
req.session.guestCart = { items: {} };
```

### 이메일 XSS 방지

```javascript
// services/notification.service.js
function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
```

### CSRF 타이밍 공격 방지

```javascript
// lib/csurf.js — 동일 길이의 문자열 비교
return crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
```

### `/forgot` 계정 열거 방지

```javascript
// 존재하지 않는 이메일도 bcrypt 연산 후 동일 응답 시간 보장
await bcrypt.hash('timing-equalization-dummy', 10);
return res.render('auth/forgot', { message: SUCCESS_MSG });
```

---

## 🛡 보안 적용 목록

| 항목 | 조치 |
|------|------|
| XSS (이메일 템플릿) | `esc()` 헬퍼로 모든 사용자 입력 이스케이프 |
| CSRF | 커스텀 CSRF + `timingSafeEqual` |
| 세션 고정 | 로그인 시 `session.regenerate()` |
| 브루트포스 | 로그인/비밀번호찾기/결제 rate limiting |
| 타이밍 공격 | CSRF 비교 + `/forgot` bcrypt dummy |
| IDOR | 주문/카트 조회 시 `AND user_id = ?` |
| 결제 중복 | `FOR UPDATE` + 상태 사전 체크 |
| Kakao API 장애 | `try/catch` + 구체적 에러 메시지 |
| DB 시작 검증 | `SELECT 1` 후 실패 시 `process.exit(1)` |
| SESSION_SECRET | production 미설정 시 시작 거부 |

---

<div align="center">

**© 2026 ENERMADE** · Built with Express.js + MySQL on Raspberry Pi

</div>
