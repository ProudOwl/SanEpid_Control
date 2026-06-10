import os
from datetime import datetime

from flask import Flask, jsonify, request, send_from_directory
from werkzeug.security import generate_password_hash

from auth import login_required, register_auth_routes, roles_required
from config import bootstrap_config, smtp_configured, smtp_public_status
from database import (
    audit,
    check_employee_compliance,
    compute_compliance_index,
    get_conn,
    has_zone_permission,
    init_db,
    row_to_dict,
    rows_to_list,
)

STATIC_DIR = os.environ.get("STATIC_DIR", os.path.join(os.path.dirname(__file__), "..", "frontend"))
PORT = int(os.environ.get("PORT", "8080"))
HOST = os.environ.get("BIND_HOST", "127.0.0.1")

app = Flask(__name__, static_folder=None)
register_auth_routes(app)


def paginate(query, params=(), page=1, per_page=20):
    conn = get_conn()
    total = conn.execute(f"SELECT COUNT(*) c FROM ({query}) t", params).fetchone()["c"]
    offset = (page - 1) * per_page
    rows = conn.execute(f"{query} LIMIT ? OFFSET ?", (*params, per_page, offset)).fetchall()
    conn.close()
    return rows_to_list(rows), total


@app.get("/api/health")
def health():
    return jsonify({
        "status": "ok",
        "service": "SanEpid Access Control",
        "smtp_configured": smtp_configured(),
        "smtp": smtp_public_status(),
    })


@app.get("/api/admin/settings")
@login_required
@roles_required("admin")
def admin_settings():
    return jsonify({"smtp": smtp_public_status()})


@app.post("/api/admin/smtp-test")
@login_required
@roles_required("admin")
def admin_smtp_test():
    from mail import MailDeliveryError, send_test_email

    data = request.get_json(silent=True) or {}
    to_email = (data.get("email") or request.current_user.get("email") or "").strip()
    if not to_email:
        return jsonify({"error": "Укажите email для теста"}), 400
    try:
        info = send_test_email(to_email, request.current_user.get("full_name") or "Администратор")
        audit(request.current_user["id"], "SMTP_TEST", "settings", None, {"to": to_email})
        return jsonify({"ok": True, "message": f"Тестовое письмо отправлено на {to_email}", "mail": info})
    except MailDeliveryError as exc:
        return jsonify({"error": str(exc)}), 503


@app.get("/api/live/overview")
@login_required
def live_overview():
    conn = get_conn()
    feed = rows_to_list(
        conn.execute(
            """SELECT al.event_time, al.direction, al.allowed, e.full_name employee_name, z.name zone_name
               FROM access_logs al
               JOIN employees e ON e.id=al.employee_id
               JOIN zones z ON z.id=al.zone_id
               ORDER BY al.event_time DESC LIMIT 15"""
        ).fetchall()
    )
    hourly = rows_to_list(
        conn.execute(
            """SELECT strftime('%H', event_time) hour,
                      SUM(CASE WHEN allowed=1 THEN 1 ELSE 0 END) allowed,
                      SUM(CASE WHEN allowed=0 THEN 1 ELSE 0 END) blocked
               FROM access_logs WHERE date(event_time)=date('now','localtime')
               GROUP BY hour ORDER BY hour"""
        ).fetchall()
    )
    zones = rows_to_list(
        conn.execute(
            """SELECT z.id, z.name, z.zone_type,
                      (SELECT COUNT(*) FROM access_logs al
                       WHERE al.zone_id=z.id AND date(al.event_time)=date('now','localtime') AND al.allowed=1) passes_today,
                      (SELECT al.employee_id FROM access_logs al
                       WHERE al.zone_id=z.id ORDER BY al.event_time DESC LIMIT 1) last_employee_id
               FROM zones z WHERE z.is_active=1 ORDER BY z.name"""
        ).fetchall()
    )
    for z in zones:
        if z["last_employee_id"]:
            emp = conn.execute("SELECT full_name FROM employees WHERE id=?", (z["last_employee_id"],)).fetchone()
            last = conn.execute(
                "SELECT direction, allowed FROM access_logs WHERE zone_id=? ORDER BY event_time DESC LIMIT 1",
                (z["id"],),
            ).fetchone()
            z["last_person"] = emp["full_name"] if emp else None
            z["inside"] = last and last["direction"] == "in" and last["allowed"] == 1
        else:
            z["last_person"] = None
            z["inside"] = False
    open_inc = conn.execute(
        "SELECT COUNT(*) c FROM incidents WHERE status IN ('open','in_progress')"
    ).fetchone()["c"]
    conn.close()
    return jsonify({"feed": feed, "hourly": hourly, "zones": zones, "open_incidents": open_inc})


@app.get("/api/live/compliance-summary")
@login_required
def live_compliance():
    conn = get_conn()
    rows = rows_to_list(
        conn.execute(
            """SELECT e.id, e.full_name, e.badge_number
               FROM employees e WHERE e.is_active=1 ORDER BY e.full_name LIMIT 20"""
        ).fetchall()
    )
    for r in rows:
        idx = compute_compliance_index(conn, r["id"])
        r["score"] = idx["score"]
        r["factors"] = idx["factors"]
        r["issues"] = idx["issues"]
    conn.close()
    rows.sort(key=lambda x: x["score"])
    return jsonify({"items": rows})


@app.get("/api/public/stats")
def public_stats():
    conn = get_conn()
    stats = {
        "access_today": conn.execute(
            "SELECT COUNT(*) c FROM access_logs WHERE date(event_time)=date('now','localtime')"
        ).fetchone()["c"],
        "zones": conn.execute("SELECT COUNT(*) c FROM zones WHERE is_active=1").fetchone()["c"],
        "blocked_today": conn.execute(
            "SELECT COUNT(*) c FROM access_logs WHERE date(event_time)=date('now','localtime') AND allowed=0"
        ).fetchone()["c"],
        "employees": conn.execute("SELECT COUNT(*) c FROM employees WHERE is_active=1").fetchone()["c"],
    }
    conn.close()
    return jsonify(stats)


@app.get("/api/dashboard")
@login_required
def dashboard():
    conn = get_conn()
    stats = {
        "employees": conn.execute("SELECT COUNT(*) c FROM employees WHERE is_active=1").fetchone()["c"],
        "zones": conn.execute("SELECT COUNT(*) c FROM zones WHERE is_active=1").fetchone()["c"],
        "access_today": conn.execute(
            "SELECT COUNT(*) c FROM access_logs WHERE date(event_time)=date('now','localtime')"
        ).fetchone()["c"],
        "blocked_today": conn.execute(
            "SELECT COUNT(*) c FROM access_logs WHERE date(event_time)=date('now','localtime') AND allowed=0"
        ).fetchone()["c"],
        "open_incidents": conn.execute(
            "SELECT COUNT(*) c FROM incidents WHERE status IN ('open','in_progress')"
        ).fetchone()["c"],
        "expired_books": conn.execute(
            "SELECT COUNT(*) c FROM sanitary_books WHERE expiry_date < date('now') AND status='valid'"
        ).fetchone()["c"],
        "expired_exams": conn.execute(
            "SELECT COUNT(*) c FROM medical_exams WHERE expiry_date < date('now') AND status='valid'"
        ).fetchone()["c"],
        "pending_registrations": conn.execute(
            "SELECT COUNT(*) c FROM registration_requests WHERE status IN ('pending_email','pending_admin')"
        ).fetchone()["c"],
    }
    recent = rows_to_list(
        conn.execute(
            """SELECT al.*, e.full_name employee_name, z.name zone_name
               FROM access_logs al
               JOIN employees e ON e.id=al.employee_id
               JOIN zones z ON z.id=al.zone_id
               ORDER BY al.event_time DESC LIMIT 10"""
        ).fetchall()
    )
    conn.close()
    return jsonify({"stats": stats, "recent_access": recent})


