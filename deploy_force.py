import subprocess, sys, json, time

try:
    import paramiko
except ImportError:
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'paramiko', '-q'])
    import paramiko

def run(client, cmd, label='CMD'):
    stdin, stdout, stderr = client.exec_command(cmd, get_pty=False)
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    combined = (out + err).strip()
    sys.stdout.buffer.write(f'=== {label} ===\n{combined}\n\n'.encode('utf-8'))
    sys.stdout.flush()
    return combined

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.1.250', username='ras', password='12', timeout=20)

APP_DIR = '~/apps/company-site'

# 1. 현재 상태 확인
run(client, f'cd {APP_DIR} && git status --short 2>&1', 'GIT STATUS')

# 2. 로컬 변경사항 백업 후 강제 초기화
run(client, f'cd {APP_DIR} && git stash 2>&1', 'GIT STASH')

# 3. master 브랜치로 전환
run(client, f'cd {APP_DIR} && git checkout master 2>&1', 'CHECKOUT MASTER')

# 4. 원격 브랜치 fetch
run(client, f'cd {APP_DIR} && git fetch --all 2>&1', 'GIT FETCH')

# 5. wizardly-greider 브랜치를 master로 머지 (강제)
run(client, f'cd {APP_DIR} && git merge origin/claude/wizardly-greider -X theirs --no-edit 2>&1', 'GIT MERGE')

# 6. 현재 커밋 확인
run(client, f'cd {APP_DIR} && git log --oneline -5 2>&1', 'GIT LOG')

# 7. PM2 재시작
run(client, 'pm2 restart all 2>&1', 'PM2 RESTART')
time.sleep(4)

# 8. PM2 상태 확인
run(client, 'pm2 list 2>&1', 'PM2 STATUS')

# 9. 서버 로그 확인
run(client, 'tail -30 ~/.pm2/logs/company-site-out.log 2>&1', 'APP LOG (OUT)')
run(client, 'tail -20 ~/.pm2/logs/company-site-error.log 2>&1', 'APP LOG (ERR)')

client.close()
print('=== DEPLOY COMPLETE ===')
