import subprocess, sys, json

try:
    import paramiko
except ImportError:
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'paramiko', '-q'])
    import paramiko

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('192.168.1.250', username='ras', password='12', timeout=30)

# Checkout ALL view/css/route files from our clean feature branch
# This replaces any merge-broken files with the correct version
files = [
    'public/css/admin.css',
    'public/css/company.css',
    'public/css/main.css',
    'public/css/shop.css',
    'routes/auth.js',
    'views/admin/partials/admin-header.ejs',
    'views/admin/partials/admin-footer.ejs',
    'views/auth/forgot.ejs',
    'views/auth/login.ejs',
    'views/auth/register.ejs',
    'views/company/about.ejs',
    'views/company/contact.ejs',
    'views/company/history.ejs',
    'views/company/index.ejs',
    'views/company/notice-detail.ejs',
    'views/company/notices.ejs',
    'views/layouts/company-bottom.ejs',
    'views/layouts/company-top.ejs',
    'views/layouts/shop-bottom.ejs',
    'views/layouts/shop-top.ejs',
    'views/shop/account-inquiries.ejs',
    'views/shop/account-orders.ejs',
    'views/shop/account.ejs',
    'views/shop/cart.ejs',
    'views/shop/index.ejs',
    'views/shop/product-detail.ejs',
    'views/shop/products.ejs',
]

files_str = ' '.join(files)
cmd = f'cd ~/apps/company-site && git fetch origin && git checkout origin/claude/wizardly-greider -- {files_str} 2>&1'
stdin, stdout, stderr = client.exec_command(cmd, get_pty=False)
out = stdout.read().decode('utf-8', errors='replace')
sys.stdout.buffer.write(('=== CHECKOUT CLEAN FILES ===\n' + out + '\n').encode('utf-8'))

# PM2 restart
stdin, stdout, stderr = client.exec_command('pm2 restart all 2>&1', get_pty=False)
out = stdout.read().decode('utf-8', errors='replace')
sys.stdout.buffer.write(('=== PM2 RESTART ===\n' + out + '\n').encode('utf-8'))

# Wait and check logs
import time; time.sleep(4)
stdin, stdout, stderr = client.exec_command('tail -10 ~/.pm2/logs/company-site-out.log 2>&1', get_pty=False)
out = stdout.read().decode('utf-8', errors='replace')
sys.stdout.buffer.write(('=== OUT LOG ===\n' + out + '\n').encode('utf-8'))

stdin, stdout, stderr = client.exec_command('tail -5 ~/.pm2/logs/company-site-error.log 2>&1', get_pty=False)
out = stdout.read().decode('utf-8', errors='replace')
sys.stdout.buffer.write(('=== ERROR LOG (last 5) ===\n' + out + '\n').encode('utf-8'))

# PM2 status
stdin, stdout, stderr = client.exec_command('pm2 jlist', get_pty=False)
procs_json = stdout.read().decode('utf-8', errors='replace')
try:
    procs = json.loads(procs_json)
    for p in procs:
        sys.stdout.buffer.write(
            f'[PM2] {p["name"]} | {p["pm2_env"]["status"]} | pid={p.get("pid","?")} | restarts={p["pm2_env"].get("restart_time","?")}\n'
            .encode('utf-8')
        )
except Exception as e:
    sys.stdout.buffer.write(f'[PM2 error] {e}\n'.encode('utf-8'))

client.close()
