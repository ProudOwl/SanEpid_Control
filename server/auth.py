import os
from datetime import datetime, timedelta, timezone
from functools import wraps

import jwt
from flask import jsonify, request
from werkzeug.security import check_password_hash, generate_password_hash

from captcha import create_captcha, verify_captcha
from database import audit, get_conn, row_to_dict
from registration import (
    approve_registration,
    get_registration_status,
    list_pending_registrations,
    reject_registration,
    resend_code,
    start_registration,
    verify_email_code,
)

JWT_SECRET = os.environ.get("JWT_SECRET", "sanepid-jwt-secret-min-32-characters-long")
JWT_EXPIRE_DAYS = int(os.environ.get("JWT_EXPIRE_DAYS", "7"))


def create_token(user):
    payload = {
        "sub": str(user["id"]),
        "username": user["username"],
        "role": user["role"],
        "full_name": user["full_name"],
        "exp": datetime.now(timezone.utc) + timedelta(days=JWT_EXPIRE_DAYS),
        "iat": datetime.now(timezone.utc),
    }
    token = jwt.encode(payload, JWT_SECRET, algorithm="HS256")
    return token if isinstance(token, str) else token.decode("utf-8")


def decode_token(token):
    return jwt.decode(token, JWT_SECRET, algorithms=["HS256"])


def get_current_user():
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return None
    token = auth[7:]
    try:
        payload = decode_token(token)
    except jwt.PyJWTError:
        return None
    user_id = int(payload["sub"])
    conn = get_conn()
    user = conn.execute(
        "SELECT id, username, role, full_name, email FROM users WHERE id=? AND is_active=1",
        (user_id,),
    ).fetchone()
    conn.close()
    return row_to_dict(user)


def login_required(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        user = get_current_user()
        if not user:
            return jsonify({"error": "Требуется авторизация"}), 401
        request.current_user = user
        return f(*args, **kwargs)

    return wrapper


def roles_required(*roles):
    def decorator(f):
        @wraps(f)
        @login_required
        def wrapper(*args, **kwargs):
            if request.current_user["role"] not in roles:
                return jsonify({"error": "Недостаточно прав"}), 403
            return f(*args, **kwargs)

        return wrapper

    return decorator


def register_auth_routes(app):
    @app.get("/api/auth/captcha")
    def captcha_new():
        return jsonify(create_captcha())

    @app.post("/api/auth/register/start")
    def register_start():
        data = request.get_json(silent=True) or {}
        if not verify_captcha(data.get("captcha_id"), data.get("captcha_answer")):
            return jsonify({"error": "Неверная капча — попробуйте снова"}), 400
        try:
            result = start_registration(data)
            return jsonify(result), 201
        except ValueError as e:
            return jsonify({"error": str(e)}), 400

    @app.post("/api/auth/register/verify-email")
    def register_verify_email():
        data = request.get_json(silent=True) or {}
        rid = data.get("request_id")
        code = data.get("code")
        if not rid or not code:
            return jsonify({"error": "Укажите request_id и код"}), 400
        try:
            result = verify_email_code(int(rid), code)
            return jsonify(result)
        except ValueError as e:
            return jsonify({"error": str(e)}), 400

    @app.post("/api/auth/register/resend-code")
    def register_resend():
        data = request.get_json(silent=True) or {}
        rid = data.get("request_id")
        if not rid:
            return jsonify({"error": "Укажите request_id"}), 400
        try:
            return jsonify(resend_code(int(rid)))
        except ValueError as e:
            return jsonify({"error": str(e)}), 400

    @app.get("/api/auth/register/status/<int:rid>")
    def register_status(rid):
        try:
            return jsonify(get_registration_status(rid))
        except ValueError as e:
            return jsonify({"error": str(e)}), 404

    @app.get("/api/registrations/pending")
    @roles_required("admin")
    def registrations_pending():
        return jsonify({"items": list_pending_registrations()})

    @app.post("/api/registrations/<int:rid>/approve")
    @roles_required("admin")
    def registrations_approve(rid):
        data = request.get_json(silent=True) or {}
        try:
            user = approve_registration(rid, request.current_user["id"], data.get("note"))
            return jsonify({"ok": True, "user": user})
        except ValueError as e:
            return jsonify({"error": str(e)}), 400

    @app.post("/api/registrations/<int:rid>/reject")
    @roles_required("admin")
    def registrations_reject(rid):
        data = request.get_json(silent=True) or {}
        try:
            reject_registration(rid, request.current_user["id"], data.get("note"))
            return jsonify({"ok": True})
        except ValueError as e:
            return jsonify({"error": str(e)}), 400

    @app.post("/api/auth/login")
    def login():
        data = request.get_json(silent=True) or {}
        username = (data.get("username") or "").strip()
        password = data.get("password") or ""

        conn = get_conn()
        user = conn.execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()
        if not user:
            pending = conn.execute(
                "SELECT status FROM registration_requests WHERE username=? ORDER BY id DESC LIMIT 1",
                (username,),
            ).fetchone()
            conn.close()
            if pending and pending["status"] == "pending_admin":
                return jsonify({"error": "Регистрация ожидает одобрения администратора"}), 403
            if pending and pending["status"] == "pending_email":
                return jsonify({"error": "Подтвердите email — проверьте почту"}), 403
            return jsonify({"error": "Неверный логин или пароль"}), 401

        if not user["is_active"]:
            conn.close()
            return jsonify({"error": "Учётная запись деактивирована"}), 403

        if not check_password_hash(user["password_hash"], password):
            conn.close()
            return jsonify({"error": "Неверный логин или пароль"}), 401

        user_dict = row_to_dict(user)
        del user_dict["password_hash"]
        conn.close()
        audit(user["id"], "LOGIN", "users", user["id"])
        token = create_token(user_dict)
        return jsonify({"token": token, "user": user_dict})

    @app.get("/api/auth/me")
    @login_required
    def me():
        return jsonify({"user": request.current_user})
