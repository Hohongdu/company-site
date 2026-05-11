import subprocess, sys, json

try:
    import paramiko
except ImportError:
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'paramiko', '-q'])
    import paramiko

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.1.250', username='ras', password='12', timeout=15)

# Fix: checkout the clean auth.js from our feature branch, then restart
cmds = [
    'cd ~/apps/company-site && git checkout origin/claude/wizardly-greider -- routes/auth.js',
    'cd ~/apps/company-site && node -e "require(\'./routes/auth.js\'); console.log(\'syntax ok\')" 2>&1',
    'pm2 restart all 2>&1',
]

for cmd in cmds:
    stdin, stdout, stderr = client.exec_command(cmd, get_pty=False)
    out = stdout.read().decode('utf-8', errors='replace')
    sys.stdout.buffer.write((f'=== {cmd[:50]} ===\n' + out + '\n').encode('utf-8'))

# pm2 status
stdin, stdout, stderr = client.exec_command('pm2 jlist', get_pty=False)
procs_json = stdout.read().decode('utf-8', errors='replace')
try:
    procs = json.loads(procs_json)
    for p in procs:
        status = p['pm2_env']['status']
        name = p['name']
        restarts = p['pm2_env'].get('restart_time', '?')
        sys.stdout.buffer.write(f'[PM2] {name} | {status} | restarts={restarts}\n'.encode('utf-8'))
except Exception as e:
    sys.stdout.buffer.write(f'[PM2 error] {e}\n'.encode('utf-8'))

client.close()
