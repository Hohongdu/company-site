# 라즈베리파이에 n8n 설치/운영 가이드 (로컬 서버 저장)

이 문서는 **Raspberry Pi(64bit OS)**에 n8n을 설치하고, 데이터(워크플로우/자격증명)를 로컬 디스크에 저장하는 절차입니다.

## 0) 권장 환경

- Raspberry Pi OS 64bit (Bookworm 권장)
- 메모리 2GB 이상(4GB 권장)
- Docker + Docker Compose plugin

> 로컬 저장 위치: `deploy/n8n/data` (컨테이너 `/home/node/.n8n`에 마운트)

---

## 1) Docker 설치

```bash
sudo apt update
sudo apt install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian \
  $(. /etc/os-release && echo $VERSION_CODENAME) stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker $USER
```

> `newgrp docker` 또는 재로그인 후 `docker ps` 확인

---

## 2) n8n 배포 파일 준비

레포 기준:

- `deploy/n8n/docker-compose.yml`
- `deploy/n8n/.env.example`

설정 파일 생성:

```bash
cd /workspace/company-site/deploy/n8n
cp .env.example .env

# 또는 자동 초기화 스크립트 사용
./bootstrap.sh
```

`.env`에서 최소 아래 값 수정 권장:

- `N8N_BASIC_AUTH_PASSWORD`
- `N8N_ENCRYPTION_KEY`
- 도메인이 있으면 `WEBHOOK_URL`을 실제 URL로 변경

---

## 3) 실행/중지

실행:

```bash
cd /workspace/company-site/deploy/n8n
docker compose up -d
```

로그 확인:

```bash
docker compose logs -f n8n
```

중지:

```bash
docker compose down
```

---

## 4) 부팅 시 자동 시작

`restart: unless-stopped`가 이미 설정되어 있어 Docker daemon 시작 시 자동 복구됩니다.

원하면 systemd로 Docker 자체 자동기동 확인:

```bash
sudo systemctl enable docker
sudo systemctl start docker
```

---

## 5) 현재 프로젝트와 연결

앱 서버 `.env`:

```env
EMAIL_WEBHOOK_URL=http://<라즈베리파이IP>:5678/webhook/company-site-email
EMAIL_WEBHOOK_TOKEN=<n8n에서 검사할 토큰>
EMAIL_FROM=Company Site
```

그리고 n8n에서 `workflows/n8n-email-webhook.json`을 import한 뒤,
`If Auth OK` 노드의 토큰 비교가 `EMAIL_WEBHOOK_TOKEN`과 맞는지 확인합니다.

---

## 6) 백업 (로컬 저장 핵심)

n8n 데이터는 `deploy/n8n/data`에 저장됩니다. 주기적으로 백업하세요.

```bash
cd /workspace/company-site/deploy/n8n
sudo tar -czf n8n-backup-$(date +%F).tar.gz data
```

복구 시 해당 `data` 폴더를 복원 후 `docker compose up -d`.

---

## 7) 트러블슈팅

- 5678 포트 충돌: 다른 프로세스 종료 또는 포트 변경
- 웹훅 401: `EMAIL_WEBHOOK_TOKEN` 불일치
- 메일 발송 실패: n8n Gmail credential/OAuth 재연결
- 앱에서 `SKIPPED`: 앱 `.env`에 `EMAIL_WEBHOOK_URL` 미설정


---

## 8) 실서버 값 정확히 계산하기 (IP/도메인 기준)

아래 스크립트로 현재 장비 기준 값을 즉시 생성할 수 있습니다.

```bash
# 라즈베리파이 내부 IP 자동 계산
bash scripts/generate-webhook-env.sh --auto-ip

# IP 직접 지정
bash scripts/generate-webhook-env.sh --ip 192.168.0.120

# 도메인 사용(HTTPS 역프록시 구성된 경우)
bash scripts/generate-webhook-env.sh --domain n8n.example.com
```

출력된 값을 그대로 복사해서 사용하세요.

### 예시 1) 라즈베리파이 IP가 `192.168.0.120`인 경우

```env
# n8n(deploy/n8n/.env)
WEBHOOK_URL=http://192.168.0.120:5678/

# app(.env)
EMAIL_WEBHOOK_URL=http://192.168.0.120:5678/webhook/company-site-email
EMAIL_WEBHOOK_TOKEN=<스크립트가 생성한 64hex 토큰>
```

### 예시 2) 도메인 `n8n.example.com` + HTTPS 역프록시인 경우

```env
# n8n(deploy/n8n/.env)
WEBHOOK_URL=https://n8n.example.com/

# app(.env)
EMAIL_WEBHOOK_URL=https://n8n.example.com/webhook/company-site-email
EMAIL_WEBHOOK_TOKEN=<스크립트가 생성한 64hex 토큰>
```

> `EMAIL_WEBHOOK_TOKEN`은 앱 `.env`와 n8n 인증 검증 값이 동일해야 합니다.

---

## 9) 브랜치 업데이트 시 docker-compose 반영 여부

네. `deploy/n8n/docker-compose.yml` 파일이 Git에 커밋되어 있으므로,
같은 브랜치 내용을 pull/merge하면 파일도 함께 반영됩니다.

다만 **자동 실행은 아닙니다**. 반영 후 아래를 수동 실행해야 실제 컨테이너가 올라옵니다.

```bash
cd /workspace/company-site/deploy/n8n
docker compose up -d
```


### 자주 만나는 오류 즉시 해결

- 오류: `env file .../.env not found`
  - 원인: `deploy/n8n/.env`가 없음
  - 해결:

```bash
cd /home/ras/apps/company-site/deploy/n8n
./bootstrap.sh
# 또는 cp .env.example .env
docker compose up -d
```

- 경고: `the attribute version is obsolete`
  - 최신 compose에서는 `version` 키를 쓰지 않습니다.
  - 현재 템플릿은 해당 키를 제거해 경고 없이 동작합니다.