# --- Employees ---
@app.get("/api/employees")
@login_required
def list_employees():
    page = max(1, int(request.args.get("page", 1)))
    per_page = min(100, max(1, int(request.args.get("per_page", 20))))
    search = (request.args.get("search") or "").strip()
    q = "SELECT e.*, u.username FROM employees e LEFT JOIN users u ON u.id=e.user_id WHERE 1=1"
    params = []
    if search:
        q += " AND (e.full_name LIKE ? OR e.badge_number LIKE ? OR e.position LIKE ?)"
        params.extend([f"%{search}%"] * 3)
    if request.current_user["role"] == "employee":
        conn = get_conn()
        emp = conn.execute(
            "SELECT e.* FROM employees e JOIN users u ON u.id=e.user_id WHERE u.id=?",
            (request.current_user["id"],),
        ).fetchone()
        conn.close()
        return jsonify({"items": [row_to_dict(emp)] if emp else [], "total": 1 if emp else 0, "page": 1, "per_page": 1})
    q += " ORDER BY e.full_name"
    items, total = paginate(q, tuple(params), page, per_page)
    return jsonify({"items": items, "total": total, "page": page, "per_page": per_page})


@app.get("/api/employees/<int:eid>")
@login_required
def get_employee(eid):
    conn = get_conn()
    emp = conn.execute(
        "SELECT e.*, u.username FROM employees e LEFT JOIN users u ON u.id=e.user_id WHERE e.id=?", (eid,)
    ).fetchone()
    if not emp:
        conn.close()
        return jsonify({"error": "Не найдено"}), 404
    if request.current_user["role"] == "employee":
        own = conn.execute("SELECT id FROM employees WHERE user_id=?", (request.current_user["id"],)).fetchone()
        if not own or own["id"] != eid:
            conn.close()
            return jsonify({"error": "Недостаточно прав"}), 403
    zones = rows_to_list(
        conn.execute(
            """SELECT z.* FROM zones z
               JOIN employee_zone_permissions p ON p.zone_id=z.id
               WHERE p.employee_id=?""",
            (eid,),
        ).fetchall()
    )
    books = rows_to_list(conn.execute("SELECT * FROM sanitary_books WHERE employee_id=? ORDER BY expiry_date DESC", (eid,)).fetchall())
    exams = rows_to_list(conn.execute("SELECT * FROM medical_exams WHERE employee_id=? ORDER BY expiry_date DESC", (eid,)).fetchall())
    temps = rows_to_list(
        conn.execute(
            "SELECT * FROM temperature_screenings WHERE employee_id=? ORDER BY screened_at DESC LIMIT 5", (eid,)
        ).fetchall()
    )
    logs = rows_to_list(
        conn.execute(
            """SELECT al.*, z.name zone_name FROM access_logs al
               JOIN zones z ON z.id=al.zone_id WHERE al.employee_id=? ORDER BY al.event_time DESC LIMIT 20""",
            (eid,),
        ).fetchall()
    )
    conn.close()
    return jsonify({"employee": row_to_dict(emp), "zones": zones, "sanitary_books": books, "medical_exams": exams, "temperatures": temps, "access_logs": logs})


@app.post("/api/employees")
@roles_required("admin")
def create_employee():
    data = request.get_json(silent=True) or {}
    badge = (data.get("badge_number") or "").strip()
    name = (data.get("full_name") or "").strip()
    position = (data.get("position") or "").strip()
    department = (data.get("department") or "").strip() or None
    if not badge or not name or not position:
        return jsonify({"error": "Заполните обязательные поля"}), 400
    conn = get_conn()
    try:
        cur = conn.execute(
            "INSERT INTO employees(badge_number, full_name, position, department) VALUES (?,?,?,?)",
            (badge, name, position, department),
        )
        eid = cur.lastrowid
        conn.commit()
        emp = conn.execute("SELECT * FROM employees WHERE id=?", (eid,)).fetchone()
    except Exception:
        conn.close()
        return jsonify({"error": "Табельный номер уже существует"}), 409
    conn.close()
    audit(request.current_user["id"], "CREATE", "employees", eid, data)
    return jsonify(row_to_dict(emp)), 201


@app.put("/api/employees/<int:eid>")
@roles_required("admin")
def update_employee(eid):
    data = request.get_json(silent=True) or {}
    conn = get_conn()
    emp = conn.execute("SELECT * FROM employees WHERE id=?", (eid,)).fetchone()
    if not emp:
        conn.close()
        return jsonify({"error": "Не найдено"}), 404
    conn.execute(
        """UPDATE employees SET badge_number=?, full_name=?, position=?, department=?, is_active=?
           WHERE id=?""",
        (
            data.get("badge_number", emp["badge_number"]),
            data.get("full_name", emp["full_name"]),
            data.get("position", emp["position"]),
            data.get("department", emp["department"]),
            1 if data.get("is_active", emp["is_active"]) else 0,
            eid,
        ),
    )
    conn.commit()
    updated = conn.execute("SELECT * FROM employees WHERE id=?", (eid,)).fetchone()
    conn.close()
    audit(request.current_user["id"], "UPDATE", "employees", eid, data)
    return jsonify(row_to_dict(updated))


@app.delete("/api/employees/<int:eid>")
@roles_required("admin")
def delete_employee(eid):
    conn = get_conn()
    conn.execute("UPDATE employees SET is_active=0 WHERE id=?", (eid,))
    conn.commit()
    conn.close()
    audit(request.current_user["id"], "DELETE", "employees", eid)
    return jsonify({"ok": True})


# --- Zones ---
@app.get("/api/zones")
@login_required
def list_zones():
    conn = get_conn()
    zones = rows_to_list(conn.execute("SELECT * FROM zones WHERE is_active=1 ORDER BY name").fetchall())
    conn.close()
    return jsonify({"items": zones})


@app.post("/api/zones")
@roles_required("admin")
def create_zone():
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    ztype = data.get("zone_type") or "warehouse"
    if not name or ztype not in ("operating", "reanimation", "isolation", "warehouse"):
        return jsonify({"error": "Некорректные данные"}), 400
    conn = get_conn()
    cur = conn.execute(
        "INSERT INTO zones(name, zone_type, access_level, description) VALUES (?,?,?,?)",
        (name, ztype, int(data.get("access_level", 1)), data.get("description")),
    )
    zid = cur.lastrowid
    conn.commit()
    zone = conn.execute("SELECT * FROM zones WHERE id=?", (zid,)).fetchone()
    conn.close()
    audit(request.current_user["id"], "CREATE", "zones", zid, data)
    return jsonify(row_to_dict(zone)), 201


