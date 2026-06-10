import os
from pathlib import Path

DATA_DIR = Path(os.environ.get("LOCALAPPDATA", ".")) / "sanepid-monitor"
PROJECT_ROOT = Path(__file__).resolve().parent.parent


def load_env_file(path: Path):
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, val = line.split("=", 1)
        key, val = key.strip(), val.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = val


def bootstrap_config():
    load_env_file(PROJECT_ROOT / "config" / "smtp.env")
    load_env_file(DATA_DIR / "smtp.env")
    DATA_DIR.mkdir(parents=True, exist_ok=True)


def smtp_configured() -> bool:
    return bool(
        os.environ.get("SMTP_HOST", "").strip()
        and os.environ.get("SMTP_USER", "").strip()
        and os.environ.get("SMTP_PASSWORD", "").strip()
    )


def smtp_public_status() -> dict:
    host = os.environ.get("SMTP_HOST", "").strip()
    user = os.environ.get("SMTP_USER", "").strip()
    return {
        "configured": smtp_configured(),
        "host": host or None,
        "user_masked": (user[:2] + "***@" + user.split("@")[-1]) if "@" in user else None,
        "from": os.environ.get("SMTP_FROM", user) or None,
    }
