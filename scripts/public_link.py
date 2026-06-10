"""Create a public URL for the local SanEpid server (works on phones/laptops)."""
import os
import re
import socket
import subprocess
import sys
import time
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOLS = os.path.join(ROOT, "tools")
URL_FILE = os.path.join(ROOT, "PUBLIC_URL.txt")
QR_FILE = os.path.join(ROOT, "PUBLIC_QR.html")
PORT = int(os.environ.get("PORT", "8080"))

def log(msg):
    print(msg, flush=True)


def port_open(port):
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=2):
            return True
    except OSError:
        return False


def wait_server(port, seconds=45):
    log(f"Checking server on http://127.0.0.1:{port} ...")
    for i in range(seconds):
        if port_open(port):
            try:
                with urllib.request.urlopen(
                    f"http://127.0.0.1:{port}/api/health", timeout=3
                ) as r:
                    if r.status == 200:
                        log("Server OK")
                        return True
            except Exception:
                if port_open(port):
                    log("Server port open")
                    return True
        if i == 0:
            log("Waiting for START.bat ...")
        time.sleep(1)
    return False


def save_url(url, port):
    with open(URL_FILE, "w", encoding="utf-8") as f:
        f.write(
            f"{url}\n\n"
            "=== Для телефона / другого ноутбука ===\n"
            "Откройте ссылку выше в Safari или Chrome (нужен интернет).\n"
            "Или отсканируйте QR: откройте файл PUBLIC_QR.html\n\n"
            f"Local (только этот ПК): http://127.0.0.1:{port}\n\n"
            "ВАЖНО: не закрывайте окно PUBLIC.bat на этом компьютере!\n"
        )


def write_qr_page(url):
    q = urllib.parse.quote(url, safe="")
    html = f"""<!DOCTYPE html>
<html lang="ru"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>SanEpid — ссылка для телефона</title>
<style>
body{{font-family:Segoe UI,system-ui;text-align:center;padding:1.5rem;background:#0a1628;color:#fff;max-width:420px;margin:0 auto}}
h1{{font-size:1.35rem;margin-bottom:.5rem}}
img{{margin:1rem 0;border-radius:12px;background:#fff;padding:8px}}
a{{color:#2a9d8f;font-size:1rem;word-break:break-all}}
.warn{{color:#e09f3e;font-size:.9rem;margin-top:1.5rem;line-height:1.5}}
.ok{{color:#2a9d8f;font-size:.95rem}}
</style></head><body>
<h1>SanEpid Control</h1>
<p class="ok">Сканируйте камерой телефона:</p>
<img width="280" height="280" alt="QR"
 src="https://api.qrserver.com/v1/create-qr-code/?size=280x280&data={q}">
<p>Или введите в браузере телефона:</p>
<p><a href="{url}">{url}</a></p>
<p class="warn">Не закрывайте окно PUBLIC.bat на компьютере — иначе ссылка перестанет работать.</p>
</body></html>"""
    with open(QR_FILE, "w", encoding="utf-8") as f:
        f.write(html)


def verify_url(url):
    """Must return JSON health from the public internet, not 'no tunnel here'."""
    try:
        with urllib.request.urlopen(f"{url.rstrip('/')}/api/health", timeout=25) as r:
            body = r.read(500).decode("utf-8", errors="replace")
            return r.status == 200 and '"status"' in body and "ok" in body
    except Exception:
        return False


def find_url_in_text(text):
    m = re.search(
        r"tunneled with tls termination,\s*(https://[a-z0-9]+\.lhr\.life)",
        text,
        re.I,
    )
    if m:
        return m.group(1)
    m = re.search(r"https://[a-z0-9]+\.lhr\.life", text)
    if m:
        return m.group(0)
    m = re.search(r"https://[a-z0-9-]+\.trycloudflare\.com", text)
    if m:
        return m.group(0)
    return None