@app.put("/api/zones/<int:zid>")
@roles_required("admin")
def update_zone(zid):
    data = request.get_json(silent=True) or {}
    conn = get_conn()
    zone = conn.execute("SELECT * FROM zones WHERE id=?", (zid,)).fetchone()
    if not zone:
        conn.close()
        return jsonify({"error": "Не найдено"}), 404
    conn.execute(
        "UPDATE zones SET name=?, zone_type=?, access_level=?, description=?, is_active=? WHERE id=?",
        (
            data.get("name", zone["name"]),
            data.get("zone_type", zone["zone_type"]),
            data.get("access_level", zone["access_level"]),
            data.get("description", zone["description"]),
            1 if data.get("is_active", zone["is_active"]) else 0,
            zid,
        ),
    )
    conn.commit()
    updated = conn.execute("SELECT * FROM zones WHERE id=?", (zid,)).fetchone()
    conn.close()
    audit(request.current_user["id"], "UPDATE", "zones", zid, data)
    return jsonify(row_to_dict(updated))


@app.delete("/api/zones/<int:zid>")
@roles_required("admin")
def delete_zone(zid):
    conn = get_conn()
    conn.execute("UPDATE zones SET is_active=0 WHERE id=?", (zid,))
    conn.commit()
    conn.close()
    audit(request.current_user["id"], "DELETE", "zones", zid)
    return jsonify({"ok": True})


# --- Permissions ---
@app.get("/api/permissions")
@roles_required("admin", "guard", "nurse_chief")
def list_permissions():
    conn = get_conn()
    items = rows_to_list(
        conn.execute(
            """SELECT p.*, e.full_name employee_name, e.badge_number, z.name zone_name
               FROM employee_zone_permissions p
               JOIN employees e ON e.id=p.employee_id
               JOIN zones z ON z.id=p.zone_id ORDER BY e.full_name"""
        ).fetchall()
    )
    conn.close()
    return jsonify({"items": items})


@app.post("/api/permissions")
@roles_required("admin")
def grant_permission():
    data = request.get_json(silent=True) or {}
    eid = data.get("employee_id")
    zid = data.get("zone_id")
    if not eid or not zid:
        return jsonify({"error": "Укажите сотрудника и зону"}), 400
    conn = get_conn()
    try:
        cur = conn.execute(
            "INSERT INTO employee_zone_permissions(employee_id, zone_id, granted_by) VALUES (?,?,?)",
            (eid, zid, request.current_user["id"]),
        )
        pid = cur.lastrowid
        conn.commit()
    except Exception:
        conn.close()
        return jsonify({"error": "Допуск уже существует"}), 409
    row = conn.execute("SELECT * FROM employee_zone_permissions WHERE id=?", (pid,)).fetchone()
    conn.close()
    audit(request.current_user["id"], "GRANT", "employee_zone_permissions", pid, data)
    return jsonify(row_to_dict(row)), 201


@app.delete("/api/permissions/<int:pid>")
@roles_required("admin")
def revoke_permission(pid):
    conn = get_conn()
    conn.execute("DELETE FROM employee_zone_permissions WHERE id=?", (pid,))
    conn.commit()
    conn.close()
    audit(request.current_user["id"], "REVOKE", "employee_zone_permissions", pid)
    return jsonify({"ok": True})


# --- Sanitary books ---
@app.get("/api/sanitary-books")
@login_required
def list_books():
    conn = get_conn()
    q = """SELECT sb.*, e.full_name employee_name, e.badge_number
           FROM sanitary_books sb JOIN employees e ON e.id=sb.employee_id"""
    if request.current_user["role"] == "employee":
        q += " WHERE e.user_id=" + str(request.current_user["id"])
    q += " ORDER BY sb.expiry_date"
    items = rows_to_list(conn.execute(q).fetchall())
    conn.close()
    return jsonify({"items": items})


@app.post("/api/sanitary-books")
@roles_required("admin", "nurse_chief")
def create_book():
    data = request.get_json(silent=True) or {}
    required = ["employee_id", "book_number", "issue_date", "expiry_date"]
    if not all(data.get(k) for k in required):
        return jsonify({"error": "Заполните все поля"}), 400
    status = "expired" if data["expiry_date"] < datetime.now().date().isoformat() else "valid"
    conn = get_conn()
    cur = conn.execute(
        "INSERT INTO sanitary_books(employee_id, book_number, issue_date, expiry_date, status) VALUES (?,?,?,?,?)",
        (data["employee_id"], data["book_number"], data["issue_date"], data["expiry_date"], status),
    )
    bid = cur.lastrowid
    conn.commit()
    row = conn.execute("SELECT * FROM sanitary_books WHERE id=?", (bid,)).fetchone()
    conn.close()
    audit(request.current_user["id"], "CREATE", "sanitary_books", bid, data)
    return jsonify(row_to_dict(row)), 201


@app.put("/api/sanitary-books/<int:bid>")
@roles_required("admin", "nurse_chief")
def update_book(bid):
    data = request.get_json(silent=True) or {}
    conn = get_conn()
    book = conn.execute("SELECT * FROM sanitary_books WHERE id=?", (bid,)).fetchone()
    if not book:
        conn.close()
        return jsonify({"error": "Не найдено"}), 404
    expiry = data.get("expiry_date", book["expiry_date"])
    status = data.get("status", "expired" if expiry < datetime.now().date().isoformat() else "valid")
    conn.execute(
        "UPDATE sanitary_books SET book_number=?, issue_date=?, expiry_date=?, status=? WHERE id=?",
        (data.get("book_number", book["book_number"]), data.get("issue_date", book["issue_date"]), expiry, status, bid),
    )
    conn.commit()
    updated = conn.execute("SELECT * FROM sanitary_books WHERE id=?", (bid,)).fetchone()
    conn.close()
    audit(request.current_user["id"], "UPDATE", "sanitary_books", bid, data)
    return jsonify(row_to_dict(updated))


@app.delete("/api/sanitary-books/<int:bid>")
@roles_required("admin")
def delete_book(bid):
    conn = get_conn()
    conn.execute("DELETE FROM sanitary_books WHERE id=?", (bid,))
    conn.commit()
    conn.close()
    audit(request.current_user["id"], "DELETE", "sanitary_books", bid)
    return jsonify({"ok": True})


# --- Medical exams ---
@app.get("/api/medical-exams")
@login_required
def list_exams():
    conn = get_conn()
    q = """SELECT me.*, e.full_name employee_name, e.badge_number
           FROM medical_exams me JOIN employees e ON e.id=me.employee_id"""
    if request.current_user["role"] == "employee":
        q += " WHERE e.user_id=" + str(request.current_user["id"])
    q += " ORDER BY me.expiry_date"
    items = rows_to_list(conn.execute(q).fetchall())
    conn.close()
    return jsonify({"items": items})


@app.post("/api/medical-exams")
@roles_required("admin", "nurse_chief")
def create_exam():
    data = request.get_json(silent=True) or {}
    required = ["employee_id", "exam_date", "expiry_date"]
    if not all(data.get(k) for k in required):
        return jsonify({"error": "Заполните все поля"}), 400
    status = "expired" if data["expiry_date"] < datetime.now().date().isoformat() else "valid"
    conn = get_conn()
    cur = conn.execute(
        "INSERT INTO medical_exams(employee_id, exam_date, expiry_date, result, status) VALUES (?,?,?,?,?)",
        (data["employee_id"], data["exam_date"], data["expiry_date"], data.get("result", "passed"), status),
    )
    eid = cur.lastrowid
    conn.commit()
    row = conn.execute("SELECT * FROM medical_exams WHERE id=?", (eid,)).fetchone()
    conn.close()
    audit(request.current_user["id"], "CREATE", "medical_exams", eid, data)
    return jsonify(row_to_dict(row)), 201


