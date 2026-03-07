# 라즈베리파이 서버에 AI(Ollama) 붙이기 가이드

이 문서는 `company-site` 서버에서 **라즈베리파이의 로컬 AI 서버(Ollama)**를 API로 호출하는 방법을 설명합니다.

## 1) 라즈베리파이에 Ollama 설치

```bash
curl -fsSL https://ollama.com/install.sh | sh
```

설치 후 서비스 상태 확인:

```bash
systemctl status ollama
```

## 2) 모델 다운로드

라즈베리파이 자원 기준으로 가벼운 모델부터 권장합니다.

```bash
ollama pull llama3.2:1b
```

> 대안: `qwen2.5:1.5b`, `phi3:mini`

## 3) 서버 접근 설정

기본은 로컬 바인딩(`127.0.0.1:11434`)이며, 같은 장비에서 app이 실행 중이면 별도 설정 없이 동작합니다.

다른 장비에서 호출하려면 방화벽/바인딩 정책을 추가로 설정하세요.

## 4) company-site 환경변수 설정

앱 `.env`에 아래 값을 추가합니다.

```env
AI_SERVER_BASE_URL=http://127.0.0.1:11434
AI_MODEL=llama3.2:1b
AI_GENERATE_PATH=/api/generate
```

## 5) API 사용

### 상태 점검

```bash
curl http://localhost:3000/api/ai/status
```

### 질의

```bash
curl -X POST http://localhost:3000/api/ai/chat \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"우리 쇼핑몰 첫인사 문구를 2줄로 만들어줘"}'
```

정상 응답 예:

```json
{
  "ok": true,
  "model": "llama3.2:1b",
  "response": "안녕하세요! ..."
}
```

## 6) 장애 대응

- `AI 서버 호출에 실패했습니다.`: Ollama 서비스 상태, 포트(11434), 모델명 확인
- `prompt is required`: 요청 body에 `prompt` 문자열 누락
- 응답이 너무 느림: 더 작은 모델 사용 또는 `prompt` 길이 축소
