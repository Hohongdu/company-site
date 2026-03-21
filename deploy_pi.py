import paramiko
import sys

host = "192.168.1.250"
user = "ras"
password = "12"

checkout_files = (
    "lib/flash.js views/partials/flash.ejs app.js "
    "public/css/company.css public/css/shop.css public/js/main.js "
    "routes/admin/products.js routes/shop/account.js routes/shop/cart.js "
    "views/auth/register.ejs views/company/contact.ejs "
    "views/layouts/admin-bottom.ejs views/layouts/company-bottom.ejs views/layouts/shop-bottom.ejs "
    "views/shop/order-complete.ejs"
)

commands = [
    "cd ~/apps/company-site && git fetch origin",
    f"cd ~/apps/company-site && git checkout origin/claude/epic-sammet -- {checkout_files}",
    "cd ~/apps/company-site && npm install --production",
    "pm2 restart all",
    "sleep 3",
    'curl -s -o /dev/null -w "home:%{http_code}" http://localhost:3000/',
    'curl -s -o /dev/null -w " shop:%{http_code}" http://localhost:3000/shop',
    'curl -s -o /dev/null -w " admin:%{http_code}" http://localhost:3000/admin',
]

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

pm2_failed = False

try:
    print(f"Connecting to {host} as {user}...")
    client.connect(host, username=user, password=password, timeout=30)
    print("Connected.\n")

    for cmd in commands:
        print(f">>> {cmd}")
        stdin, stdout, stderr = client.exec_command(cmd, timeout=120)
        out_raw = stdout.read().decode("utf-8", errors="replace").strip()
        err_raw = stderr.read().decode("utf-8", errors="replace").strip()
        # Encode to local stdout safely
        out = out_raw.encode(sys.stdout.encoding, errors="replace").decode(sys.stdout.encoding, errors="replace")
        err = err_raw.encode(sys.stdout.encoding, errors="replace").decode(sys.stdout.encoding, errors="replace")
        exit_code = stdout.channel.recv_exit_status()
        if out:
            print(f"STDOUT: {out}")
        if err:
            print(f"STDERR: {err}")
        print(f"Exit code: {exit_code}\n")

        if exit_code != 0 and "curl" not in cmd and "sleep" not in cmd:
            if "pm2 restart" in cmd:
                print("WARNING: pm2 restart failed. Capturing pm2 logs...")
                pm2_failed = True
                # Capture pm2 logs
                log_stdin, log_stdout, log_stderr = client.exec_command(
                    "pm2 logs --lines 20 --nostream", timeout=30
                )
                log_out = log_stdout.read().decode("utf-8", errors="replace").strip()
                log_err = log_stderr.read().decode("utf-8", errors="replace").strip()
                log_out = log_out.encode(sys.stdout.encoding, errors="replace").decode(sys.stdout.encoding, errors="replace")
                log_err = log_err.encode(sys.stdout.encoding, errors="replace").decode(sys.stdout.encoding, errors="replace")
                if log_out:
                    print(f"PM2 LOGS (stdout):\n{log_out}")
                if log_err:
                    print(f"PM2 LOGS (stderr):\n{log_err}")
                print("Aborting after pm2 failure.")
                sys.exit(1)
            else:
                print(f"ERROR: Command failed with exit code {exit_code}. Aborting.")
                sys.exit(1)

    print("Deployment complete.")

except SystemExit:
    raise
except Exception as e:
    print(f"FATAL: {e}")
    sys.exit(1)
finally:
    client.close()