@app.put("/api/medical-exams/<int:eid>")
@roles_required("admin", "nurse_chief")
def update_exam(eid):
    data = request.get_json(silent=True) or {}
    conn = get_conn()
    exam = conn.execute("SELECT * FROM medical_exams WHERE id=?", (eid,)).fetchone()
    if not exam:
        conn.close()
        return jsonify({"error": "Не найдено"}), 404
    expiry = data.get("expiry_date", exam["expiry_date"])
    status = data.get("status", "expired" if expiry < datetime.now().date().isoformat() else "valid")
    conn.execute(
        "UPDATE medical_exams SET exam_date=?, expiry_date=?, result=?, status=? WHERE id=?",
        (data.get("exam_date", exam["exam_date"]), expiry, data.get("result", exam["result"]), status, eid),
    )
    conn.commit()
    updated = conn.execute("SELECT * FROM medical_exams WHERE id=?", (eid,)).fetchone()
    conn.close()
    audit(request.current_user["id"], "UPDATE", "medical_exams", eid, data)
    return jsonify(row_to_dict(updated))


@app.delete("/api/medical-exams/<int:eid>")
@roles_required("admin")
def delete_exam(eid):
    conn = get_conn()
    conn.execute("DELETE FROM medical_exams WHERE id=?", (eid,))
    conn.commit()
    conn.close()
    audit(request.current_user["id"], "DELETE", "medical_exams", eid)
    return jsonify({"ok": True})


# --- Temperature screening ---
@app.post("/api/temperature-screenings")
@roles_required("admin", "guard", "nurse_chief")
def create_screening():
    data = request.get_json(silent=True) or {}
    eid = data.get("employee_id")
    temp = data.get("temperature")
    if eid is None or temp is None:
        return jsonify({"error": "Укажите сотрудника и температуру"}), 400
    try:
        temp = float(temp)
    except (TypeError, ValueError):
        return jsonify({"error": "Некорректная температура"}), 400
    passed = 1 if temp <= 37.0 else 0
    conn = get_conn()
    cur = conn.execute(
        "INSERT INTO temperature_screenings(employee_id, temperature, passed, guard_id) VALUES (?,?,?,?)",
        (eid, temp, passed, request.current_user["id"]),
    )
    sid = cur.lastrowid
    conn.commit()
    row = conn.execute("SELECT * FROM temperature_screenings WHERE id=?", (sid,)).fetchone()
    conn.close()
    audit(request.current_user["id"], "SCREEN", "temperature_screenings", sid, {"temperature": temp, "passed": passed})
    if not passed:
        create_incident_internal(eid, None, "temperature", f"Повышенная температура {temp}°C при скрининге")
    return jsonify(row_to_dict(row)), 201


# --- Access pass (core business logic) ---
def create_incident_internal(employee_id, zone_id, incident_type, description):
    conn = get_conn()
    cur = conn.execute(
        """INSERT INTO incidents(employee_id, zone_id, incident_type, description, assigned_to_role)
           VALUES (?,?,?,?,?)""",
        (employee_id, zone_id, incident_type, description, "nurse_chief"),
    )
    iid = cur.lastrowid
    conn.commit()
    conn.close()
    return iid


@app.post("/api/access/precheck")
@roles_required("admin", "guard")
def access_precheck():
    data = request.get_json(silent=True) or {}
    eid = data.get("employee_id")
    zid = data.get("zone_id")
    temperature = data.get("temperature")
    if not eid or not zid:
        return jsonify({"error": "Укажите сотрудника и зону"}), 400

    violations = []
    checks = []

    if has_zone_permission(eid, zid):
        checks.append({"name": "Допуск в зону", "ok": True})
    else:
        checks.append({"name": "Допуск в зону", "ok": False, "detail": "Нет разрешения на зону"})
        violations.append("Нет допуска в данную зону")

    compliant, comp_violations = check_employee_compliance(eid)
    checks.append({"name": "Санкнижка и медосмотр", "ok": compliant, "detail": "; ".join(comp_violations) if comp_violations else "OK"})
    if not compliant:
        violations.extend(comp_violations)

    if temperature is not None:
        try:
            temperature = float(temperature)
            temp_ok = temperature <= 37.0
            checks.append({"name": "Температура", "ok": temp_ok, "detail": f"{temperature}°C"})
            if not temp_ok:
                violations.append(f"Температура {temperature}°C превышает допустимую")
        except (TypeError, ValueError):
            pass

    conn = get_conn()
    emp = conn.execute("SELECT full_name, badge_number FROM employees WHERE id=?", (eid,)).fetchone()
    zone = conn.execute("SELECT name FROM zones WHERE id=?", (zid,)).fetchone()
    conn.close()

    return jsonify({
        "allowed": len(violations) == 0,
        "violations": violations,
        "checks": checks,
        "employee_name": emp["full_name"] if emp else None,
        "zone_name": zone["name"] if zone else None,
    })


@app.post("/api/access/pass")
@roles_required("admin", "guard")
def access_pass():
    data = request.get_json(silent=True) or {}
    eid = data.get("employee_id")
    zid = data.get("zone_id")
    direction = data.get("direction", "in")
    temperature = data.get("temperature")

    if not eid or not zid or direction not in ("in", "out"):
        return jsonify({"error": "Укажите сотрудника, зону и направление"}), 400

    violations = []
    allowed = True

    if not has_zone_permission(eid, zid):
        violations.append("Нет допуска в данную зону")
        allowed = False

    compliant, comp_violations = check_employee_compliance(eid)
    if not compliant:
        violations.extend(comp_violations)
        allowed = False

    if temperature is not None:
        try:
            temperature = float(temperature)
            if temperature > 37.0:
                violations.append(f"Температура {temperature}°C превышает допустимую")
                allowed = False
            conn = get_conn()
            conn.execute(
                "INSERT INTO temperature_screenings(employee_id, temperature, passed, guard_id) VALUES (?,?,?,?)",
                (eid, temperature, 1 if temperature <= 37.0 else 0, request.current_user["id"]),
            )
            conn.commit()
            conn.close()
        except (TypeError, ValueError):
            pass

    block_reason = "; ".join(violations) if violations else None

    conn = get_conn()
    cur = conn.execute(
        """INSERT INTO access_logs(employee_id, zone_id, direction, guard_id, temperature, allowed, block_reason)
           VALUES (?,?,?,?,?,?,?)""",
        (eid, zid, direction, request.current_user["id"], temperature, 1 if allowed else 0, block_reason),
    )
    log_id = cur.lastrowid
    conn.commit()
    log = conn.execute(
        """SELECT al.*, e.full_name employee_name, z.name zone_name
           FROM access_logs al JOIN employees e ON e.id=al.employee_id JOIN zones z ON z.id=al.zone_id
           WHERE al.id=?""",
        (log_id,),
    ).fetchone()
    conn.close()

    incident_id = None
    if not allowed:
        incident_id = create_incident_internal(
            eid, zid, "access_denied", f"Блокировка прохода ({direction}): {block_reason}"
        )

    audit(request.current_user["id"], "ACCESS", "access_logs", log_id, {"allowed": allowed, "violations": violations})
    return jsonify({"log": row_to_dict(log), "allowed": bool(allowed), "violations": violations, "incident_id": incident_id})


