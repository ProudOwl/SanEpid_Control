import os
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from config import DATA_DIR, smtp_configured


class MailDeliveryError(Exception):
    pass


def _smtp_settings():
    host = os.environ.get("SMTP_HOST", "").strip()
    port = int(os.environ.get("SMTP_PORT", "587"))
    user = os.environ.get("SMTP_USER", "").strip()
    password = os.environ.get("SMTP_PASSWORD", "").strip()
    sender = os.environ.get("SMTP_FROM", user)
    use_tls = os.environ.get("SMTP_TLS", "1") == "1"
    use_ssl = os.environ.get("SMTP_SSL", "0") == "1"
    return host, port, user, password, sender, use_tls, use_ssl


def _html_email(full_name: str, code: str) -> str:
    return f"""<!DOCTYPE html>
<html lang="ru"><head><meta charset="UTF-8"></head>
<body style="margin:0;background:#eef5f9;font-family:Segoe UI,Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
    <table width="520" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 8px 30px rgba(0,60,90,.12)">
      <tr><td style="background:linear-gradient(135deg,#0077b6,#00a896);padding:24px 28px;color:#fff">
        <div style="font-size:22px;font-weight:800">SanEpid Control</div>
        <div style="opacity:.9;margin-top:4px">Подтверждение регистрации</div>
      </td></tr>
      <tr><td style="padding:28px;color:#123047;line-height:1.6">
        <p>Здравствуйте, <strong>{full_name}</strong>!</p>
        <p>Для завершения регистрации в системе контроля доступа и санэпидбезопасности введите код:</p>
        <div style="text-align:center;margin:24px 0">
          <span style="display:inline-block;font-size:32px;letter-spacing:8px;font-weight:800;color:#0077b6;background:#e3f2fa;padding:16px 28px;border-radius:12px">{code}</span>
        </div>
        <p style="font-size:13px;color:#5b7a8f">Код действует <strong>15 минут</strong>. Обработка персональных данных — в соответствии с 152-ФЗ. Никому не сообщайте код.</p>
      </td></tr>
      <tr><td style="padding:16px 28px;background:#f8fbfd;font-size:12px;color:#5b7a8f">SanEpid Control · клиника / стационар</td></tr>
    </table>
  </td></tr></table>
</body></html>"""


def send_verification_email(to_email, full_name, code):
    if not smtp_configured():
        raise MailDeliveryError(
            "SMTP не настроен. Заполните config/smtp.env (скопируйте из smtp.env.example) и перезапустите START.bat"
        )

    host, port, user, password, sender, use_tls, use_ssl = _smtp_settings()
    subject = "SanEpid Control — код подтверждения регистрации"
    text_body = (
        f"Здравствуйте, {full_name}!\n\nКод подтверждения SanEpid Control: {code}\n"
        f"Код действует 15 минут.\n\n— SanEpid Control"
    )

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = sender
    msg["To"] = to_email
    msg.attach(MIMEText(text_body, "plain", "utf-8"))
    msg.attach(MIMEText(_html_email(full_name, code), "html", "utf-8"))

    try:
        if use_ssl:
            with smtplib.SMTP_SSL(host, port, timeout=30) as smtp:
                if user and password:
                    smtp.login(user, password)
                smtp.sendmail(sender, [to_email], msg.as_string())
        else:
            with smtplib.SMTP(host, port, timeout=30) as smtp:
                if use_tls:
                    smtp.starttls()
                if user and password:
                    smtp.login(user, password)
                smtp.sendmail(sender, [to_email], msg.as_string())
    except smtplib.SMTPException as exc:
        raise MailDeliveryError(f"Не удалось отправить письмо: {exc}") from exc

    return {"sent_via": "smtp", "to": to_email}


def send_test_email(to_email: str, admin_name: str):
    if not smtp_configured():
        raise MailDeliveryError(
            "SMTP не настроен. Заполните config/smtp.env (скопируйте из smtp.env.example) и перезапустите START.bat"
        )
    host, port, user, password, sender, use_tls, use_ssl = _smtp_settings()
    subject = "SanEpid Control — тестовое письмо"
    text_body = (
        f"Здравствуйте, {admin_name}!\n\n"
        "Это тестовое письмо SanEpid Control. SMTP настроен корректно.\n\n— SanEpid Control"
    )
    html = f"""<!DOCTYPE html><html><body style="font-family:Segoe UI,Arial,sans-serif;background:#eef5f9;padding:24px">
      <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:14px;padding:24px">
        <h2 style="color:#0077b6">SanEpid Control</h2>
        <p>Здравствуйте, <strong>{admin_name}</strong>!</p>
        <p>SMTP работает. Регистрация с кодом на email будет отправляться через этот сервер.</p>
      </div></body></html>"""
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = sender
    msg["To"] = to_email
    msg.attach(MIMEText(text_body, "plain", "utf-8"))
    msg.attach(MIMEText(html, "html", "utf-8"))
    try:
        if use_ssl:
            with smtplib.SMTP_SSL(host, port, timeout=30) as smtp:
                if user and password:
                    smtp.login(user, password)
                smtp.sendmail(sender, [to_email], msg.as_string())
        else:
            with smtplib.SMTP(host, port, timeout=30) as smtp:
                if use_tls:
                    smtp.starttls()
                if user and password:
                    smtp.login(user, password)
                smtp.sendmail(sender, [to_email], msg.as_string())
    except smtplib.SMTPException as exc:
        raise MailDeliveryError(f"Не удалось отправить письмо: {exc}") from exc
    return {"sent_via": "smtp", "to": to_email}
