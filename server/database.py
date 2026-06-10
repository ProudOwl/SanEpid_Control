import json
import os
import sqlite3
from datetime import datetime, timedelta
from werkzeug.security import generate_password_hash

DB_PATH = os.environ.get(
    "DB_PATH",
    os.path.join(os.environ.get("LOCALAPPDATA", "."), "sanepid-monitor", "sanepid.db"),
)


def get_conn():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    conn = get_conn()
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('admin','nurse_chief','guard','employee')),
        full_name TEXT NOT NULL,
        email TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS employees (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE SET NULL,
        badge_number TEXT NOT NULL UNIQUE,
        full_name TEXT NOT NULL,
        position TEXT NOT NULL,
        department TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS zones (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        zone_type TEXT NOT NULL CHECK(zone_type IN ('operating','reanimation','isolation','warehouse')),
        access_level INTEGER NOT NULL DEFAULT 1,
        description TEXT,
        is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS employee_zone_permissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        zone_id INTEGER NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
        granted_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        granted_by INTEGER REFERENCES users(id),
        UNIQUE(employee_id, zone_id)
    );

    CREATE TABLE IF NOT EXISTS sanitary_books (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        book_number TEXT NOT NULL,
        issue_date TEXT NOT NULL,
        expiry_date TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'valid' CHECK(status IN ('valid','expired','revoked'))
    );

    CREATE TABLE IF NOT EXISTS medical_exams (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        exam_date TEXT NOT NULL,
        expiry_date TEXT NOT NULL,
        result TEXT NOT NULL DEFAULT 'passed',
        status TEXT NOT NULL DEFAULT 'valid' CHECK(status IN ('valid','expired','failed'))
    );

    CREATE TABLE IF NOT EXISTS temperature_screenings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        temperature REAL NOT NULL,
        screened_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        passed INTEGER NOT NULL DEFAULT 0,
        guard_id INTEGER REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS access_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        employee_id INTEGER NOT NULL REFERENCES employees(id),
        zone_id INTEGER NOT NULL REFERENCES zones(id),
        direction TEXT NOT NULL CHECK(direction IN ('in','out')),
        event_time TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        guard_id INTEGER REFERENCES users(id),
        temperature REAL,
        allowed INTEGER NOT NULL DEFAULT 0,
        block_reason TEXT
    );

    CREATE TABLE IF NOT EXISTS incidents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        employee_id INTEGER NOT NULL REFERENCES employees(id),
        zone_id INTEGER REFERENCES zones(id),
        incident_type TEXT NOT NULL,
        description TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','resolved')),
        assigned_to_role TEXT NOT NULL DEFAULT 'nurse_chief',
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        resolved_at TEXT,
        resolved_by INTEGER REFERENCES users(id),
        resolution_note TEXT
    );

    CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        action TEXT NOT NULL,
        table_name TEXT,
        record_id INTEGER,
        details TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TRIGGER IF NOT EXISTS audit_users_insert AFTER INSERT ON users BEGIN
        INSERT INTO audit_log(user_id, action, table_name, record_id, details)
        VALUES (NEW.id, 'INSERT', 'users', NEW.id, json_object('username', NEW.username, 'role', NEW.role));
    END;

    CREATE TRIGGER IF NOT EXISTS audit_users_update AFTER UPDATE ON users BEGIN
        INSERT INTO audit_log(user_id, action, table_name, record_id, details)
        VALUES (NEW.id, 'UPDATE', 'users', NEW.id, json_object('username', NEW.username, 'role', NEW.role));
    END;

    CREATE TRIGGER IF NOT EXISTS audit_users_delete AFTER DELETE ON users BEGIN
        INSERT INTO audit_log(user_id, action, table_name, record_id, details)
        VALUES (OLD.id, 'DELETE', 'users', OLD.id, json_object('username', OLD.username));
    END;
    """)
    conn.commit()
    migrate_schema(conn)

    if conn.execute("SELECT COUNT(*) c FROM users").fetchone()["c"] == 0:
        seed_demo(conn)
    conn.close()


def migrate_schema(conn):
    cols = {r[1] for r in conn.execute("PRAGMA table_info(users)").fetchall()}
    if "email_verified" not in cols:
        conn.execute("ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 1")
    if "is_active" not in cols:
        conn.execute("ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1")

    conn.executescript("""
    CREATE TABLE IF NOT EXISTS captcha_challenges (
        id TEXT PRIMARY KEY,
        answer_hash TEXT NOT NULL,
        expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS registration_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        full_name TEXT NOT NULL,
        email TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('employee','guard','nurse_chief')),
        email_code TEXT,
        email_code_expires TEXT,
        email_verified INTEGER NOT NULL DEFAULT 0,
        consent_pd INTEGER NOT NULL DEFAULT 0,
        consent_privacy INTEGER NOT NULL DEFAULT 0,
        consent_terms INTEGER NOT NULL DEFAULT 0,
        consent_notifications INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending_email'
            CHECK(status IN ('pending_email','pending_admin','approved','rejected')),
        admin_status TEXT NOT NULL DEFAULT 'not_required'
            CHECK(admin_status IN ('not_required','pending','approved','rejected')),
        admin_note TEXT,
        approved_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        completed_at TEXT
    );
    """)
    ver = conn.execute("PRAGMA user_version").fetchone()[0]
    if ver < 2:
        _migrate_compliance_demo_v2(conn)
        conn.execute("PRAGMA user_version = 2")
    conn.commit()


def _score_expiry_item(expiry_date, today, max_pts):
    """Баллы за документ с учётом срока действия."""
    if not expiry_date or expiry_date < today.isoformat():
        return 0, "expired"
    days_left = (datetime.fromisoformat(expiry_date).date() - today).days
    if days_left <= 14:
        return int(max_pts * 0.5), "warning"
    if days_left <= 30:
        return int(max_pts * 0.75), "warning"
    return max_pts, "ok"


def compute_compliance_index(conn, employee_id):
    """Индекс допуска 0–100: санкнижка, медосмотр, температура, проходы, инциденты."""
    today = datetime.now().date()
    emp = conn.execute("SELECT id FROM employees WHERE id=? AND is_active=1", (employee_id,)).fetchone()
    if not emp:
        return {"score": 0, "factors": [], "issues": ["Сотрудник не найден"], "compliant": False}

    factors = []
    issues = []
    score = 0

    book = conn.execute(
        """SELECT expiry_date FROM sanitary_books WHERE employee_id=? AND status='valid'
           ORDER BY expiry_date DESC LIMIT 1""",
        (employee_id,),
    ).fetchone()
    book_expiry = book["expiry_date"] if book else None
    book_pts, book_status = _score_expiry_item(book_expiry, today, 30)
    factors.append({"key": "book", "label": "Санитарная книжка", "points": book_pts, "max": 30, "status": book_status})
    score += book_pts
    if book_pts == 0:
        issues.append("Просрочена или отсутствует санитарная книжка")
    elif book_status == "warning":
        issues.append(f"Санкнижка истекает {book_expiry}")

    exam = conn.execute(
        """SELECT expiry_date FROM medical_exams WHERE employee_id=? AND status='valid'
           ORDER BY expiry_date DESC LIMIT 1""",
        (employee_id,),
    ).fetchone()
    exam_expiry = exam["expiry_date"] if exam else None
    exam_pts, exam_status = _score_expiry_item(exam_expiry, today, 30)
    factors.append({"key": "exam", "label": "Медосмотр", "points": exam_pts, "max": 30, "status": exam_status})
    score += exam_pts
    if exam_pts == 0:
        issues.append("Просрочен или отсутствует медосмотр")
    elif exam_status == "warning":
        issues.append(f"Медосмотр истекает {exam_expiry}")

    temp = conn.execute(
        """SELECT temperature, passed FROM temperature_screenings WHERE employee_id=?
           AND date(screened_at)=date('now','localtime') ORDER BY screened_at DESC LIMIT 1""",
        (employee_id,),
    ).fetchone()
    if not temp:
        temp_pts, temp_status = 0, "missing"
        issues.append("Не проведён температурный скрининг сегодня")
    elif not temp["passed"] or temp["temperature"] > 37.5:
        temp_pts, temp_status = 0, "failed"
        issues.append(f"Температура {temp['temperature']}°C — допуск не получен")
    elif temp["temperature"] > 37.0:
        temp_pts, temp_status = 10, "warning"
        issues.append(f"Повышенная температура {temp['temperature']}°C")
    else:
        temp_pts, temp_status = 25, "ok"
    factors.append({"key": "temperature", "label": "Температура сегодня", "points": temp_pts, "max": 25, "status": temp_status})
    score += temp_pts

    denied = conn.execute(
        """SELECT COUNT(*) c FROM access_logs WHERE employee_id=? AND allowed=0
           AND date(event_time) >= date('now','localtime','-7 days')""",
        (employee_id,),
    ).fetchone()["c"]
    if denied == 0:
        access_pts, access_status = 10, "ok"
    elif denied == 1:
        access_pts, access_status = 6, "warning"
        issues.append("1 блокировка прохода за 7 дней")
    else:
        access_pts, access_status = 2, "failed"
        issues.append(f"{denied} блокировок прохода за 7 дней")
    factors.append({"key": "access", "label": "Проходы за 7 дней", "points": access_pts, "max": 10, "status": access_status})
    score += access_pts

    open_inc = conn.execute(
        """SELECT COUNT(*) c FROM incidents WHERE employee_id=?
           AND status IN ('open','in_progress')""",
        (employee_id,),
    ).fetchone()["c"]
    if open_inc == 0:
        inc_pts, inc_status = 5, "ok"
    else:
        inc_pts, inc_status = 0, "failed"
        issues.append(f"Открытых инцидентов: {open_inc}")
    factors.append({"key": "incidents", "label": "Инциденты", "points": inc_pts, "max": 5, "status": inc_status})
    score += inc_pts

    critical_ok = book_pts >= 30 and exam_pts >= 30 and temp_pts >= 25
    return {
        "score": score,
        "factors": factors,
        "issues": issues,
        "compliant": critical_ok and inc_pts == 5,
    }


def _migrate_compliance_demo_v2(conn):
    """Разнообразные демо-данные для наглядного индекса допуска."""
    rows = conn.execute("SELECT id, badge_number FROM employees").fetchall()
    if not rows:
        return
    by_badge = {r["badge_number"]: r["id"] for r in rows}
    if "E-001" not in by_badge:
        return

    today = datetime.now().date()
    guard = conn.execute("SELECT id FROM users WHERE username='guard'").fetchone()
    guard_id = guard["id"] if guard else None
    zones = conn.execute("SELECT id, name FROM zones").fetchall()
    zone_by_name = {z["name"]: z["id"] for z in zones}

    conn.execute(
        "UPDATE sanitary_books SET expiry_date=? WHERE employee_id=? AND status='valid' AND book_number LIKE 'SB-E-002%'",
        ((today + timedelta(days=5)).isoformat(), by_badge["E-002"]),
    )
    conn.execute(
        "UPDATE medical_exams SET expiry_date=? WHERE employee_id=? AND status='valid'",
        ((today + timedelta(days=12)).isoformat(), by_badge["E-003"]),
    )

    for badge in by_badge:
        conn.execute(
            "DELETE FROM temperature_screenings WHERE employee_id=? AND date(screened_at)=date('now','localtime')",
            (by_badge[badge],),
        )

    temps = [
        ("E-001", 36.5, 1),
        ("E-002", 36.7, 1),
        ("E-003", 36.6, 1),
        ("E-004", 37.8, 0),
    ]
    for badge, t, passed in temps:
        if badge in by_badge:
            conn.execute(
                "INSERT INTO temperature_screenings(employee_id, temperature, passed, guard_id) VALUES (?,?,?,?)",
                (by_badge[badge], t, passed, guard_id),
            )

    if "E-004" in by_badge and guard_id and "Склад медикаментов" in zone_by_name:
        conn.execute(
            """INSERT INTO access_logs(employee_id, zone_id, direction, allowed, block_reason, guard_id, temperature)
               VALUES (?,?,?,?,?,?,?)""",
            (
                by_badge["E-004"],
                zone_by_name["Склад медикаментов"],
                "in",
                0,
                "Просрочен медосмотр",
                guard_id,
                37.8,
            ),
        )

    conn.commit()


def seed_demo(conn):
    today = datetime.now().date()
    users = [
        ("admin", "Admin123!", "admin", "Администратор Системы"),
        ("nurse", "Nurse123!", "nurse_chief", "Иванова Мария Петровна"),
        ("guard", "Guard123!", "guard", "Сидоров Алексей Николаевич"),
        ("employee", "Employee123!", "employee", "Петрова Анна Сергеевна"),
    ]
    user_ids = {}
    for username, password, role, full_name in users:
        cur = conn.execute(
            "INSERT INTO users(username, password_hash, role, full_name, email, email_verified, is_active) VALUES (?,?,?,?,?,1,1)",
            (username, generate_password_hash(password), role, full_name, f"{username}@clinic.local"),
        )
        user_ids[username] = cur.lastrowid

    employees = [
        ("E-001", "Петрова Анна Сергеевна", "Медсестра", "Хирургическое отделение", user_ids["employee"]),
        ("E-002", "Козлов Дмитрий Иванович", "Хирург", "Операционный блок", None),
        ("E-003", "Смирнова Елена Владимировна", "Анестезиолог", "Реанимация", None),
        ("E-004", "Никитин Павел Олегович", "Фармацевт", "Аптека", None),
    ]
    emp_ids = {}
    for badge, name, pos, dept, uid in employees:
        cur = conn.execute(
            "INSERT INTO employees(badge_number, full_name, position, department, user_id) VALUES (?,?,?,?,?)",
            (badge, name, pos, dept, uid),
        )
        emp_ids[badge] = cur.lastrowid

    zones = [
        ("Операционная №1", "operating", 3, "Стерильная зона операционного блока"),
        ("Операционная №2", "operating", 3, "Стерильная зона операционного блока"),
        ("Реанимация", "reanimation", 4, "Отделение реанимации и интенсивной терапии"),
        ("Изолятор", "isolation", 4, "Изоляционное отделение инфекционного профиля"),
        ("Склад медикаментов", "warehouse", 2, "Складское помещение медикаментов и расходников"),
    ]
    zone_ids = {}
    for name, ztype, level, desc in zones:
        cur = conn.execute(
            "INSERT INTO zones(name, zone_type, access_level, description) VALUES (?,?,?,?)",
            (name, ztype, level, desc),
        )
        zone_ids[name] = cur.lastrowid

    perms = [
        ("E-001", "Операционная №1"),
        ("E-001", "Склад медикаментов"),
        ("E-002", "Операционная №1"),
        ("E-002", "Операционная №2"),
        ("E-003", "Реанимация"),
        ("E-004", "Склад медикаментов"),
    ]
    for badge, zname in perms:
        conn.execute(
            "INSERT INTO employee_zone_permissions(employee_id, zone_id, granted_by) VALUES (?,?,?)",
            (emp_ids[badge], zone_ids[zname], user_ids["admin"]),
        )

    book_expiries = {
        "E-001": today + timedelta(days=180),
        "E-002": today + timedelta(days=5),
        "E-003": today + timedelta(days=90),
        "E-004": today + timedelta(days=120),
    }
    exam_expiries = {
        "E-001": today + timedelta(days=275),
        "E-002": today + timedelta(days=200),
        "E-003": today + timedelta(days=12),
        "E-004": today + timedelta(days=240),
    }
    temps = {
        "E-001": (36.5, 1),
        "E-002": (36.7, 1),
        "E-003": (36.6, 1),
        "E-004": (37.8, 0),
    }
    for badge in emp_ids:
        conn.execute(
            "INSERT INTO sanitary_books(employee_id, book_number, issue_date, expiry_date, status) VALUES (?,?,?,?,?)",
            (
                emp_ids[badge],
                f"SB-{badge}",
                (today - timedelta(days=180)).isoformat(),
                book_expiries[badge].isoformat(),
                "valid",
            ),
        )
        conn.execute(
            "INSERT INTO medical_exams(employee_id, exam_date, expiry_date, result, status) VALUES (?,?,?,?,?)",
            (
                emp_ids[badge],
                (today - timedelta(days=90)).isoformat(),
                exam_expiries[badge].isoformat(),
                "passed",
                "valid",
            ),
        )
        t, passed = temps[badge]
        conn.execute(
            "INSERT INTO temperature_screenings(employee_id, temperature, passed, guard_id) VALUES (?,?,?,?)",
            (emp_ids[badge], t, passed, user_ids["guard"]),
        )

    conn.execute(
        "INSERT INTO sanitary_books(employee_id, book_number, issue_date, expiry_date, status) VALUES (?,?,?,?,?)",
        (emp_ids["E-002"], "SB-E-002-OLD", (today - timedelta(days=400)).isoformat(), (today - timedelta(days=10)).isoformat(), "expired"),
    )

    if "Склад медикаментов" in zone_ids:
        conn.execute(
            """INSERT INTO access_logs(employee_id, zone_id, direction, allowed, block_reason, guard_id, temperature)
               VALUES (?,?,?,?,?,?,?)""",
            (
                emp_ids["E-004"],
                zone_ids["Склад медикаментов"],
                "in",
                0,
                "Повышенная температура",
                user_ids["guard"],
                37.8,
            ),
        )

    conn.commit()


def row_to_dict(row):
    if row is None:
        return None
    return dict(row)


def rows_to_list(rows):
    return [dict(r) for r in rows]


def audit(user_id, action, table_name=None, record_id=None, details=None):
    conn = get_conn()
    conn.execute(
        "INSERT INTO audit_log(user_id, action, table_name, record_id, details) VALUES (?,?,?,?,?)",
        (user_id, action, table_name, record_id, json.dumps(details, ensure_ascii=False) if details else None),
    )
    conn.commit()
    conn.close()


def check_employee_compliance(employee_id):
    conn = get_conn()
    today = datetime.now().date().isoformat()
    violations = []

    emp = conn.execute("SELECT * FROM employees WHERE id=? AND is_active=1", (employee_id,)).fetchone()
    if not emp:
        conn.close()
        return False, ["Сотрудник не найден или деактивирован"]

    book = conn.execute(
        """SELECT * FROM sanitary_books WHERE employee_id=? AND status='valid'
           ORDER BY expiry_date DESC LIMIT 1""",
        (employee_id,),
    ).fetchone()
    if not book or book["expiry_date"] < today:
        violations.append("Просрочена или отсутствует санитарная книжка")

    exam = conn.execute(
        """SELECT * FROM medical_exams WHERE employee_id=? AND status='valid'
           ORDER BY expiry_date DESC LIMIT 1""",
        (employee_id,),
    ).fetchone()
    if not exam or exam["expiry_date"] < today:
        violations.append("Просрочен или отсутствует медосмотр")

    temp = conn.execute(
        """SELECT * FROM temperature_screenings WHERE employee_id=?
           AND date(screened_at)=date('now','localtime')
           ORDER BY screened_at DESC LIMIT 1""",
        (employee_id,),
    ).fetchone()
    if not temp:
        violations.append("Не проведён температурный скрининг сегодня")
    elif not temp["passed"] or temp["temperature"] > 37.0:
        violations.append(f"Температура {temp['temperature']}°C — допуск не получен")

    conn.close()
    return len(violations) == 0, violations


def has_zone_permission(employee_id, zone_id):
    conn = get_conn()
    row = conn.execute(
        "SELECT 1 FROM employee_zone_permissions WHERE employee_id=? AND zone_id=?",
        (employee_id, zone_id),
    ).fetchone()
    conn.close()
    return row is not None