@app.get("/api/access-logs")
@login_required
def list_access_logs():
    page = max(1, int(request.args.get("page", 1)))
    per_page = min(100, max(1, int(request.args.get("per_page", 20))))
    zone_id = request.args.get("zone_id")
    allowed = request.args.get("allowed")
    q = """SELECT al.*, e.full_name employee_name, e.badge_number, z.name zone_name
           FROM access_logs al
           JOIN employees e ON e.id=al.employee_id
           JOIN zones z ON z.id=al.zone_id WHERE 1=1"""
    params = []
    if zone_id:
        q += " AND al.zone_id=?"
        params.append(zone_id)
    if allowed in ("0", "1"):
        q += " AND al.allowed=?"
        params.append(int(allowed))
    if request.current_user["role"] == "employee":
        conn = get_conn()
        emp = conn.execute("SELECT id FROM employees WHERE user_id=?", (request.current_user["id"],)).fetchone()
        conn.close()
        if emp:
            q += " AND al.employee_id=?"
            params.append(emp["id"])
        else:
            return jsonify({"items": [], "total": 0, "page": page, "per_page": per_page})
    q += " ORDER BY al.event_time DESC"
    items, total = paginate(q, tuple(params), page, per_page)
    return jsonify({"items": items, "total": total, "page": page, "per_page": per_page})


# --- Incidents ---
@app.get("/api/incidents")
@login_required
def list_incidents():
    page = max(1, int(request.args.get("page", 1)))
    per_page = min(100, max(1, int(request.args.get("per_page", 20))))
    status = request.args.get("status")
    q = """SELECT i.*, e.full_name employee_name, z.name zone_name
           FROM incidents i
           JOIN employees e ON e.id=i.employee_id
           LEFT JOIN zones z ON z.id=i.zone_id WHERE 1=1"""
    params = []
    if status:
        q += " AND i.status=?"
        params.append(status)
    if request.current_user["role"] not in ("admin", "nurse_chief"):
        return jsonify({"error": "Недостаточно прав"}), 403
    q += " ORDER BY i.created_at DESC"
    items, total = paginate(q, tuple(params), page, per_page)
    return jsonify({"items": items, "total": total, "page": page, "per_page": per_page})


@app.get("/api/incidents/<int:iid>")
@roles_required("admin", "nurse_chief")
def get_incident(iid):
    conn = get_conn()
    inc = conn.execute(
        """SELECT i.*, e.full_name employee_name, z.name zone_name
           FROM incidents i JOIN employees e ON e.id=i.employee_id
           LEFT JOIN zones z ON z.id=i.zone_id WHERE i.id=?""",
        (iid,),
    ).fetchone()
    conn.close()
    if not inc:
        return jsonify({"error": "Не найдено"}), 404
    return jsonify(row_to_dict(inc))


@app.put("/api/incidents/<int:iid>")
@roles_required("admin", "nurse_chief")
def update_incident(iid):
    data = request.get_json(silent=True) or {}
    conn = get_conn()
    inc = conn.execute("SELECT * FROM incidents WHERE id=?", (iid,)).fetchone()
    if not inc:
        conn.close()
        return jsonify({"error": "Не найдено"}), 404
    status = data.get("status", inc["status"])
    resolved_at = inc["resolved_at"]
    resolved_by = inc["resolved_by"]
    if status == "resolved" and inc["status"] != "resolved":
        resolved_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        resolved_by = request.current_user["id"]
    conn.execute(
        "UPDATE incidents SET status=?, resolution_note=?, resolved_at=?, resolved_by=? WHERE id=?",
        (status, data.get("resolution_note", inc["resolution_note"]), resolved_at, resolved_by, iid),
    )
    conn.commit()
    updated = conn.execute("SELECT * FROM incidents WHERE id=?", (iid,)).fetchone()
    conn.close()
    audit(request.current_user["id"], "UPDATE", "incidents", iid, data)
    return jsonify(row_to_dict(updated))


# --- Users (admin) ---
@app.get("/api/users")
@roles_required("admin")
def list_users():
    conn = get_conn()
    users = rows_to_list(
        conn.execute("SELECT id, username, role, full_name, email, created_at FROM users ORDER BY username").fetchall()
    )
    conn.close()
    return jsonify({"items": users})


@app.put("/api/users/<int:uid>")
@roles_required("admin")
def update_user(uid):
    data = request.get_json(silent=True) or {}
    conn = get_conn()
    user = conn.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
    if not user:
        conn.close()
        return jsonify({"error": "Не найдено"}), 404
    role = data.get("role", user["role"])
    if role not in ("admin", "nurse_chief", "guard", "employee"):
        return jsonify({"error": "Некорректная роль"}), 400
    conn.execute(
        "UPDATE users SET role=?, full_name=?, email=? WHERE id=?",
        (role, data.get("full_name", user["full_name"]), data.get("email", user["email"]), uid),
    )
    if data.get("password"):
        conn.execute(
            "UPDATE users SET password_hash=? WHERE id=?",
            (generate_password_hash(data["password"]), uid),
        )
    conn.commit()
    updated = conn.execute(
        "SELECT id, username, role, full_name, email, created_at FROM users WHERE id=?", (uid,)
    ).fetchone()
    conn.close()
    audit(request.current_user["id"], "UPDATE", "users", uid, {"role": role})
    return jsonify(row_to_dict(updated))


@app.delete("/api/users/<int:uid>")
@roles_required("admin")
def delete_user(uid):
    if uid == request.current_user["id"]:
        return jsonify({"error": "Нельзя удалить себя"}), 400
    conn = get_conn()
    conn.execute("DELETE FROM users WHERE id=?", (uid,))
    conn.commit()
    conn.close()
    audit(request.current_user["id"], "DELETE", "users", uid)
    return jsonify({"ok": True})


# --- Audit ---
@app.get("/api/audit")
@roles_required("admin")
def list_audit():
    page = max(1, int(request.args.get("page", 1)))
    per_page = min(100, max(1, int(request.args.get("per_page", 30))))
    q = "SELECT a.*, u.username FROM audit_log a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.created_at DESC"
    items, total = paginate(q, (), page, per_page)
    return jsonify({"items": items, "total": total, "page": page, "per_page": per_page})


# --- Analytics (DB function equivalent) ---
@app.get("/api/analytics/compliance")
@roles_required("admin", "nurse_chief")
def analytics_compliance():
    conn = get_conn()
    rows = rows_to_list(
        conn.execute(
            """SELECT e.id, e.full_name, e.badge_number,
                      (SELECT MAX(expiry_date) FROM sanitary_books WHERE employee_id=e.id AND status='valid') book_expiry,
                      (SELECT MAX(expiry_date) FROM medical_exams WHERE employee_id=e.id AND status='valid') exam_expiry,
                      (SELECT temperature FROM temperature_screenings WHERE employee_id=e.id
                       AND date(screened_at)=date('now','localtime') ORDER BY screened_at DESC LIMIT 1) temp_today
               FROM employees e WHERE e.is_active=1 ORDER BY e.full_name"""
        ).fetchall()
    )
    total_score = 0
    for r in rows:
        idx = compute_compliance_index(conn, r["id"])
        r["score"] = idx["score"]
        r["factors"] = idx["factors"]
        r["compliant"] = idx["compliant"]
        r["issues"] = idx["issues"]
        total_score += idx["score"]
    avg_score = round(total_score / len(rows)) if rows else 0
    conn.close()
    return jsonify({"items": rows, "avg_score": avg_score})


