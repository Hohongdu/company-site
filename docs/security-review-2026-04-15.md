# Security Review - 2026-04-15

## Scope

- Session and authentication flow
- CSRF coverage
- Guest lookup and public inquiry flow
- File transfer API
- Payment flow
- Dependency vulnerability status

## Findings

### 1. Password reset changes the credential before delivery is confirmed

- Location: `routes/auth.js`
- Evidence: the forgot-password flow updates `users.password` before it checks whether the mail send succeeded
- Risk: if SMTP is disabled or delivery fails, the account password is already rotated and the user can be locked out
- Recommendation:
  - move to a one-time reset token flow, or
  - only persist the new credential after mail delivery is confirmed

### 2. No rate limiting on login, password reset, guest order lookup, or guest inquiry lookup

- Location: `routes/auth.js`, `routes/shop.js`
- Evidence:
  - `POST /auth/login`
  - `POST /auth/forgot`
  - `POST /shop/orders/guest`
  - `POST /shop/inquiries/guest`
- Risk:
  - credential stuffing against login
  - mail-trigger abuse on password reset
  - brute-force or enumeration attempts against guest lookup endpoints
- Recommendation:
  - add IP + identifier based rate limits
  - add cooldowns for password reset
  - add monitoring and alerting for repeated failed lookups

### 3. Guest inquiry lookup uses sequential IDs plus one matching identifier

- Location: `routes/shop.js`
- Evidence: `POST /shop/inquiries/guest` looks up `WHERE id = ? AND user_id IS NULL AND ((guest_email = ?) OR (guest_phone = ?))`
- Risk:
  - inquiry IDs are sequential and predictable
  - if an attacker knows a guest email address or phone number, repeated attempts can enumerate inquiry content and admin replies
- Recommendation:
  - replace raw numeric inquiry IDs with high-entropy public lookup tokens
  - require both email and phone, or require a dedicated lookup token
  - add rate limiting and failed-attempt logging

### 4. Public file transfer API allows anonymous uploads and uses an unsafe fallback signing secret

- Location: `routes/api/file-transfer.api.js`, `controllers/file-transfer.controller.js`
- Evidence:
  - upload route is public
  - upload uses memory storage
  - download token secret falls back to `unsafe-dev-secret-change-me`
  - uploaded files are written to `uploads/shared-files`
- Risk:
  - anonymous users can use the service as ad-hoc file hosting
  - disk can grow without cleanup
  - a known fallback secret weakens token trust in misconfigured environments
- Recommendation:
  - require authentication or a server-issued invite token for uploads
  - refuse to start unless `FILE_TRANSFER_TOKEN_SECRET` is set
  - add retention cleanup and upload quotas
  - consider content-type allowlists and malware scanning if this API remains public

### 5. CSRF protection is inconsistent across shop write routes

- Location: `app.js`, `lib/csurf.js`, `routes/shop.js`
- Evidence:
  - global CSRF enforcement is mounted only for `/auth` and `/admin`
  - some shop routes enforce local CSRF, but several write routes do not
  - multiple shop forms still render `_csrf`, which suggests protection but is not consistently validated server-side
- Risk:
  - protections are easy to assume but easy to miss
  - state-changing shop actions can drift into unprotected territory during future changes
- Recommendation:
  - mount CSRF consistently for all state-changing `/shop` routes, or split public JSON endpoints behind an explicit verification layer
  - remove dead `_csrf` fields only if the route is intentionally unauthenticated and non-session based
  - avoid accepting CSRF tokens from query strings

### 6. Production dependencies currently include known vulnerabilities

- Reviewed on: 2026-04-15
- Command: `npm audit --omit=dev --json`
- Summary:
  - 1 critical
  - 4 high
  - 5 moderate
- Direct dependency highlights:
  - `axios@^1.13.2`: critical advisories affecting SSRF/header handling chains
  - `multer@^2.0.2`: high-severity DoS advisories
  - `nodemailer@^8.0.2`: SMTP injection advisories
  - `xlsx@^0.18.5`: high-severity prototype pollution and ReDoS advisories
- Recommendation:
  - upgrade direct dependencies first
  - re-run audit after lockfile refresh
  - if `xlsx` cannot be upgraded quickly, isolate import/export processing and treat uploaded spreadsheets as untrusted

## Positive Notes

- Session fixation protection is present on login via `req.session.regenerate()`
- Session cookies are `httpOnly` and `sameSite: 'lax'`
- SQL access is parameterized throughout the reviewed paths
- File download token verification uses HMAC with `timingSafeEqual`
- Admin inquiry list API is gated by `requireAdmin`

## Recommended Fix Order

1. Replace the forgot-password implementation with a reset-token flow
2. Add rate limiting for login, forgot-password, guest order lookup, guest inquiry lookup, and file transfer upload
3. Remove the file-transfer fallback secret and require a configured signing secret
4. Convert guest inquiry lookup from sequential IDs to opaque lookup tokens
5. Unify CSRF enforcement on all state-changing `/shop` routes
6. Upgrade vulnerable direct dependencies and re-run `npm audit`
