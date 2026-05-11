import subprocess, sys, json, time

try:
    import paramiko
except ImportError:
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'paramiko', '-q'])
    import paramiko

worktree = r'C:\Users\pke03\company-site\.claude\worktrees\wizardly-greider'
files_to_upload = [
    ('public/css/admin.css', '/home/ras/apps/company-site/public/css/admin.css'),
    ('views/admin/dashboard.ejs', '/home/ras/apps/company-site/views/admin/dashboard.ejs'),
    ('views/admin/partials/admin-header.ejs', '/home/ras/apps/company-site/views/admin/partials/admin-header.ejs'),
]

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.1.250', username='ras', password='12', timeout=30)
sftp = client.open_sftp()

for local_rel, remote_path in files_to_upload:
    local_path = worktree + '\\' + local_rel.replace('/', '\\')
    with open(local_path, 'rb') as f:
        content = f.read()
    with sftp.open(remote_path, 'wb') as f:
        f.write(content)
    sys.stdout.buffer.write(('[UPLOAD] ' + local_rel + '\n').encode('utf-8'))

sftp.close()

# PM2 restart
stdin, stdout, stderr = client.exec_command('pm2 restart all 2>&1', get_pty=False)
out = stdout.read().decode('utf-8', errors='replace')
sys.stdout.buffer.write(('=== PM2 RESTART ===\n' + out + '\n').encode('utf-8'))

time.sleep(4)

# Check logs
stdin, stdout, stderr = client.exec_command('tail -10 ~/.pm2/logs/company-site-out.log 2>&1', get_pty=False)
out = stdout.read().decode('utf-8', errors='replace')
sys.stdout.buffer.write(('=== OUT LOG ===\n' + out + '\n').encode('utf-8'))

stdin, stdout, stderr = client.exec_command('tail -8 ~/.pm2/logs/company-site-error.log 2>&1', get_pty=False)
out = stdout.read().decode('utf-8', errors='replace')
sys.stdout.buffer.write(('=== ERROR LOG ===\n' + out + '\n').encode('utf-8'))

# PM2 status
stdin, stdout, stderr = client.exec_command('pm2 jlist', get_pty=False)
procs = json.loads(stdout.read().decode('utf-8', errors='replace'))
for p in procs:
    sys.stdout.buffer.write(
        ('[PM2] ' + p['name'] + ' | ' + p['pm2_env']['status'] + ' | pid=' + str(p.get('pid','?')) + ' | restarts=' + str(p['pm2_env'].get('restart_time','?')) + '\n')
        .encode('utf-8')
    )

client.close()