# ========== АДМИН-ПАНЕЛЬ ==========

# Хранилище сессий админки
admin_sessions = {}


def get_admin_dir():
    """Возвращает путь к папке admin"""
    admin_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "admin")
    if not os.path.isdir(admin_dir):
        admin_dir = os.path.join(os.path.dirname(__file__), "..", "admin")
    return admin_dir


def check_admin_session():
    """Проверяет сессию админки через Authorization header"""
    auth_header = request.headers.get('Authorization', '')
    if auth_header.startswith('Bearer '):
        token = auth_header[7:]
        if token in admin_sessions:
            session = admin_sessions[token]
            if session.get("expires", 0) > datetime.now().timestamp():
                return session.get("user")
    return None


def create_admin_session(user_id, username, full_name):
    """Создает сессию для админки"""
    import secrets
    token = secrets.token_urlsafe(32)
    admin_sessions[token] = {
        "user": {
            "id": user_id,
            "username": username,
            "full_name": full_name,
            "role": "admin"
        },
        "expires": datetime.now().timestamp() + 3600 * 8
    }
    return token


def admin_api_required(f):
    """Декоратор для проверки доступа к админским API"""
    from functools import wraps
    @wraps(f)
    def wrapper(*args, **kwargs):
        auth_header = request.headers.get('Authorization', '')
        token = auth_header[7:] if auth_header.startswith('Bearer ') else None
        
        if not token or token not in admin_sessions:
            return jsonify({"error": "Требуется авторизация"}), 401
        
        session = admin_sessions[token]
        if session.get("expires", 0) < datetime.now().timestamp():
            return jsonify({"error": "Сессия истекла"}), 401
        
        request.admin_user = session.get("user")
        return f(*args, **kwargs)
    return wrapper


# ========== СТАТИЧЕСКИЕ ФАЙЛЫ АДМИНКИ (без проверки) ==========

@app.route("/admin/login", methods=["GET", "POST"])
def admin_login():
    """Страница входа в админ-панель"""
    if request.method == "POST":
        data = request.get_json(silent=True) or {}
        username = data.get("username", "").strip()
        password = data.get("password", "")
        
        from werkzeug.security import check_password_hash
        conn = get_conn()
        user = conn.execute(
            "SELECT id, username, role, full_name, password_hash FROM users WHERE username=?", 
            (username,)
        ).fetchone()
        conn.close()
        
        if not user:
            return jsonify({"error": "Неверные учетные данные"}), 401
        
        if user["role"] != "admin":
            return jsonify({"error": "Недостаточно прав"}), 403
        
        if not check_password_hash(user["password_hash"], password):
            return jsonify({"error": "Неверный пароль"}), 401
        
        token = create_admin_session(user["id"], user["username"], user["full_name"])
        
        return jsonify({
            "success": True, 
            "token": token,
            "user": {"username": user["username"], "full_name": user["full_name"]}
        })
    
    return send_from_directory(get_admin_dir(), "login.html")


@app.route("/admin/logout")
def admin_logout():
    """Выход из админ-панели"""
    auth_header = request.headers.get('Authorization', '')
    token = auth_header[7:] if auth_header.startswith('Bearer ') else None
    if token and token in admin_sessions:
        del admin_sessions[token]
    return jsonify({"success": True})


@app.route("/admin")
@app.route("/admin/")
def admin_index():
    """Админ-панель - главная страница"""
    return send_from_directory(get_admin_dir(), "index.html")


@app.route("/admin/<path:path>")
def admin_static_files(path):
    """Статические файлы админ-панели (CSS, JS, HTML)"""
    # Разрешаем доступ ко всем статическим файлам
    return send_from_directory(get_admin_dir(), path)


# ========== API АДМИН-ПАНЕЛИ (требуют токен) ==========

@app.get("/api/admin/check-auth")
def admin_check_auth():
    """Проверка авторизации в админ-панели"""
    auth_header = request.headers.get('Authorization', '')
    token = auth_header[7:] if auth_header.startswith('Bearer ') else None
    
    if token and token in admin_sessions:
        session = admin_sessions[token]
        if session.get("expires", 0) > datetime.now().timestamp():
            return jsonify({
                "authenticated": True,
                "user": session.get("user")
            })
    return jsonify({"authenticated": False}), 401


@app.get("/api/admin/dashboard-stats")
@admin_api_required
def admin_dashboard_stats():
    """Расширенная статистика для админ-панели"""
    try:
        conn = get_conn()
        stats = {
            "total_users": conn.execute("SELECT COUNT(*) c FROM users WHERE is_active=1").fetchone()["c"],
            "total_employees": conn.execute("SELECT COUNT(*) c FROM employees WHERE is_active=1").fetchone()["c"],
            "total_zones": conn.execute("SELECT COUNT(*) c FROM zones WHERE is_active=1").fetchone()["c"],
            "today_passes": conn.execute(
                "SELECT COUNT(*) c FROM access_logs WHERE date(event_time)=date('now','localtime')"
            ).fetchone()["c"],
            "pending_registrations": 0,
            "open_incidents": conn.execute(
                "SELECT COUNT(*) c FROM incidents WHERE status IN ('open','in_progress')"
            ).fetchone()["c"],
            "db_size": 0,
            "smtp_configured": False,
        }
        conn.close()
        return jsonify(stats)
    except Exception as e:
        print(f"Error in admin_dashboard_stats: {e}")
        return jsonify({
            "total_users": 0,
            "total_employees": 0,
            "total_zones": 0,
            "today_passes": 0,
            "pending_registrations": 0,
            "open_incidents": 0,
            "db_size": 0,
            "smtp_configured": False,
        })


