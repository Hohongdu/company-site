# LibreTranslate Docker quick start

## 1) Start container

```bash
docker compose -f scripts/docker-compose.translate.yml up -d
```

## 2) Check LibreTranslate directly

```bash
curl -s -X POST http://localhost:5000/translate \
  -H "Content-Type: application/json" \
  -d '{"q":"안녕하세요","source":"ko","target":"en","format":"text"}'
```

## 3) Set app env

```env
# optional: comma-separated fallback order
TRANSLATE_API_URL=http://libretranslate:5000/translate,http://host.docker.internal:5000/translate,http://localhost:5000/translate
```

## 4) Check app proxy endpoint

```bash
npm run check:translate
```
