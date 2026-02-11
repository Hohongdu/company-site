# LibreTranslate Docker quick start

## 1) Start container

```bash
docker compose -f scripts/docker-compose.translate.yml up -d
```

## 2) Check LibreTranslate directly

```bash
curl -s -X POST http://127.0.0.1:5000/translate \
  -H "Content-Type: application/json" \
  -d '{"q":"안녕하세요","source":"ko","target":"en","format":"text"}'
```

## 3) Set app env

```env
# 우선순위: 직접 지정한 URL만 사용됨(콤마로 다중 지정 가능)
TRANSLATE_API_URL=http://127.0.0.1:5000/translate

# 타임아웃/쿨다운(선택)
TRANSLATE_TIMEOUT_MS=3500
TRANSLATE_FAIL_COOLDOWN_MS=120000

# 필요할 때만 활성화
# ENABLE_CONTAINER_SERVICE_NAME=true
# ENABLE_HOST_DOCKER_INTERNAL=true
# ENABLE_PUBLIC_LIBRETRANSLATE=true
```

## 4) Check app proxy endpoint

```bash
npm run check:translate
```

## 5) Run production guard script (docker + health check + pm2 restart)

```bash
bash scripts/translate-ops-guard.sh
```

Optional env vars:

```bash
PM2_APP_NAME=company-site \
TRANSLATE_HEALTH_URL=http://127.0.0.1:5000/translate \
APP_TRANSLATE_URL=http://127.0.0.1:3000/api/translate \
bash scripts/translate-ops-guard.sh
```

## 6) Cron example (every 5 minutes)

```bash
*/5 * * * * cd /home/ubuntu/apps/company-site && /bin/bash scripts/translate-ops-guard.sh >> /var/log/company-site-translate-guard.log 2>&1
```