@app.get("/api/admin/system-info")
@admin_api_required
def admin_system_info():
    """Системная информация"""
    import platform
    return jsonify({
        "python_version": platform.python_version(),
        "platform": platform.platform(),
        "server_time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    })


@app.get("/api/admin/users")
@admin_api_required
def admin_list_users():
    """Список пользователей для админки"""
    conn = get_conn()
    users = rows_to_list(
        conn.execute("SELECT id, username, role, full_name, email, created_at FROM users ORDER BY username").fetchall()
    )
    conn.close()
    return jsonify({"items": users})


@app.post("/api/admin/users")
@admin_api_required
def admin_create_user():
    """Создание пользователя через админку"""
    data = request.get_json(silent=True) or {}
    username = data.get("username", "").strip()
    password = data.get("password", "")
    full_name = data.get("full_name", "").strip()
    email = data.get("email", "").strip()
    role = data.get("role", "employee")
    
    if len(username) < 3 or len(password) < 8 or len(full_name) < 3:
        return jsonify({"error": "Логин ≥3, пароль ≥8, ФИО ≥3"}), 400
    
    conn = get_conn()
    try:
        conn.execute(
            "INSERT INTO users(username, password_hash, role, full_name, email, is_active) VALUES (?,?,?,?,?,1)",
            (username, generate_password_hash(password), role, full_name, email)
        )
        conn.commit()
    except Exception as e:
        conn.close()
        return jsonify({"error": str(e)}), 400
    conn.close()
    return jsonify({"success": True}), 201


@app.put("/api/admin/users/<int:uid>")
@admin_api_required
def admin_update_user(uid):
    """Обновление пользователя через админку"""
    data = request.get_json(silent=True) or {}
    conn = get_conn()
    user = conn.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
    if not user:
        conn.close()
        return jsonify({"error": "Не найдено"}), 404
    
    conn.execute(
        "UPDATE users SET role=?, full_name=?, email=? WHERE id=?",
        (data.get("role", user["role"]), data.get("full_name", user["full_name"]), data.get("email", user["email"]), uid),
    )
    if data.get("password"):
        conn.execute(
            "UPDATE users SET password_hash=? WHERE id=?",
            (generate_password_hash(data["password"]), uid),
        )
    conn.commit()
    conn.close()
    return jsonify({"success": True})


@app.delete("/api/admin/users/<int:uid>")
@admin_api_required
def admin_delete_user(uid):
    """Удаление пользователя через админку"""
    conn = get_conn()
    conn.execute("DELETE FROM users WHERE id=?", (uid,))
    conn.commit()
    conn.close()
    return jsonify({"success": True})


@app.get("/api/admin/employees")
@admin_api_required
def admin_list_employees():
    """Список сотрудников для админки"""
    conn = get_conn()
    employees = rows_to_list(
        conn.execute("SELECT * FROM employees WHERE is_active=1 ORDER BY full_name").fetchall()
    )
    conn.close()
    return jsonify({"items": employees})


@app.post("/api/admin/employees")
@admin_api_required
def admin_create_employee():
    """Создание сотрудника через админку"""
    data = request.get_json(silent=True) or {}
    conn = get_conn()
    cur = conn.execute(
        "INSERT INTO employees(badge_number, full_name, position, department) VALUES (?,?,?,?)",
        (data.get("badge_number"), data.get("full_name"), data.get("position"), data.get("department"))
    )
    conn.commit()
    conn.close()
    return jsonify({"success": True, "id": cur.lastrowid}), 201


@app.put("/api/admin/employees/<int:eid>")
@admin_api_required
def admin_update_employee(eid):
    """Обновление сотрудника через админку"""
    data = request.get_json(silent=True) or {}
    conn = get_conn()
    conn.execute(
        "UPDATE employees SET badge_number=?, full_name=?, position=?, department=?, is_active=? WHERE id=?",
        (data.get("badge_number"), data.get("full_name"), data.get("position"), data.get("department"), 
         1 if data.get("is_active") else 0, eid)
    )
    conn.commit()
    conn.close()
    return jsonify({"success": True})


@app.delete("/api/admin/employees/<int:eid>")
@admin_api_required
def admin_delete_employee(eid):
    """Деактивация сотрудника через админку"""
    conn = get_conn()
    conn.execute("UPDATE employees SET is_active=0 WHERE id=?", (eid,))
    conn.commit()
    conn.close()
    return jsonify({"success": True})


@app.get("/api/admin/zones")
@admin_api_required
def admin_list_zones():
    """Список зон для админки"""
    conn = get_conn()
    zones = rows_to_list(conn.execute("SELECT * FROM zones ORDER BY name").fetchall())
    conn.close()
    return jsonify({"items": zones})


@app.post("/api/admin/zones")
@admin_api_required
def admin_create_zone():
    """Создание зоны через админку"""
    data = request.get_json(silent=True) or {}
    conn = get_conn()
    cur = conn.execute(
        "INSERT INTO zones(name, zone_type, access_level, description) VALUES (?,?,?,?)",
        (data.get("name"), data.get("zone_type"), data.get("access_level", 1), data.get("description"))
    )
    conn.commit()
    conn.close()
    return jsonify({"success": True, "id": cur.lastrowid}), 201


@app.put("/api/admin/zones/<int:zid>")
@admin_api_required
def admin_update_zone(zid):
    """Обновление зоны через админку"""
    data = request.get_json(silent=True) or {}
    conn = get_conn()
    conn.execute(
        "UPDATE zones SET name=?, zone_type=?, access_level=?, description=?, is_active=? WHERE id=?",
        (data.get("name"), data.get("zone_type"), data.get("access_level"), data.get("description"), 
         1 if data.get("is_active") else 0, zid)
    )
    conn.commit()
    conn.close()
    return jsonify({"success": True})


@app.delete("/api/admin/zones/<int:zid>")
@admin_api_required
def admin_delete_zone(zid):
    """Деактивация зоны через админку"""
    conn = get_conn()
    conn.execute("UPDATE zones SET is_active=0 WHERE id=?", (zid,))
    conn.commit()
    conn.close()
    return jsonify({"success": True})


@app.get("/api/admin/permissions")
@admin_api_required
def admin_list_permissions():
    """Список допусков для админки"""
    conn = get_conn()
    perms = rows_to_list(
        conn.execute("""
            SELECT p.*, e.full_name employee_name, e.badge_number, z.name zone_name
            FROM employee_zone_permissions p
            JOIN employees e ON e.id=p.employee_id
            JOIN zones z ON z.id=p.zone_id
            ORDER BY e.full_name
        """).fetchall()
    )
    conn.close()
    return jsonify({"items": perms})


@app.post("/api/admin/permissions")
@admin_api_required
def admin_grant_permission():
    """Выдача допуска через админку"""
    data = request.get_json(silent=True) or {}
    conn = get_conn()
    try:
        conn.execute(
            "INSERT INTO employee_zone_permissions(employee_id, zone_id) VALUES (?,?)",
            (data.get("employee_id"), data.get("zone_id"))
        )
        conn.commit()
    except Exception:
        conn.close()
        return jsonify({"error": "Допуск уже существует"}), 409
    conn.close()
    return jsonify({"success": True}), 201


@app.delete("/api/admin/permissions/<int:pid>")
@admin_api_required
def admin_revoke_permission(pid):
    """Отзыв допуска через админку"""
    conn = get_conn()
    conn.execute("DELETE FROM employee_zone_permissions WHERE id=?", (pid,))
    conn.commit()
    conn.close()
    return jsonify({"success": True})


@app.get("/api/admin/sanitary-books")
@admin_api_required
def admin_list_books():
    """Список санкнижек для админки"""
    conn = get_conn()
    books = rows_to_list(
        conn.execute("""
            SELECT sb.*, e.full_name employee_name
            FROM sanitary_books sb
            JOIN employees e ON e.id=sb.employee_id
            ORDER BY sb.expiry_date
        """).fetchall()
    )
    conn.close()
    return jsonify({"items": books})


@app.post("/api/admin/sanitary-books")
@admin_api_required
def admin_create_book():
    """Добавление санкнижки через админку"""
    data = request.get_json(silent=True) or {}
    from datetime import date
    today = date.today().isoformat()
    status = "expired" if data.get("expiry_date") < today else "valid"
    conn = get_conn()
    cur = conn.execute(
        "INSERT INTO sanitary_books(employee_id, book_number, issue_date, expiry_date, status) VALUES (?,?,?,?,?)",
        (data.get("employee_id"), data.get("book_number"), data.get("issue_date"), data.get("expiry_date"), status)
    )
    conn.commit()
    conn.close()
    return jsonify({"success": True, "id": cur.lastrowid}), 201


@app.delete("/api/admin/sanitary-books/<int:bid>")
@admin_api_required
def admin_delete_book(bid):
    """Удаление санкнижки через админку"""
    conn = get_conn()
    conn.execute("DELETE FROM sanitary_books WHERE id=?", (bid,))
    conn.commit()
    conn.close()
    return jsonify({"success": True})


@app.get("/api/admin/medical-exams")
@admin_api_required
def admin_list_exams():
    """Список медосмотров для админки"""
    conn = get_conn()
    exams = rows_to_list(
        conn.execute("""
            SELECT me.*, e.full_name employee_name
            FROM medical_exams me
            JOIN employees e ON e.id=me.employee_id
            ORDER BY me.expiry_date
        """).fetchall()
    )
    conn.close()
    return jsonify({"items": exams})


@app.post("/api/admin/medical-exams")
@admin_api_required
def admin_create_exam():
    """Добавление медосмотра через админку"""
    data = request.get_json(silent=True) or {}
    from datetime import date
    today = date.today().isoformat()
    status = "expired" if data.get("expiry_date") < today else "valid"
    conn = get_conn()
    cur = conn.execute(
        "INSERT INTO medical_exams(employee_id, exam_date, expiry_date, result, status) VALUES (?,?,?,?,?)",
        (data.get("employee_id"), data.get("exam_date"), data.get("expiry_date"), data.get("result", "passed"), status)
    )
    conn.commit()
    conn.close()
    return jsonify({"success": True, "id": cur.lastrowid}), 201


@app.delete("/api/admin/medical-exams/<int:eid>")
@admin_api_required
def admin_delete_exam(eid):
    """Удаление медосмотра через админку"""
    conn = get_conn()
    conn.execute("DELETE FROM medical_exams WHERE id=?", (eid,))
    conn.commit()
    conn.close()
    return jsonify({"success": True})


@app.get("/api/admin/registrations")
@admin_api_required
def admin_list_registrations():
    """Список заявок на регистрацию для админки"""
    conn = get_conn()
    regs = rows_to_list(
        conn.execute("""
            SELECT id, username, full_name, email, role, status, created_at
            FROM registration_requests
            WHERE status IN ('pending_email', 'pending_admin')
            ORDER BY created_at DESC
        """).fetchall()
    )
    conn.close()
    return jsonify({"items": regs})


@app.post("/api/admin/registrations/<int:rid>/approve")
@admin_api_required
def admin_approve_registration(rid):
    """Одобрение заявки на регистрацию"""
    conn = get_conn()
    req = conn.execute("SELECT * FROM registration_requests WHERE id=?", (rid,)).fetchone()
    if not req:
        conn.close()
        return jsonify({"error": "Заявка не найдена"}), 404
    
    if req["status"] != "pending_admin":
        conn.close()
        return jsonify({"error": "Заявка не ожидает решения"}), 400
    
    cur = conn.execute(
        "INSERT INTO users(username, password_hash, role, full_name, email, is_active) VALUES (?,?,?,?,?,1)",
        (req["username"], req["password_hash"], req["role"], req["full_name"], req["email"])
    )
    conn.execute(
        "UPDATE registration_requests SET status='approved', completed_at=datetime('now','localtime') WHERE id=?",
        (rid,)
    )
    conn.commit()
    conn.close()
    return jsonify({"success": True})


@app.post("/api/admin/registrations/<int:rid>/reject")
@admin_api_required
def admin_reject_registration(rid):
    """Отклонение заявки на регистрацию"""
    conn = get_conn()
    req = conn.execute("SELECT * FROM registration_requests WHERE id=?", (rid,)).fetchone()
    if not req:
        conn.close()
        return jsonify({"error": "Заявка не найдена"}), 404
    
    conn.execute(
        "UPDATE registration_requests SET status='rejected', completed_at=datetime('now','localtime') WHERE id=?",
        (rid,)
    )
    conn.commit()
    conn.close()
    return jsonify({"success": True})


@app.get("/api/admin/incidents")
@admin_api_required
def admin_list_incidents():
    """Список инцидентов для админки"""
    page = max(1, int(request.args.get("page", 1)))
    per_page = min(100, max(1, int(request.args.get("per_page", 50))))
    q = """
        SELECT i.*, e.full_name employee_name, z.name zone_name
        FROM incidents i
        JOIN employees e ON e.id=i.employee_id
        LEFT JOIN zones z ON z.id=i.zone_id
        ORDER BY i.created_at DESC
    """
    items, total = paginate(q, (), page, per_page)
    return jsonify({"items": items, "total": total, "page": page, "per_page": per_page})


@app.put("/api/admin/incidents/<int:iid>")
@admin_api_required
def admin_update_incident(iid):
    """Обновление инцидента через админку"""
    data = request.get_json(silent=True) or {}
    conn = get_conn()
    status = data.get("status", "resolved")
    resolved_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S") if status == "resolved" else None
    conn.execute(
        "UPDATE incidents SET status=?, resolution_note=?, resolved_at=? WHERE id=?",
        (status, data.get("resolution_note"), resolved_at, iid)
    )
    conn.commit()
    conn.close()
    return jsonify({"success": True})


@app.get("/api/admin/access-logs")
@admin_api_required
def admin_list_access_logs():
    """Журнал проходов для админки"""
    page = max(1, int(request.args.get("page", 1)))
    per_page = min(200, max(1, int(request.args.get("per_page", 50))))
    q = """
        SELECT al.*, e.full_name employee_name, e.badge_number, z.name zone_name
        FROM access_logs al
        JOIN employees e ON e.id=al.employee_id
        JOIN zones z ON z.id=al.zone_id
        ORDER BY al.event_time DESC
    """
    items, total = paginate(q, (), page, per_page)
    return jsonify({"items": items, "total": total, "page": page, "per_page": per_page})


@app.get("/api/admin/audit")
@admin_api_required
def admin_list_audit():
    """Журнал аудита для админки"""
    page = max(1, int(request.args.get("page", 1)))
    per_page = min(200, max(1, int(request.args.get("per_page", 50))))
    q = "SELECT a.*, u.username FROM audit_log a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.created_at DESC"
    items, total = paginate(q, (), page, per_page)
    return jsonify({"items": items, "total": total, "page": page, "per_page": per_page})


@app.post("/api/admin/smtp-test")
@admin_api_required
def admin_smtp_test_route():
    """Тест SMTP из админ-панели"""
    from mail import MailDeliveryError, send_test_email
    data = request.get_json(silent=True) or {}
    to_email = data.get("email", "").strip()
    if not to_email:
        return jsonify({"error": "Укажите email"}), 400
    try:
        send_test_email(to_email, request.admin_user.get("full_name", "Admin"))
        return jsonify({"message": f"Письмо отправлено на {to_email}"})
    except MailDeliveryError as e:
        return jsonify({"error": str(e)}), 500


# ========== Static files (основной интерфейс) ==========
@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve_frontend(path):
    if path.startswith("api/"):
        return jsonify({"error": "Not found"}), 404
    base = os.path.abspath(STATIC_DIR)
    full = os.path.join(base, path)
    if path and os.path.isfile(full):
        return send_from_directory(base, path)
    return send_from_directory(base, "index.html")


def main():
    bootstrap_config()
    init_db()
    smtp_ok = smtp_configured()
    print(f"SanEpid Access Control: http://{HOST}:{PORT}")
    print(f"Admin panel: http://{HOST}:{PORT}/admin (только для admin)")
    print(f"SMTP: {'OK' if smtp_ok else 'NOT CONFIGURED — copy config/smtp.env.example to config/smtp.env'}")
    app.run(host=HOST, port=PORT, debug=False)


if __name__ == "__main__":
    main()