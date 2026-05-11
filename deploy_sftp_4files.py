import sys, time

try:
    import paramiko
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'paramiko', '-q'])
    import paramiko

import os

WORKTREE = r'C:\Users\pke03\company-site\.claude\worktrees\wizardly-greider'
REMOTE_BASE = '/home/ras/apps/company-site'

FILES = [
    ('public/css/main.css',     'public/css/main.css'),
    ('public/css/company.css',  'public/css/company.css'),
    ('public/js/main.js',       'public/js/main.js'),
    ('views/company/index.ejs', 'views/company/index.ejs'),
]

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.1.250', username='ras', password='12', timeout=20)
print('Connected to Pi')

sftp = client.open_sftp()
for local_rel, remote_rel in FILES:
    local_path  = os.path.join(WORKTREE, local_rel.replace('/', os.sep))
    remote_path = REMOTE_BASE + '/' + remote_rel
    sftp.put(local_path, remote_path)
    print(f'  uploaded: {remote_rel}')
sftp.close()

def run(cmd, label):
    _, stdout, stderr = client.exec_command(cmd)
    out = (stdout.read() + stderr.read()).decode('utf-8', errors='replace').strip()
    print(f'\n=== {label} ===\n{out}')
    return out

run('pm2 restart all 2>&1', 'PM2 RESTART')
time.sleep(4)
run('tail -8 ~/.pm2/logs/company-site-out.log 2>&1', 'APP LOG')
run('tail -5 ~/.pm2/logs/company-site-error.log 2>&1', 'ERR LOG')

client.close()
print('\n=== DEPLOY COMPLETE ===')
