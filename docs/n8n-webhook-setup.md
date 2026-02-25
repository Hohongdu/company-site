# n8n 이메일 웹훅 연동 가이드

이 프로젝트의 메일 발송은 `EMAIL_WEBHOOK_URL`로 JSON POST를 보내는 방식입니다.
n8n Webhook URL을 연결하면 무료(셀프호스트/프리티어)로 운영 가능합니다.

## 1) n8n에서 워크플로우 가져오기

1. n8n 접속 → **Import from File**
2. `workflows/n8n-email-webhook.json` 파일을 가져오기
3. `Send Gmail` 노드의 Gmail OAuth credential 연결
4. 워크플로우 활성화

> 템플릿은 `Authorization: Bearer <token>`를 검사합니다.

## 2) 서버 환경변수 설정

`.env`에 아래를 설정하세요.

```env
EMAIL_WEBHOOK_URL=https://<your-n8n-domain>/webhook/company-site-email
EMAIL_WEBHOOK_TOKEN=<강력한랜덤토큰>
EMAIL_FROM=Company Site
```

## 3) 테스트 요청

```bash
node scripts/run-email-webhook-check.js
```

성공하면 n8n에서 200 응답과 메일 발송 로그를 확인할 수 있습니다.

## 4) 현재 앱 동작 방식

- `EMAIL_WEBHOOK_URL`이 없으면 `SKIPPED`로 처리됩니다.
- `EMAIL_WEBHOOK_URL`이 있으면 Bearer 토큰 헤더와 함께 웹훅으로 전송합니다.

관련 코드:
- `services/notification.service.js`

## 5) 운영 권장사항

- 토큰은 32자 이상 랜덤 문자열 사용
- n8n 접근을 HTTPS로만 허용
- 실패 시 n8n에서 재시도/슬랙 알림 분기 추가 권장

## 6) 라즈베리파이 설치

라즈베리파이 로컬 서버에 n8n을 설치하려면 아래 문서를 먼저 진행하세요.

- `docs/raspberrypi-n8n-install.md`

설치 후 본 문서의 환경변수와 테스트 절차를 이어서 적용하면 됩니다.
