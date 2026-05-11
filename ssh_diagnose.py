import subprocess, sys

try:
    import paramiko
except ImportError:
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'paramiko', '-q'])
    import paramiko

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.1.250', username='ras', password='12', timeout=15)

# Read admin-header.ejs on server
stdin, stdout, stderr = client.exec_command(
    'cat -n ~/apps/company-site/views/admin/partials/admin-header.ejs', get_pty=False
)
out = stdout.read().decode('utf-8', errors='replace')
sys.stdout.buffer.write(('=== admin-header.ejs ===\n' + out + '\n').encode('utf-8'))

# Also check full pm2 error log (last 40 lines)
stdin, stdout, stderr = client.exec_command(
    'tail -40 ~/.pm2/logs/company-site-error.log 2>&1', get_pty=False
)
out = stdout.read().decode('utf-8', errors='replace')
sys.stdout.buffer.write(('=== PM2 ERROR LOG ===\n' + out).encode('utf-8'))

client.close()
