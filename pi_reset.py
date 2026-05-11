import sys, time
sys.stdout.reconfigure(encoding='utf-8')
import paramiko

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.1.250', username='ras', password='12', timeout=20)

def run(cmd, label=''):
    _, stdout, stderr = client.exec_command(cmd)
    out = (stdout.read() + stderr.read()).decode('utf-8', errors='replace').strip()
    if label:
        print(f'\n=== {label} ===\n{out}')
    else:
        print(out)
    return out

run('cd ~/apps/company-site && git stash',                                      'STASH')
run('cd ~/apps/company-site && git reset --hard origin/claude/wizardly-greider','RESET')
run('cd ~/apps/company-site && git stash drop 2>/dev/null || true',             'STASH DROP')
run('cd ~/apps/company-site && git status --short',                             'GIT STATUS (깨끗한지 확인)')
run('cd ~/apps/company-site && git log --oneline -3',                           'HEAD 확인')
run('pm2 restart all 2>&1 | cat',                                               'PM2 RESTART')
time.sleep(4)
run('tail -5 ~/.pm2/logs/company-site-out.log',                                 'APP LOG')
run('tail -3 ~/.pm2/logs/company-site-error.log',                               'ERR LOG')

client.close()
print('\n=== DONE ===')
