# Dependency Audit — 2026-05-26

## Summary

| 항목 | 이전 (2026-04-15) | 현재 (2026-05-26) |
|------|------|------|
| Critical | 1 | 0 |
| High | 4 | 1 (xlsx only) |
| Moderate | 5 | 0 |
| **총** | **10** | **1** |

`npm audit fix` 적용으로 9건 해결. `xlsx` 1건만 잔존 (No fix available).

## Applied Fixes

`npm audit fix` 자동 수정 항목:

- `axios` → SSRF, prototype pollution 등 16건 해결
- `body-parser` → DoS 해결
- `brace-expansion` → ReDoS 해결
- `follow-redirects` → 헤더 누출 해결
- `minimatch` → ReDoS 해결
- `multer` → DoS 3건 해결
- `nodemailer` → SMTP injection 2건 해결
- `path-to-regexp` → ReDoS 2건 해결
- `qs` → DoS 3건 해결

검증: `npm test` 24/24 통과, 서버 부팅 정상.

## Outstanding: xlsx

### Risk Profile

- **Package**: `xlsx@0.18.5` (SheetJS Community Edition)
- **CVEs**:
  - GHSA-4r6h-8v6p-xvw6: Prototype Pollution
  - GHSA-5pgg-2g8v-p4x9: ReDoS
- **Status**: npm 배포는 사실상 maintenance 중단, **공식 권장 = sheetjs.com CDN 빌드 사용**

### Current Mitigation (already in place)

위치: `routes/admin.js`

- `requireAdmin` 미들웨어로 관리자만 호출 가능
- 파일 사이즈 10MB 제한 (`multer.limits.fileSize`)
- MIME 화이트리스트: `.xlsx`, `.xls` 만 (`multer.fileFilter`)
- 5000행 제한
- 파싱 직후 임시 파일 `fs.unlink` 삭제

### Residual Risk

- 관리자 계정 탈취 시 악의적 .xlsx로 prototype pollution 가능
- 특수 패턴 입력 시 ReDoS로 CPU 100% 가능 (관리자 본인이 본인 서버 다운)

**현재 격리 수준에서 운영 진입은 가능**하나 관리자 인증 강화 권장.

### Long-term Plan (Phase 3)

옵션 A) SheetJS 공식 CDN 빌드로 전환 (권장):

```json
// package.json
"xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"
```

- 장점: 코드 변경 없음, 최신 패치 포함
- 단점: 인터넷 의존, lockfile 검증 강화 필요

옵션 B) `exceljs`로 교체:

- 장점: 활발히 maintained, npm 정상 배포
- 단점: API 변경, `routes/admin.js`의 12곳 xlsx 호출 모두 수정

## Verification

```bash
npm test              # 24/24 통과
npm audit --omit=dev  # 1 high (xlsx) 만 잔존
node app.js           # 부팅 정상
```

## Related Files

- `routes/admin.js:5` — xlsx import
- `routes/admin.js:157-171` — multer Excel 업로드 설정
- `routes/admin.js:817, 825` — xlsx.readFile, sheet_to_json (취약 경로)
- `routes/admin.js:1009-1140, 1582-1598` — xlsx.write export (안전)
