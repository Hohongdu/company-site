import subprocess, sys, time

try:
    import paramiko
except ImportError:
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'paramiko', '-q'])
    import paramiko

sys.stdout.reconfigure(encoding='utf-8')

BRANCH = 'master'

def run(client, cmd, label='CMD'):
    _, stdout, stderr = client.exec_command(cmd, get_pty=False)
    combined = (stdout.read() + stderr.read()).decode('utf-8', errors='replace').strip()
    print(f'=== {label} ===\n{combined}\n')
    return combined

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.1.250', username='ras', password='12', timeout=20)

# fetch 최신
run(client, 'cd ~/apps/company-site && git fetch origin 2>&1', 'GIT FETCH')

# fast-forward pull (merge 없이 브랜치 최신으로 이동)
result = run(client, f'cd ~/apps/company-site && git pull origin {BRANCH} --ff-only 2>&1', 'GIT PULL (ff-only)')

# ff-only 실패 시 안전하게 reset
if 'error' in result.lower() or 'fatal' in result.lower():
    print('[!] ff-only 실패 — reset --hard 로 강제 동기화')
    run(client, f'cd ~/apps/company-site && git reset --hard origin/{BRANCH} 2>&1', 'GIT RESET')

run(client, 'cd ~/apps/company-site && git log --oneline -3 2>&1', 'HEAD')
run(client, 'cd ~/apps/company-site && git status --short 2>&1', 'GIT STATUS')

# PM2 재시작
run(client, 'pm2 restart all 2>&1 | cat', 'PM2 RESTART')
time.sleep(4)

run(client, 'pm2 list 2>&1 | cat', 'PM2 STATUS')
run(client, 'tail -10 ~/.pm2/logs/company-site-out.log 2>&1', 'APP LOG (OUT)')
run(client, 'tail -5 ~/.pm2/logs/company-site-error.log 2>&1', 'APP LOG (ERR)')

client.close()
print('=== DEPLOY COMPLETE ===')
