import subprocess, sys, json

try:
    import paramiko
except ImportError:
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'paramiko', '-q'])
    import paramiko

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.1.250', username='ras', password='12', timeout=15)

# git pull
stdin, stdout, stderr = client.exec_command('cd ~/apps/company-site && git pull 2>&1', get_pty=False)
out = stdout.read().decode('utf-8', errors='replace')
sys.stdout.buffer.write(('=== GIT PULL ===\n' + out + '\n').encode('utf-8'))

# pm2 restart
stdin, stdout, stderr = client.exec_command('pm2 restart all 2>&1', get_pty=False)
out = stdout.read().decode('utf-8', errors='replace')
sys.stdout.buffer.write(('=== PM2 RESTART ===\n' + out + '\n').encode('utf-8'))

# pm2 status
import time; time.sleep(2)
stdin, stdout, stderr = client.exec_command('pm2 jlist', get_pty=False)
procs_json = stdout.read().decode('utf-8', errors='replace')
try:
    procs = json.loads(procs_json)
    for p in procs:
        status = p['pm2_env']['status']
        name = p['name']
        pid = p.get('pid', '?')
        uptime = p['pm2_env'].get('pm_uptime', 0)
        sys.stdout.buffer.write(f'[PM2] {name} | {status} | pid={pid}\n'.encode('utf-8'))
except Exception as e:
    sys.stdout.buffer.write(f'[PM2 error] {e}\n'.encode('utf-8'))

# last 5 log lines to confirm server started
stdin, stdout, stderr = client.exec_command(
    'tail -5 ~/.pm2/logs/company-site-out.log 2>&1', get_pty=False
)
out = stdout.read().decode('utf-8', errors='replace')
sys.stdout.buffer.write(('=== LAST LOG ===\n' + out).encode('utf-8'))

client.close()
