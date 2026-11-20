# 운영 가이드

본 문서는 ENERMADE 사이트 운영 인프라(프로세스 관리, 로그, 백업, 모니터링)를 다룹니다.

## 1. 프로세스 관리 (PM2)

### 1.1 최초 기동

```bash
cd /path/to/company-site
npm ci --omit=dev
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup           # 부팅 시 자동 시작 등록 (출력된 명령을 sudo로 실행)
```

### 1.2 무중단 재시작 (zero-downtime reload)

```bash
git pull
npm ci --omit=dev
pm2 reload ecosystem.config.js --env production
```

`reload`는 새 프로세스가 준비되면 기존 프로세스를 종료해 다운타임 없이 교체합니다.

### 1.3 상태 확인

```bash
pm2 list                  # 실행 중인 앱 목록
pm2 logs company-site     # 실시간 로그
pm2 monit                 # CPU/메모리 모니터
pm2 describe company-site # 상세 정보
```

## 2. 로그 회전 (pm2-logrotate)

PM2는 기본적으로 로그를 누적만 합니다 — 디스크가 가득 차기 전에 로그 회전을 설정해야 합니다.

### 2.1 설치 (최초 1회)

```bash
pm2 install pm2-logrotate
```

### 2.2 권장 설정

```bash
pm2 set pm2-logrotate:max_size 10M        # 10MB 도달 시 회전
pm2 set pm2-logrotate:retain 14           # 14개 보관 (≈ 2주)
pm2 set pm2-logrotate:compress true       # 회전된 로그 gzip 압축
pm2 set pm2-logrotate:dateFormat YYYY-MM-DD_HH-mm-ss
pm2 set pm2-logrotate:rotateInterval '0 0 * * *'  # 매일 자정에도 회전
```

설정 확인: `pm2 conf pm2-logrotate`

### 2.3 로그 위치

`ecosystem.config.js`에 정의된 경로:

- `./logs/out.log` — stdout
- `./logs/error.log` — stderr

`.gitignore`에 `logs/` 포함 — 커밋되지 않음.

## 3. MySQL 자동 백업

`scripts/backup-mysql.sh` 가 매일 백업을 생성합니다 (14일 보관).

### 3.1 설정 (최초 1회)

```bash
# 1) 스크립트 실행 권한
chmod +x scripts/backup-mysql.sh

# 2) cron 등록 (매일 03:00)
crontab -e
# 다음 줄 추가:
# 0 3 * * * /path/to/company-site/scripts/backup-mysql.sh >> /path/to/company-site/logs/backup.log 2>&1
```

### 3.2 수동 백업

```bash
./scripts/backup-mysql.sh
ls -lh backups/
```

### 3.3 복구

```bash
# 가장 최근 백업 복구
gunzip < backups/company_site-2026-05-26.sql.gz | mysql -u company_user -p company_site

# 특정 일자 복구
gunzip < backups/company_site-2026-05-20.sql.gz | mysql -u company_user -p company_site
```

### 3.4 원격 복제 (권장)

Pi 디스크 손상 대비, 백업 파일을 외부로 주기적으로 동기화:

```bash
# rclone(B2/S3) 또는 rsync(NAS) 사용 예시
rclone copy backups/ remote:enermade-backup/ --max-age 24h
```

## 4. 헬스체크 / 외부 모니터링

### 4.1 헬스체크 엔드포인트

```
GET /api/health
```

응답 예시:

```json
{
  "ok": true,
  "ts": 1764115200000,
  "uptime": 3600.5,
  "memory": { "rss": 87654321, "heapUsed": 23456789 },
  "db": "ok"
}
```

`db: "fail"` 또는 `ok: false` 응답은 인프라 문제를 의미.

### 4.2 UptimeRobot 등록 (무료 50개 모니터)

1. https://uptimerobot.com 가입
2. **Add New Monitor**:
   - Type: HTTP(s)
   - URL: `https://enermade.com/api/health`
   - Monitoring Interval: 5 minutes
   - Keyword (선택): `"ok":true`
3. **Alert Contacts**: 이메일/SMS/Slack/Telegram 추가
4. 다운 시 즉시 알림 수신

### 4.3 SSL 만료 모니터

UptimeRobot의 **SSL Monitor**도 추가 권장 — 인증서 만료 30/14/7일 전 알림.

## 5. HTTPS 인증서 갱신 (Let's Encrypt)

Certbot이 자동 갱신을 처리하지만 정기 확인 필요:

```bash
# 갱신 시뮬레이션 (실제 갱신 X)
sudo certbot renew --dry-run

# 갱신된 인증서 적용 (Nginx)
sudo systemctl reload nginx
```

cron 자동 갱신 확인:

```bash
sudo systemctl list-timers | grep certbot
```

## 6. 사고 대응 체크리스트

| 증상 | 1차 점검 |
|------|---------|
| 사이트 응답 없음 | `pm2 list`, `pm2 logs company-site --lines 100` |
| 5xx 에러 급증 | `pm2 logs company-site --err`, `tail -f logs/error.log` |
| DB 연결 실패 | `mysql -u company_user -p` 직접 접속 시도, `systemctl status mysql` |
| 디스크 가득 | `df -h`, `du -sh logs/ backups/ uploads/ public/uploads/` |
| 메모리 누수 의심 | `pm2 monit` 추세 확인 — 500MB 자동 재시작은 ecosystem에서 처리 |
| SSL 만료 임박 | `sudo certbot certificates` |