def run_tunnel_localhost_run(port):
    log("Creating link via localhost.run ...")
    os.makedirs(TOOLS, exist_ok=True)
    out = os.path.join(TOOLS, "tunnel.out")
    err = os.path.join(TOOLS, "tunnel.err")
    for p in (out, err):
        try:
            os.remove(p)
        except OSError:
            pass

    with open(out, "w", encoding="utf-8", errors="replace") as fo, open(
        err, "w", encoding="utf-8", errors="replace"
    ) as fe:
        proc = subprocess.Popen(
            [
                "ssh",
                "-o",
                "StrictHostKeyChecking=no",
                "-o",
                "UserKnownHostsFile=NUL",
                "-o",
                "ServerAliveInterval=30",
                "-R",
                f"80:127.0.0.1:{port}",
                "nokey@localhost.run",
            ],
            stdout=fo,
            stderr=fe,
            cwd=ROOT,
        )

    url = None
    for _ in range(50):
        time.sleep(1)
        text = ""
        for p in (out, err):
            if os.path.isfile(p):
                try:
                    text += open(p, encoding="utf-8", errors="replace").read()
                except OSError:
                    pass
        url = find_url_in_text(text)
        if url and "admin.localhost.run" not in url:
            return proc, url
    proc.terminate()
    return None, None


def run_tunnel_cloudflare(port):
    log("Trying Cloudflare tunnel ...")
    os.makedirs(TOOLS, exist_ok=True)
    cf = os.path.join(TOOLS, "cloudflared.exe")
    if not os.path.isfile(cf):
        log("Downloading cloudflared ...")
        urllib.request.urlretrieve(
            "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe",
            cf,
        )

    log_path = os.path.join(TOOLS, "tunnel.cf.log")
    try:
        os.remove(log_path)
    except OSError:
        pass

    env = os.environ.copy()
    env["TUNNEL_TRANSPORT_PROTOCOL"] = "http2"

    with open(log_path, "w", encoding="utf-8", errors="replace") as f:
        proc = subprocess.Popen(
            [cf, "tunnel", "--url", f"http://127.0.0.1:{port}", "--protocol", "http2"],
            stdout=f,
            stderr=subprocess.STDOUT,
            cwd=ROOT,
            env=env,
        )

    url = None
    for _ in range(60):
        time.sleep(1)
        if os.path.isfile(log_path):
            text = open(log_path, encoding="utf-8", errors="replace").read()
            url = find_url_in_text(text)
            if url:
                return proc, url
    proc.terminate()
    return None, None


def main():
    log("=== SanEpid Public Link ===")
    if not wait_server(PORT):
        log("")
        log(f"ERROR: nothing listens on port {PORT}")
        log("1) Run START.bat first")
        log("2) Open http://127.0.0.1:8080 in browser")
        log("3) Run PUBLIC.bat again")
        return 1

    proc, url = run_tunnel_localhost_run(PORT)
    if not url:
        proc, url = run_tunnel_cloudflare(PORT)

    if not url:
        log("")
        log("ERROR: could not create public link.")
        log("Try Render.com — see DEPLOY.md")
        return 1

    log("Checking link from internet (for phones/other PCs)...")
    verified = False
    for _ in range(12):
        if verify_url(url):
            verified = True
            break
        time.sleep(2)
    if not verified:
        log("ERROR: link created but not reachable from outside.")
        log("Check firewall / try again or use Render.com (DEPLOY.md)")
        proc.terminate()
        return 1

    log("Link OK — works on phones and other devices")

    save_url(url, PORT)
    write_qr_page(url)
    log("")
    log("PUBLIC LINK (open on phone / any device):")
    log(url)
    log("")
    log(f"Saved: {URL_FILE}")
    log(f"QR code page: {QR_FILE}")
    log("")
    log("Scan QR in PUBLIC_QR.html with your phone camera.")
    log("Do NOT close this window — link dies if you close it!")
    log("")

    try:
        os.startfile(QR_FILE)
    except OSError:
        try:
            os.startfile(url)
        except OSError:
            pass

    try:
        proc.wait()
    except KeyboardInterrupt:
        proc.terminate()
    return 0


if __name__ == "__main__":
    sys.exit(main())
