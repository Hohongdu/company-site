import sys
sys.stdout.reconfigure(encoding='utf-8')
import paramiko

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.1.250', username='ras', password='12', timeout=20)

def run(cmd):
    _, stdout, stderr = client.exec_command(cmd)
    return (stdout.read() + stderr.read()).decode('utf-8', errors='replace').strip()

# Pi 로컬 수정 파일 vs 브랜치(origin/claude/wizardly-greider) 비교
FILES = [
    'app.js',
    'public/css/admin.css',
    'routes/admin.js',
    'routes/company.js',
    'routes/shop.js',
    'views/admin/partials/admin-header.ejs',
    'views/shop/wishlist.ejs',
]

print('=== Pi 로컬 파일 라인수 vs 브랜치 라인수 ===\n')
for f in FILES:
    pi_lines   = run(f'wc -l < ~/apps/company-site/{f}')
    branch_lines = run(f'cd ~/apps/company-site && git show origin/claude/wizardly-greider:{f} | wc -l')
    diff_stat  = run(f'cd ~/apps/company-site && git diff origin/claude/wizardly-greider -- {f} | tail -1')
    print(f'{f}')
    print(f'  Pi 로컬: {pi_lines}줄  |  브랜치: {branch_lines}줄  |  diff: {diff_stat}')

print('\n=== Pi 로컬 HEAD 커밋 vs 브랜치 마지막 커밋 ===')
print('Pi master HEAD:', run('cd ~/apps/company-site && git log --oneline -1'))
print('Branch HEAD:   ', run('cd ~/apps/company-site && git log --oneline origin/claude/wizardly-greider -1'))

client.close()
