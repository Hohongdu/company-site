import sys, time, os

try:
    import paramiko
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'paramiko', '-q'])
    import paramiko

sys.stdout.reconfigure(encoding='utf-8')

WORKTREE    = r'C:\Users\pke03\company-site\.claude\worktrees\funny-lederberg'
REMOTE_BASE = '/home/ras/company-site'

FILES = [
    # ── Routes ──
    'routes/company.js',
    'routes/shop.js',          # [34bbc58] IDOR 보안 수정 (bank/complete, tax-invoice)
    'routes/admin.js',         # [M-8] notification_status ENUM 범위 버그 수정

    # ── Services ──
    'services/email.service.js',          # 드라이버 라우터 (EMAIL_DRIVER 분기)
    'services/smtp-email.service.js',     # [M-7] HTML 인젝션 방지 (escapeHtml)
    'services/ncp-email.service.js',      # NCP Outbound Mailer REST API 드라이버
    'services/notification.service.js',
    'services/search-log.service.js',     # CRLF→LF 정규화
    'services/inquiry.service.js',        # [MED-6] INSERT 컬럼명 수정 (guest_name/guest_email)

    # ── Controllers ──
    'controllers/inquiry.controller.js',

    # ── Lib ──
    'lib/cart.js',          # [M-6] 트랜잭션 카트 병합 + 999 수량 상한
    'lib/csurf.js',         # [M-1] crypto.timingSafeEqual 타이밍 안전 비교
    'lib/validators.js',

    # ── Core ──
    'db.js',                # [CODEX-1] DB_PASS||DB_PASSWORD 이중 폴백 + DB_PORT

    # ── CSS ──
    'public/css/main.css',               # 드롭다운 + 모바일 드로어 스타일
    'public/css/company.css',
    'public/css/app-ui.css',

    # ── JS ──
    'public/js/main.js',                 # 모바일 아코디언 + 번역 위젯 JS

    # ── Company layouts ──
    'views/layouts/company-top.ejs',
    'views/layouts/company-bottom.ejs',  # 모바일 드로어 JS + 로그인 오버레이 JS

    # ── New company pages ──
    'views/company/business-areas.ejs',
    'views/company/research-dev.ejs',

    # ── Dark-mode fixes ──
    'views/company/contact.ejs',
    'views/company/notices.ejs',
    'views/company/account.ejs',         # [dark-mode] inline style 제거

    # ── Admin views ──
    'views/admin/dashboard.ejs',
    'views/admin/search-stats.ejs',      # [dark-mode] JS 하드코딩
    'views/admin/inquiries.ejs',         # 이메일 발송 여부 체크박스

    # ── Shop account sidebar (admin link) ──
    'views/shop/account.ejs',
    'views/shop/account-orders.ejs',
    'views/shop/account-inquiries.ejs',

    # ── Cart 1-column CTA ──
    'views/shop/cart.ejs',

    # ── Wishlist dark-mode fix ──
    'views/shop/wishlist.ejs',
]

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.1.250', username='ras', password='12', timeout=20)
print('Connected to Pi')

sftp = client.open_sftp()
for rel in FILES:
    local  = os.path.join(WORKTREE, rel.replace('/', os.sep))
    remote = REMOTE_BASE + '/' + rel
    try:
        sftp.put(local, remote)
        print(f'  [OK] {rel}')
    except Exception as e:
        print(f'  [FAIL] {rel} -> {e}')
sftp.close()

def run(cmd, label):
    _, stdout, stderr = client.exec_command(cmd)
    out = (stdout.read() + stderr.read()).decode('utf-8', errors='replace').strip()
    print(f'\n=== {label} ===\n{out}')
    return out

run('pm2 restart all 2>&1', 'PM2 RESTART')
time.sleep(5)
run('tail -6 ~/.pm2/logs/company-site-out.log 2>&1', 'APP LOG')
run('tail -4 ~/.pm2/logs/company-site-error.log 2>&1', 'ERR LOG')

client.close()
print('\n=== DEPLOY COMPLETE ===')
