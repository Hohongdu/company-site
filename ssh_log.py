import subprocess, sys

try:
    import paramiko
except ImportError:
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'paramiko', '-q'])
    import paramiko

import time
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.1.250', username='ras', password='12', timeout=15)

# wait 3 seconds then check logs
time.sleep(3)
stdin, stdout, stderr = client.exec_command('pm2 logs company-site --lines 20 --nostream 2>&1', get_pty=False)
out = stdout.read().decode('utf-8', errors='replace')
sys.stdout.buffer.write(out.encode('utf-8'))

client.close()
