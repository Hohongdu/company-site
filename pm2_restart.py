import sys, time
sys.stdout.reconfigure(encoding='utf-8')

import paramiko

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.1.250', username='ras', password='12', timeout=20)

def run(cmd):
    _, stdout, stderr = client.exec_command(cmd)
    return (stdout.read() + stderr.read()).decode('utf-8', errors='replace').strip()

print(run('pm2 restart all 2>&1 | cat'))
time.sleep(4)
print('LOG:', run('tail -5 ~/.pm2/logs/company-site-out.log'))
print('ERR:', run('tail -3 ~/.pm2/logs/company-site-error.log'))
client.close()
print('DONE')
