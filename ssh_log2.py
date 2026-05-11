import subprocess, sys

try:
    import paramiko
except ImportError:
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'paramiko', '-q'])
    import paramiko

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.1.250', username='ras', password='12', timeout=15)

# Check error log for any EJS / syntax errors since last restart
stdin, stdout, stderr = client.exec_command(
    'tail -30 ~/.pm2/logs/company-site-error.log 2>&1', get_pty=False
)
out = stdout.read().decode('utf-8', errors='replace')
sys.stdout.buffer.write(('=== ERROR LOG (last 30) ===\n' + out + '\n').encode('utf-8'))

# Check out log
stdin, stdout, stderr = client.exec_command(
    'tail -10 ~/.pm2/logs/company-site-out.log 2>&1', get_pty=False
)
out = stdout.read().decode('utf-8', errors='replace')
sys.stdout.buffer.write(('=== OUT LOG (last 10) ===\n' + out + '\n').encode('utf-8'))

# Check PM2 status
stdin, stdout, stderr = client.exec_command('pm2 list 2>&1', get_pty=False)
out = stdout.read().decode('utf-8', errors='replace')
sys.stdout.buffer.write(('=== PM2 STATUS ===\n' + out).encode('utf-8'))

client.close()
