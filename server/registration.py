import random
import re
from datetime import datetime, timedelta

from werkzeug.security import generate_password_hash

from database import audit, get_conn, row_to_dict
from mail import MailDeliveryError, send_verification_email

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
ROLES_NEED_ADMIN = {"employee", "nurse_chief"}
CODE_TTL_MIN = 15


def _gen_code():
    return f"{random.randint(100000, 999999)}"


def _expires(minutes=CODE_TTL_MIN):
    return (datetime.now() + timedelta(minutes=minutes)).strftime("%Y-%m-%d %H:%M:%S")


def start_registration(data):
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""
    full_name = (data.get("full_name") or "").strip()
    email = (data.get("email") or "").strip().lower()
    role = data.get("role") or "employee"

    if len(username) < 3 or len(password) < 8 or len(full_name) < 3:
        raise ValueError("Логин ≥3, пароль ≥8 символов, укажите ФИО")
    if not EMAIL_RE.match(email):
        raise ValueError("Укажите корректный email")
    if role not in ("employee", "guard", "nurse_chief"):
        raise ValueError("Недопустимая роль для самостоятельной регистрации")
    if not (data.get("consent_pd") and data.get("consent_privacy") and data.get("consent_terms")):
        raise ValueError("Необходимо принять все обязательные согласия по 152-ФЗ")

    conn = get_conn()
    if conn.execute("SELECT 1 FROM users WHERE username=?", (username,)).fetchone():
        conn.close()
        raise ValueError("Пользователь с таким логином уже существует")
    if conn.execute("SELECT 1 FROM users WHERE email=?", (email,)).fetchone():
        conn.close()
        raise ValueError("Email уже используется")
    pending = conn.execute(
        "SELECT id, status FROM registration_requests WHERE username=? OR email=? ORDER BY id DESC LIMIT 1",
        (username, email),
    ).fetchone()
    if pending and pending["status"] in ("pending_email", "pending_admin"):
        conn.close()
        raise ValueError("Заявка на регистрацию уже создана — проверьте почту или дождитесь решения администратора")

    code = _gen_code()
    cur = conn.execute(
        """INSERT INTO registration_requests(
               username, password_hash, full_name, email, role,
               email_code, email_code_expires, consent_pd, consent_privacy, consent_terms,
               consent_notifications, status, admin_status
           ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            username,
            generate_password_hash(password),
            full_name,
            email,
            role,
            code,
            _expires(),
            1,
            1,
            1,
            1 if data.get("consent_notifications") else 0,
            "pending_email",
            "pending" if role in ROLES_NEED_ADMIN else "not_required",
        ),
    )
    req_id = cur.lastrowid
    conn.commit()
    conn.close()

    try:
        mail_info = send_verification_email(email, full_name, code)
    except MailDeliveryError as exc:
        conn = get_conn()
        conn.execute("DELETE FROM registration_requests WHERE id=?", (req_id,))
        conn.commit()
        conn.close()
        raise ValueError(str(exc)) from exc

    return {"request_id": req_id, "email": email, "role": role, "mail": mail_info}


def verify_email_code(request_id, code):
    conn = get_conn()
    req = conn.execute("SELECT * FROM registration_requests WHERE id=?", (request_id,)).fetchone()
    if not req:
        conn.close()
        raise ValueError("Заявка не найдена")
    if req["status"] != "pending_email":
        conn.close()
        raise ValueError("Email уже подтверждён или заявка обработана")
    if req["email_code_expires"] < datetime.now().strftime("%Y-%m-%d %H:%M:%S"):
        conn.close()
        raise ValueError("Код истёк — запросите новый")
    if str(code).strip() != str(req["email_code"]):
        conn.close()
        raise ValueError("Неверный код подтверждения")

    if req["role"] in ROLES_NEED_ADMIN:
        conn.execute(
            "UPDATE registration_requests SET status='pending_admin', email_verified=1, email_code=NULL WHERE id=?",
            (request_id,),
        )
        conn.commit()
        conn.close()
        audit(None, "EMAIL_VERIFIED", "registration_requests", request_id, {"next": "pending_admin"})
        return {
            "status": "pending_admin",
            "message": "Email подтверждён. Ожидайте одобрения администратора для ролей «Сотрудник» и «Старшая медсестра».",
        }

    user = _create_user_from_request(conn, req)
    conn.execute(
        "UPDATE registration_requests SET status='approved', email_verified=1, completed_at=datetime('now','localtime') WHERE id=?",
        (request_id,),
    )
    conn.commit()
    conn.close()
    audit(user["id"], "REGISTER_COMPLETE", "users", user["id"], {"via": "email"})
    return {"status": "approved", "message": "Регистрация завершена. Теперь можно войти.", "user": user}


def resend_code(request_id):
    conn = get_conn()
    req = conn.execute("SELECT * FROM registration_requests WHERE id=?", (request_id,)).fetchone()
    if not req or req["status"] != "pending_email":
        conn.close()
        raise ValueError("Нельзя отправить код для этой заявки")
    code = _gen_code()
    conn.execute(
        "UPDATE registration_requests SET email_code=?, email_code_expires=? WHERE id=?",
        (code, _expires(), request_id),
    )
    conn.commit()
    conn.close()
    mail_info = send_verification_email(req["email"], req["full_name"], code)
    return {"ok": True, "mail": mail_info}


def get_registration_status(request_id):
    conn = get_conn()
    req = conn.execute(
        "SELECT id, username, email, role, status, admin_status, email_verified, created_at, admin_note FROM registration_requests WHERE id=?",
        (request_id,),
    ).fetchone()
    conn.close()
    if not req:
        raise ValueError("Заявка не найдена")
    return row_to_dict(req)


def list_pending_registrations():
    conn = get_conn()
    rows = conn.execute(
        """SELECT id, username, full_name, email, role, status, admin_status, email_verified, created_at
           FROM registration_requests
           WHERE status IN ('pending_email','pending_admin')
           ORDER BY created_at DESC"""
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def approve_registration(request_id, admin_id, note=None):
    conn = get_conn()
    req = conn.execute("SELECT * FROM registration_requests WHERE id=?", (request_id,)).fetchone()
    if not req:
        conn.close()
        raise ValueError("Заявка не найдена")
    if req["status"] != "pending_admin":
        conn.close()
        raise ValueError("Заявка не ожидает решения администратора")
    if not req["email_verified"]:
        conn.close()
        raise ValueError("Email не подтверждён")

    user = _create_user_from_request(conn, req)
    conn.execute(
        """UPDATE registration_requests SET status='approved', admin_status='approved',
           approved_by=?, admin_note=?, completed_at=datetime('now','localtime') WHERE id=?""",
        (admin_id, note, request_id),
    )
    conn.commit()
    conn.close()
    audit(admin_id, "APPROVE_REGISTRATION", "registration_requests", request_id, {"user_id": user["id"]})
    return user


def reject_registration(request_id, admin_id, note=None):
    conn = get_conn()
    req = conn.execute("SELECT * FROM registration_requests WHERE id=?", (request_id,)).fetchone()
    if not req:
        conn.close()
        raise ValueError("Заявка не найдена")
    if req["status"] not in ("pending_email", "pending_admin"):
        conn.close()
        raise ValueError("Заявка уже обработана")
    conn.execute(
        """UPDATE registration_requests SET status='rejected', admin_status='rejected',
           approved_by=?, admin_note=?, completed_at=datetime('now','localtime') WHERE id=?""",
        (admin_id, note or "Отклонено администратором", request_id),
    )
    conn.commit()
    conn.close()
    audit(admin_id, "REJECT_REGISTRATION", "registration_requests", request_id)
    return {"ok": True}


def _create_user_from_request(conn, req):
    exists = conn.execute("SELECT 1 FROM users WHERE username=?", (req["username"],)).fetchone()
    if exists:
        raise ValueError("Пользователь уже создан")
    cur = conn.execute(
        """INSERT INTO users(username, password_hash, role, full_name, email, email_verified, is_active)
           VALUES (?,?,?,?,?,?,1)""",
        (req["username"], req["password_hash"], req["role"], req["full_name"], req["email"], 1),
    )
    uid = cur.lastrowid
    user = conn.execute(
        "SELECT id, username, role, full_name, email FROM users WHERE id=?", (uid,)
    ).fetchone()
    return dict(user)
