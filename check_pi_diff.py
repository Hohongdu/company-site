import sys
sys.stdout.reconfigure(encoding='utf-8')
import paramiko

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.1.250', username='ras', password='12', timeout=20)

def run(cmd):
    _, stdout, stderr = client.exec_command(cmd)
    return (stdout.read() + stderr.read()).decode('utf-8', errors='replace').strip()

print('=== git status ===')
print(run('cd ~/apps/company-site && git status --short'))

print('\n=== diff --stat vs origin/master ===')
print(run('cd ~/apps/company-site && git diff --stat origin/master'))

print('\n=== local branch / HEAD ===')
print(run('cd ~/apps/company-site && git log --oneline -5'))

print('\n=== origin/master log ===')
print(run('cd ~/apps/company-site && git log --oneline origin/master -5'))

client.close()
