import subprocess, sys

try:
    import paramiko
except ImportError:
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'paramiko', '-q'])
    import paramiko

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.1.250', username='ras', password='12', timeout=15)

# Read server dashboard.ejs
for f in ['views/admin/dashboard.ejs', 'views/layouts/admin-top.ejs']:
    stdin, stdout, stderr = client.exec_command(f'cat -n ~/apps/company-site/{f}', get_pty=False)
    out = stdout.read().decode('utf-8', errors='replace')
    sys.stdout.buffer.write((f'=== {f} ===\n' + out + '\n').encode('utf-8'))

client.close()
