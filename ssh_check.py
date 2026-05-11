import subprocess, sys

try:
    import paramiko
except ImportError:
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'paramiko', '-q'])
    import paramiko

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.1.250', username='ras', password='12', timeout=15)

# Read the problematic file
stdin, stdout, stderr = client.exec_command(
    'cat -n ~/apps/company-site/routes/auth.js | tail -30', get_pty=False
)
out = stdout.read().decode('utf-8', errors='replace')
sys.stdout.buffer.write(('=== auth.js (last 30 lines) ===\n' + out + '\n').encode('utf-8'))

client.close()
