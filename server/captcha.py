import base64
import hashlib
import os
import random
import uuid
from datetime import datetime, timedelta

from database import get_conn

CAPTCHA_TTL_MIN = 10
CAPTCHA_SECRET = os.environ.get("JWT_SECRET", "sanepid-captcha-secret")
CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def _hash_answer(answer: str) -> str:
    return hashlib.sha256(f"{CAPTCHA_SECRET}:{answer.strip().upper()}".encode()).hexdigest()


def _random_code(length=6):
    return "".join(random.choice(CHARS) for _ in range(length))


def _svg_image(code: str) -> str:
    w, h = 220, 72
    lines = []
    for _ in range(6):
        x1, y1 = random.randint(0, w), random.randint(0, h)
        x2, y2 = random.randint(0, w), random.randint(0, h)
        c = random.choice(["#0077b6", "#00a896", "#5b7a8f", "#e09f3e"])
        lines.append(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{c}" stroke-width="1" opacity=".35"/>')
    dots = "".join(
        f'<circle cx="{random.randint(0,w)}" cy="{random.randint(0,h)}" r="1.5" fill="#5b7a8f" opacity=".4"/>'
        for _ in range(30)
    )
    letters = []
    slot = w / (len(code) + 1)
    for i, ch in enumerate(code):
        x = int(slot * (i + 1))
        y = random.randint(42, 54)
        rot = random.randint(-18, 18)
        size = random.randint(26, 32)
        color = random.choice(["#123047", "#0077b6", "#005f92", "#2a9d8f"])
        letters.append(
            f'<text x="{x}" y="{y}" font-family="Consolas,monospace" font-size="{size}" '
            f'font-weight="700" fill="{color}" transform="rotate({rot} {x} {y})">{ch}</text>'
        )
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">'
        f'<rect width="100%" height="100%" fill="#f0f7fb" rx="8"/>'
        f'{"".join(lines)}{dots}{"".join(letters)}</svg>'
    )
    b64 = base64.b64encode(svg.encode("utf-8")).decode("ascii")
    return f"data:image/svg+xml;base64,{b64}"


def create_captcha():
    code = _random_code()
    cid = str(uuid.uuid4())
    expires = (datetime.now() + timedelta(minutes=CAPTCHA_TTL_MIN)).strftime("%Y-%m-%d %H:%M:%S")
    conn = get_conn()
    conn.execute("DELETE FROM captcha_challenges WHERE expires_at < datetime('now','localtime')")
    conn.execute(
        "INSERT INTO captcha_challenges(id, answer_hash, expires_at) VALUES (?,?,?)",
        (cid, _hash_answer(code), expires),
    )
    conn.commit()
    conn.close()
    return {"captcha_id": cid, "image": _svg_image(code), "hint": "Введите символы с картинки (без учёта регистра)"}


def verify_captcha(captcha_id, answer):
    if not captcha_id or answer is None:
        return False
    conn = get_conn()
    row = conn.execute(
        "SELECT answer_hash, expires_at FROM captcha_challenges WHERE id=?",
        (str(captcha_id),),
    ).fetchone()
    if not row:
        conn.close()
        return False
    if row["expires_at"] < datetime.now().strftime("%Y-%m-%d %H:%M:%S"):
        conn.execute("DELETE FROM captcha_challenges WHERE id=?", (str(captcha_id),))
        conn.commit()
        conn.close()
        return False
    ok = row["answer_hash"] == _hash_answer(str(answer).strip())
    conn.execute("DELETE FROM captcha_challenges WHERE id=?", (str(captcha_id),))
    conn.commit()
    conn.close()
    return ok
