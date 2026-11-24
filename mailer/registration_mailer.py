#!/usr/bin/env python3
"""Gửi email xác nhận đăng ký chiến dịch và thông báo hàng loạt của Hà Nội Xanh.

Worker polling chỉ gọi RA ngoài (Supabase REST/Auth Admin API và máy chủ SMTP),
không cần địa chỉ công khai. Mỗi vòng:

1. lấy các lượt đăng ký chưa gửi thư (confirmation_email_sent_at is null);
2. với mỗi lượt: lấy email từ Supabase Auth, tên từ profiles, thông tin chiến dịch;
3. điền mẫu thư có sẵn và gửi qua SMTP;
4. đánh dấu đã gửi (hoặc ghi lỗi để thử lại / bỏ qua);
5. sau đó xử lý thông báo hàng loạt đã được admin duyệt (module announcements.py).

Chỉ dùng thư viện chuẩn của Python (>= 3.10).
"""

from __future__ import annotations

import argparse
import errno
import hashlib
import html
import json
import logging
import os
import re
import signal
import smtplib
import socket
import ssl
import sys
import tempfile
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone, tzinfo
from email.message import EmailMessage
from email.utils import formatdate, make_msgid, parseaddr
from pathlib import Path
from string import Template
from typing import Any, Callable, Mapping, Optional
from urllib import error as urlerror
from urllib import request as urlrequest
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

try:
    import fcntl  # chỉ có trên Linux/macOS
except ImportError:  # Windows: bỏ qua khóa chống chạy hai tiến trình
    fcntl = None  # type: ignore[assignment]

LOG = logging.getLogger("hnx.mailer")

HERE = Path(__file__).resolve().parent
TEMPLATES_DIR = HERE / "templates"
DEFAULT_ENV_FILE = HERE / ".env"
DEFAULT_LOCK_FILE = HERE / ".mailer.lock"

DEFAULT_TIMEZONE = "Asia/Ho_Chi_Minh"
DEFAULT_FROM = "Hà Nội Xanh <hanoixanhh@gmail.com>"
SUBJECT_PREFIX = "Hà Nội Xanh – Xác nhận đăng ký: "
PENDING_LIMIT = 20
HTTP_TIMEOUT = 20
SMTP_TIMEOUT = 30
ERROR_MAX_LEN = 300
TBD_TEXT = "Sẽ cập nhật"
BACKOFF_MAX_SECONDS = 300  # trần thời gian chờ khi gặp sự cố chung (5 phút)
LOCAL_HOSTS = ("localhost", "127.0.0.1", "::1")

# Mã thoát của chương trình.
EXIT_OK = 0
EXIT_SYSTEM_ERROR = 1  # sự cố chung (SMTP/Supabase) ở chế độ --once / --dry-run
EXIT_CONFIG_ERROR = 2
EXIT_ALREADY_RUNNING = 3

ENV_KEYS = (
    "SUPABASE_URL",
    "SUPABASE_SERVICE_KEY",
    "SITE_URL",
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_SECURITY",
    "SMTP_USER",
    "SMTP_PASSWORD",
    "MAIL_FROM",
    "MAIL_REPLY_TO",
    "POLL_SECONDS",
    "MAX_ATTEMPTS",
    "MAILER_TIMEZONE",
    "ANNOUNCEMENTS_ENABLED",
    "ANNOUNCE_PER_MINUTE",
    "MAILER_DAILY_LIMIT",
)


# --------------------------------------------------------------------------
# Lỗi
# --------------------------------------------------------------------------


class MailerError(Exception):
    """Lỗi gốc của chương trình.

    `code` là mã lỗi ngắn, cố định (ví dụ smtp_recipient_refused). Chỉ mã này được ghi vào
    cột confirmation_email_error; chi tiết đầy đủ (message) chỉ ghi vào log.
    """

    def __init__(self, message: str = "", code: str = "unknown_error"):
        super().__init__(message)
        self.code = code


class ConfigError(MailerError):
    """Cấu hình thiếu hoặc sai."""


class PermanentError(MailerError):
    """Lỗi RIÊNG của một dòng, không thể tự khỏi (thiếu email, chiến dịch không tồn tại): không thử lại."""


class TransientError(MailerError):
    """Lỗi RIÊNG của một dòng nhưng có thể tự khỏi: tăng số lần thử của dòng đó, vòng sau thử lại."""


class SystemicError(MailerError):
    """Sự cố CHUNG (SMTP/Supabase hỏng, sai mật khẩu hoặc key): không do dòng nào gây ra.

    Không tăng số lần thử của dòng nào; vòng hiện tại dừng và vòng sau chờ lâu hơn (backoff).
    `sent` = True nghĩa là thư của dòng đang xử lý ĐÃ gửi nhưng không ghi được trạng thái.
    """

    def __init__(self, message: str, code: str, *, sent: bool = False):
        super().__init__(message, code)
        self.sent = sent


class LockHeldError(MailerError):
    """Có tiến trình mailer khác đang chạy (giữ khóa file)."""


class SupabaseError(MailerError):
    """Supabase trả lỗi HTTP hoặc không kết nối được (status = 0)."""

    def __init__(self, status: int, message: str):
        super().__init__(message, "supabase_error")
        self.status = status


def classify_supabase_error(exc: SupabaseError) -> Optional[str]:
    """Mã sự cố CHUNG nếu lỗi Supabase không phải do một dòng cụ thể, ngược lại None.

    Không kết nối được (0), 401/403 (key sai/bị thu hồi), 429, 5xx và phản hồi không phải JSON
    đều ảnh hưởng mọi dòng như nhau nên không được tính vào số lần thử của dòng nào.
    """
    status = exc.status
    if status == 0:
        return "supabase_unreachable"
    if status in (401, 403):
        return "supabase_unauthorized"
    if status == 429:
        return "supabase_rate_limited"
    if status >= 500:
        return "supabase_server_error"
    if status < 400:
        return "supabase_bad_response"
    return None


# --------------------------------------------------------------------------
# Hàm thuần: đọc env, cấu hình
# --------------------------------------------------------------------------


def parse_env_text(text: str) -> dict[str, str]:
    """Đọc nội dung dạng KEY=VALUE (bỏ dòng trống, dòng bắt đầu bằng #, tiền tố export)."""
    values: dict[str, str] = {}
    for raw in text.lstrip("﻿").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export "):].lstrip()
        key, sep, value = line.partition("=")
        key = key.strip()
        if not sep or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        else:
            # Chú thích cuối dòng chỉ áp dụng cho giá trị không đặt trong dấu nháy.
            value = re.split(r"\s+#", value, maxsplit=1)[0].strip()
        values[key] = value
    return values


def read_env_file(path: Path) -> dict[str, str]:
    if not path.is_file():
        return {}
    return parse_env_text(path.read_text(encoding="utf-8"))


def merge_env(file_values: Mapping[str, str], environ: Mapping[str, str]) -> dict[str, str]:
    """Biến môi trường thật (khác rỗng) được ưu tiên hơn file .env."""
    merged = {k: v for k, v in file_values.items() if k in ENV_KEYS}
    for key in ENV_KEYS:
        value = environ.get(key)
        if value is not None and value.strip() != "":
            merged[key] = value
    return merged


@dataclass(frozen=True)
class Config:
    supabase_url: str
    service_key: str = field(repr=False)
    site_url: str
    smtp_host: str
    smtp_port: int
    smtp_security: str
    smtp_user: str
    smtp_password: str = field(repr=False)
    mail_from: str
    mail_reply_to: str
    poll_seconds: int
    max_attempts: int
    timezone_name: str
    announcements_enabled: bool = True
    announce_per_minute: int = 20  # số thư thông báo tối đa mỗi phút (tránh bị Gmail khóa)
    daily_limit: int = 400  # tổng thư (xác nhận + thông báo + thử) mỗi ngày

    @property
    def tz(self) -> tzinfo:
        return resolve_timezone(self.timezone_name)

    @property
    def secrets(self) -> list[str]:
        return [s for s in (self.service_key, self.smtp_password) if s]


_tz_fallback_warned = False


def resolve_timezone(name: str) -> tzinfo:
    """ZoneInfo(name); riêng Asia/Ho_Chi_Minh dự phòng UTC+7 nếu máy thiếu dữ liệu tzdata.

    Việt Nam không có giờ mùa hè nên UTC+7 cố định luôn đúng. Tên múi giờ khác thì ném lại lỗi.
    """
    global _tz_fallback_warned
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError, OSError):
        if name != DEFAULT_TIMEZONE:
            raise
        if not _tz_fallback_warned:
            _tz_fallback_warned = True
            LOG.warning(
                "Máy thiếu dữ liệu múi giờ (tzdata), dùng UTC+7 cố định cho %s. "
                "Nên cài tzdata: pip install tzdata hoặc gói tzdata của hệ điều hành.",
                DEFAULT_TIMEZONE,
            )
        return timezone(timedelta(hours=7), DEFAULT_TIMEZONE)


def _is_http_url(value: str) -> bool:
    return safe_http_url(value) is not None


def _valid_address(value: str) -> bool:
    addr = parseaddr(value)[1]
    return bool(re.fullmatch(r"[^@\s<>\",;]+@[^@\s<>\",;]+\.[^@\s<>\",;]+", addr))


def load_config(env: Mapping[str, str], *, dry_run: bool = False) -> Config:
    """Kiểm tra và dựng cấu hình. Thiếu/sai biến thì ConfigError liệt kê hết một lượt."""
    problems: list[str] = []

    def get(key: str, default: str = "") -> str:
        return (env.get(key) or default).strip()

    def get_int(key: str, default: int, minimum: int, maximum: int) -> int:
        raw = get(key)
        if not raw:
            return default
        try:
            number = int(raw)
        except ValueError:
            problems.append(f"{key} phải là số nguyên (đang là {raw!r}).")
            return default
        if not minimum <= number <= maximum:
            problems.append(f"{key} phải nằm trong khoảng {minimum}-{maximum}.")
            return default
        return number

    def get_bool(key: str, default: bool) -> bool:
        raw = get(key).lower()
        if not raw:
            return default
        if raw in ("1", "true", "yes", "on"):
            return True
        if raw in ("0", "false", "no", "off"):
            return False
        problems.append(f"{key} chỉ nhận true hoặc false (đang là {raw!r}).")
        return default

    required = ["SUPABASE_URL", "SUPABASE_SERVICE_KEY", "SITE_URL"]
    if not dry_run:
        required += ["SMTP_HOST", "MAIL_FROM"]
    missing = [key for key in required if not get(key)]
    if missing:
        problems.append("Thiếu biến bắt buộc: " + ", ".join(missing) + ".")

    supabase_url = get("SUPABASE_URL").rstrip("/")
    if supabase_url and not _is_http_url(supabase_url):
        problems.append("SUPABASE_URL phải bắt đầu bằng http:// hoặc https://.")
    site_url = get("SITE_URL").rstrip("/")
    if site_url and not _is_http_url(site_url):
        problems.append("SITE_URL phải bắt đầu bằng http:// hoặc https://.")

    security = get("SMTP_SECURITY", "starttls").lower()
    if security not in ("starttls", "ssl", "none"):
        problems.append("SMTP_SECURITY chỉ nhận starttls, ssl hoặc none.")
        security = "starttls"

    smtp_port = get_int("SMTP_PORT", 587, 1, 65535)
    poll = get_int("POLL_SECONDS", 30, 1, 86400)
    max_attempts = get_int("MAX_ATTEMPTS", 5, 1, 100)
    announcements_enabled = get_bool("ANNOUNCEMENTS_ENABLED", True)
    announce_per_minute = get_int("ANNOUNCE_PER_MINUTE", 20, 1, 120)
    daily_limit = get_int("MAILER_DAILY_LIMIT", 400, 1, 100000)

    smtp_user = get("SMTP_USER")
    smtp_password = env.get("SMTP_PASSWORD") or ""
    if bool(smtp_user) != bool(smtp_password):
        problems.append("SMTP_USER và SMTP_PASSWORD phải được đặt cùng nhau (hoặc cùng bỏ trống).")
    if (
        not dry_run
        and security == "none"
        and smtp_user
        and get("SMTP_HOST").lower().strip("[]") not in LOCAL_HOSTS
    ):
        problems.append(
            "SMTP_SECURITY=none sẽ gửi mật khẩu SMTP dạng rõ qua mạng, nên bị từ chối. "
            "Dùng starttls hoặc ssl; chỉ cho phép none khi SMTP_HOST là localhost, 127.0.0.1 hoặc ::1."
        )

    mail_from = get("MAIL_FROM", DEFAULT_FROM if dry_run else "")
    if mail_from and not _valid_address(mail_from):
        problems.append("MAIL_FROM không đúng dạng, ví dụ: Hà Nội Xanh <hanoixanhh@gmail.com>.")
    if re.search(r"[\r\n]", mail_from):
        problems.append("MAIL_FROM không được chứa xuống dòng.")
    reply_to = get("MAIL_REPLY_TO")
    if reply_to and (not _valid_address(reply_to) or re.search(r"[\r\n]", reply_to)):
        problems.append("MAIL_REPLY_TO không đúng dạng địa chỉ email.")

    tz_name = get("MAILER_TIMEZONE", DEFAULT_TIMEZONE)
    try:
        resolve_timezone(tz_name)
    except (ZoneInfoNotFoundError, ValueError, OSError):
        problems.append(
            f"MAILER_TIMEZONE không hợp lệ hoặc máy thiếu dữ liệu múi giờ: {tz_name!r}. "
            "Dùng tên IANA như Asia/Ho_Chi_Minh. Nếu tên đúng mà vẫn lỗi, hãy cài tzdata: "
            "`pip install tzdata` hoặc gói hệ điều hành (Debian/Ubuntu: apt install tzdata; Alpine: apk add tzdata)."
        )
        tz_name = DEFAULT_TIMEZONE

    if problems:
        raise ConfigError("\n".join(problems))

    return Config(
        supabase_url=supabase_url,
        service_key=get("SUPABASE_SERVICE_KEY"),
        site_url=site_url,
        smtp_host=get("SMTP_HOST"),
        smtp_port=smtp_port,
        smtp_security=security,
        smtp_user=smtp_user,
        smtp_password=smtp_password,
        mail_from=mail_from,
        mail_reply_to=reply_to,
        poll_seconds=poll,
        max_attempts=max_attempts,
        timezone_name=tz_name,
        announcements_enabled=announcements_enabled,
        announce_per_minute=announce_per_minute,
        daily_limit=daily_limit,
    )


# --------------------------------------------------------------------------
# Hàm thuần: UUID, thời gian, URL, làm sạch chuỗi
# --------------------------------------------------------------------------

_UUID_RE = re.compile(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")


def parse_uuid(value: Any) -> Optional[str]:
    """Trả UUID viết thường nếu hợp lệ, ngược lại None. Dùng trước khi đưa vào URL REST."""
    if not isinstance(value, str):
        return None
    candidate = value.strip()
    return candidate.lower() if _UUID_RE.fullmatch(candidate) else None


def pick_campaign_id(registration: Mapping[str, Any]) -> Optional[str]:
    """campaign_id nếu có, ngược lại campaign_key (chỉ nhận khi là UUID hợp lệ)."""
    campaign_id = registration.get("campaign_id")
    if campaign_id:
        return parse_uuid(campaign_id)
    return parse_uuid(registration.get("campaign_key"))


def parse_datetime(value: Any) -> Optional[datetime]:
    """Đọc chuỗi ISO 8601 có hoặc không múi giờ; không múi giờ thì coi là UTC."""
    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, str) and value.strip():
        text = value.strip()
        if text[-1] in "zZ":
            text = text[:-1] + "+00:00"
        # Python 3.10 chỉ nhận phần thập phân 3 hoặc 6 chữ số và múi giờ ±HH:MM.
        text = re.sub(r"\.(\d+)", lambda m: "." + m.group(1)[:6].ljust(6, "0"), text, count=1)
        text = re.sub(r"([T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)([+-]\d{2})$", r"\1\2:00", text)
        try:
            parsed = datetime.fromisoformat(text)
        except ValueError:
            return None
    else:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def format_datetime(value: Any, tz: tzinfo) -> Optional[str]:
    """dd/MM/yyyy HH:mm theo múi giờ tz; None nếu không đọc được."""
    parsed = parse_datetime(value)
    if parsed is None:
        return None
    return parsed.astimezone(tz).strftime("%d/%m/%Y %H:%M")


def safe_http_url(value: Any) -> Optional[str]:
    """Chỉ nhận liên kết http/https, không khoảng trắng hay ký tự điều khiển."""
    if not isinstance(value, str):
        return None
    url = value.strip()
    if not re.fullmatch(r"https?://[^\s<>\"'\\\x00-\x1f\x7f]+", url, flags=re.IGNORECASE):
        return None
    return url


def build_campaign_url(site_url: str, campaign_id: str) -> str:
    return f"{site_url.rstrip('/')}/chien-dich?campaign={campaign_id}"


def clean_inline(value: Any, limit: int = 300) -> str:
    """Gộp mọi khoảng trắng/xuống dòng/ký tự điều khiển thành một dấu cách và cắt ngắn."""
    if value is None:
        return ""
    text = re.sub(r"[\s\x00-\x1f\x7f]+", " ", str(value)).strip()
    if len(text) > limit:
        text = text[: limit - 1].rstrip() + "…"
    return text


def display_name(full_name: Any, email: str) -> str:
    name = clean_inline(full_name, 100)
    if name:
        return name
    local = clean_inline(email.partition("@")[0], 100)
    return local or "bạn"


def mask_email(email: str) -> str:
    local, _, domain = email.partition("@")
    return f"{local[:1]}***@{domain}" if domain else "***"


def scrub(text: str, secrets: list[str]) -> str:
    """Xóa mọi giá trị bí mật khỏi văn bản và cắt ngắn trước khi ghi log/DB."""
    for secret in secrets:
        if secret:
            text = text.replace(secret, "***")
    text = re.sub(r"\s+", " ", text).strip()
    return text[:ERROR_MAX_LEN]


# --------------------------------------------------------------------------
# Hàm thuần: dựng thư
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class RenderedEmail:
    subject: str
    text: str
    html: str


def load_template(name: str, directory: Path = TEMPLATES_DIR) -> Template:
    return Template((directory / name).read_text(encoding="utf-8"))


def describe_time(start_at: Any, end_at: Any, tz: tzinfo) -> str:
    start = format_datetime(start_at, tz)
    end = format_datetime(end_at, tz)
    if start and end:
        return f"Chiến dịch sẽ diễn ra từ {start} đến {end}."
    if start:
        return f"Chiến dịch sẽ bắt đầu lúc {start}."
    return "Thời gian diễn ra sẽ được cập nhật sau."


def render_email(
    *,
    name: str,
    campaign_title: str,
    location: str,
    start_at: Any,
    end_at: Any,
    campaign_url: str,
    tz: tzinfo,
    templates_dir: Path = TEMPLATES_DIR,
) -> RenderedEmail:
    ten = clean_inline(name, 100) or "bạn"
    chien_dich = clean_inline(campaign_title, 200) or "chiến dịch của Hà Nội Xanh"
    dia_diem = clean_inline(location, 300) or TBD_TEXT
    thoi_gian = describe_time(start_at, end_at, tz)
    link = safe_http_url(campaign_url)

    subject = clean_inline(SUBJECT_PREFIX + chien_dich, 200)

    text_link = f"Xem chi tiết chiến dịch: {link}\n" if link else ""
    text = load_template("registration_confirmation.txt", templates_dir).substitute(
        ten=ten,
        chien_dich=chien_dich,
        thoi_gian=thoi_gian,
        dia_diem=dia_diem,
        dong_lien_ket=text_link,
    )

    esc = html.escape
    if link:
        href = esc(link, quote=True)
        button = (
            '<p style="margin:0 0 18px;">'
            f'<a href="{href}" style="display:inline-block;background-color:#15803d;color:#ffffff;'
            'text-decoration:none;padding:11px 22px;border-radius:8px;font-weight:bold;">'
            "Xem chi tiết chiến dịch</a></p>"
            f'<p style="margin:0 0 18px;font-size:13px;color:#6b7280;">Nếu nút không mở được, hãy sao chép liên kết: {esc(link)}</p>'
        )
    else:
        button = ""
    body_html = load_template("registration_confirmation.html", templates_dir).substitute(
        ten=esc(ten),
        chien_dich=esc(chien_dich),
        thoi_gian=esc(thoi_gian),
        dia_diem=esc(dia_diem),
        nut_xem=button,
    )
    return RenderedEmail(subject=subject, text=text, html=body_html)


def build_message(
    rendered: RenderedEmail,
    *,
    to_addr: str,
    from_addr: str,
    reply_to: str = "",
    extra_headers: Optional[Mapping[str, str]] = None,
) -> EmailMessage:
    """multipart/alternative (text + html), UTF-8, có Message-ID và Date."""
    if re.search(r"[\s<>\",;]", to_addr) or not _valid_address(to_addr):
        raise PermanentError("Địa chỉ email người nhận không hợp lệ.", "invalid_recipient")
    msg = EmailMessage()
    msg["Subject"] = rendered.subject
    msg["From"] = from_addr
    msg["To"] = to_addr
    if reply_to:
        msg["Reply-To"] = reply_to
    msg["Date"] = formatdate(localtime=False)
    domain = parseaddr(from_addr)[1].rpartition("@")[2] or None
    msg["Message-ID"] = make_msgid(domain=domain)
    msg["Auto-Submitted"] = "auto-generated"
    for header, value in (extra_headers or {}).items():
        # Giá trị header do mã của mailer đặt, nhưng vẫn gộp mọi ký tự điều khiển để không thể chèn header khác.
        msg[header] = clean_inline(value, 200)
    msg.set_content(rendered.text, subtype="plain", charset="utf-8")
    msg.add_alternative(rendered.html, subtype="html", charset="utf-8")
    return msg


# --------------------------------------------------------------------------
# I/O: HTTP tới Supabase
# --------------------------------------------------------------------------

HttpFunc = Callable[[str, str, dict, Optional[bytes], float], "tuple[int, bytes]"]


def default_http(method: str, url: str, headers: dict, body: Optional[bytes], timeout: float):
    req = urlrequest.Request(url, data=body, headers=headers, method=method)
    try:
        with urlrequest.urlopen(req, timeout=timeout) as resp:  # noqa: S310 - URL do cấu hình
            return resp.status, resp.read()
    except urlerror.HTTPError as exc:
        return exc.code, exc.read()


class SupabaseClient:
    def __init__(
        self,
        base_url: str,
        service_key: str,
        *,
        http: HttpFunc = default_http,
        sleep: Callable[[float], None] = time.sleep,
        timeout: float = HTTP_TIMEOUT,
    ):
        self.base_url = base_url.rstrip("/")
        self._key = service_key
        self._http = http
        self._sleep = sleep
        self._timeout = timeout

    def _call(self, method: str, path: str, body: Any = None, *, minimal: bool = False) -> Any:
        headers = {
            "apikey": self._key,
            "Authorization": f"Bearer {self._key}",
            "Accept": "application/json",
        }
        data = None
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        if minimal:
            headers["Prefer"] = "return=minimal"
        try:
            status, raw = self._http(method, self.base_url + path, headers, data, self._timeout)
        except OSError as exc:  # URLError, timeout, ConnectionError đều là OSError
            raise SupabaseError(0, f"Không kết nối được Supabase ({type(exc).__name__})") from None
        if status >= 400:
            snippet = raw[:200].decode("utf-8", "replace") if raw else ""
            raise SupabaseError(status, f"Supabase trả HTTP {status}: {snippet}")
        if not raw:
            return None
        try:
            return json.loads(raw)
        except ValueError:
            raise SupabaseError(status, "Supabase trả dữ liệu không phải JSON") from None

    def rpc(self, name: str, args: Optional[Mapping[str, Any]] = None) -> Any:
        """Gọi hàm Postgres qua PostgREST (POST /rest/v1/rpc/<name>); trả JSON đã giải mã."""
        if not re.fullmatch(r"[a-z_][a-z0-9_]*", name):
            raise PermanentError("Tên hàm RPC không hợp lệ.", "invalid_rpc")
        return self._call("POST", f"/rest/v1/rpc/{name}", dict(args or {}))

    @staticmethod
    def _uuid(value: Any, code: str = "invalid_id") -> str:
        parsed = parse_uuid(value)
        if parsed is None:
            raise PermanentError("Mã định danh không phải UUID hợp lệ.", code)
        return parsed

    def fetch_pending(self, max_attempts: int, limit: int = PENDING_LIMIT) -> list[dict]:
        query = (
            "status=eq.registered&confirmation_email_sent_at=is.null"
            f"&confirmation_email_attempts=lt.{int(max_attempts)}"
            "&select=id,user_id,campaign_id,campaign_key,confirmation_email_attempts"
            f"&order=created_at.asc&limit={int(limit)}"
        )
        rows = self._call("GET", f"/rest/v1/campaign_registrations?{query}")
        return rows if isinstance(rows, list) else []

    def get_auth_email(self, user_id: str) -> Optional[str]:
        uid = self._uuid(user_id, "invalid_user_id")
        try:
            user = self._call("GET", f"/auth/v1/admin/users/{uid}")
        except SupabaseError as exc:
            if exc.status == 404:
                raise PermanentError("Không tìm thấy tài khoản người dùng.", "auth_user_not_found") from None
            raise
        if isinstance(user, dict) and isinstance(user.get("user"), dict):
            user = user["user"]
        email = user.get("email") if isinstance(user, dict) else None
        return email.strip() if isinstance(email, str) and email.strip() else None

    def get_profile_name(self, user_id: str) -> str:
        uid = self._uuid(user_id, "invalid_user_id")
        rows = self._call("GET", f"/rest/v1/profiles?id=eq.{uid}&select=full_name&limit=1")
        if isinstance(rows, list) and rows and isinstance(rows[0], dict):
            return str(rows[0].get("full_name") or "")
        return ""

    def get_campaign(self, campaign_id: str) -> Optional[dict]:
        cid = self._uuid(campaign_id, "invalid_campaign_id")
        rows = self._call(
            "GET", f"/rest/v1/campaigns?id=eq.{cid}&select=id,title,location,start_at,end_at&limit=1"
        )
        if isinstance(rows, list) and rows and isinstance(rows[0], dict):
            return rows[0]
        return None

    def mark_sent(self, registration_id: str, when: datetime) -> None:
        rid = self._uuid(registration_id, "invalid_registration_id")
        body = {
            "confirmation_email_sent_at": when.astimezone(timezone.utc).isoformat(),
            "confirmation_email_error": None,
        }
        self._patch_with_retry(rid, body)

    def mark_failed(self, registration_id: str, attempts: int, error_code: str) -> None:
        """Ghi số lần thử và MÃ lỗi ngắn (không ghi chuỗi lỗi thô: cột này người dùng đọc được)."""
        rid = self._uuid(registration_id, "invalid_registration_id")
        error = error_code[:64]
        self._patch_with_retry(
            rid, {"confirmation_email_attempts": attempts, "confirmation_email_error": error}, retries=1
        )

    def _patch_with_retry(self, rid: str, body: dict, retries: int = 3) -> None:
        path = f"/rest/v1/campaign_registrations?id=eq.{rid}&confirmation_email_sent_at=is.null"
        last: Optional[SupabaseError] = None
        for attempt in range(retries):
            try:
                self._call("PATCH", path, body, minimal=True)
                return
            except SupabaseError as exc:
                last = exc
                if attempt + 1 < retries:
                    self._sleep(1.0 + attempt)
        assert last is not None
        raise last


# --------------------------------------------------------------------------
# I/O: SMTP
# --------------------------------------------------------------------------

SendFunc = Callable[[EmailMessage], None]

_QUOTA_RE = re.compile(r"5\.4\.5|quota|too many|rate.?limit|sending limit|daily user sending", re.IGNORECASE)


def _smtp_detail(exc: BaseException) -> str:
    return f"SMTP {type(exc).__name__}: {exc}"


def classify_smtp_error(exc: BaseException) -> MailerError:
    """Phân loại lỗi SMTP: sự cố CHUNG (SystemicError), lỗi RIÊNG vĩnh viễn (PermanentError)
    hoặc lỗi RIÊNG tạm thời (TransientError). Chỉ hai loại sau mới tính vào số lần thử của dòng."""
    detail = _smtp_detail(exc)
    # Thứ tự quan trọng: SMTPException và ssl.SSLError đều là con của OSError.
    if isinstance(exc, smtplib.SMTPRecipientsRefused):
        codes = [pair[0] for pair in exc.recipients.values() if isinstance(pair[0], int)]
        if codes and all(400 <= code < 500 for code in codes):
            return TransientError(detail, "smtp_recipient_deferred")
        return PermanentError(detail, "smtp_recipient_refused")
    if isinstance(exc, smtplib.SMTPAuthenticationError):
        return SystemicError(detail, "smtp_auth_failed")
    if isinstance(exc, smtplib.SMTPSenderRefused):
        return SystemicError(detail, "smtp_sender_refused")
    if isinstance(exc, smtplib.SMTPDataError):
        text = exc.smtp_error.decode("utf-8", "replace") if isinstance(exc.smtp_error, bytes) else str(exc.smtp_error)
        if _QUOTA_RE.search(text):
            return SystemicError(detail, "smtp_quota_exceeded")
        if 500 <= exc.smtp_code < 600:
            return PermanentError(detail, "smtp_data_rejected")
        return SystemicError(detail, "smtp_temporary_failure")
    if isinstance(exc, smtplib.SMTPConnectError):
        return SystemicError(detail, "smtp_connect_failed")
    if isinstance(exc, smtplib.SMTPServerDisconnected):
        return SystemicError(detail, "smtp_server_disconnected")
    if isinstance(exc, smtplib.SMTPNotSupportedError):
        return SystemicError(detail, "smtp_not_supported")
    if isinstance(exc, smtplib.SMTPHeloError):
        return SystemicError(detail, "smtp_helo_failed")
    if isinstance(exc, smtplib.SMTPResponseException):  # lệnh khác bị máy chủ từ chối (vd. STARTTLS)
        return SystemicError(detail, "smtp_server_error")
    if isinstance(exc, smtplib.SMTPException):
        return TransientError(detail, "smtp_error")
    if isinstance(exc, ssl.SSLError):
        return SystemicError(detail, "smtp_tls_error")
    if isinstance(exc, (TimeoutError, socket.timeout)):
        return SystemicError(detail, "smtp_timeout")
    return SystemicError(detail, "smtp_network_error")  # OSError: DNS, từ chối kết nối, mất mạng


def make_smtp_sender(
    cfg: Config,
    *,
    smtp_factory: Callable[..., Any] = smtplib.SMTP,
    smtp_ssl_factory: Callable[..., Any] = smtplib.SMTP_SSL,
) -> SendFunc:
    def send(msg: EmailMessage) -> None:
        context = ssl.create_default_context()
        # local_hostname đặt sẵn để smtplib không gọi socket.getfqdn() (có thể treo hàng chục giây khi DNS chậm).
        hostname = socket.gethostname() or "localhost"
        delivered = False
        try:
            if cfg.smtp_security == "ssl":
                client = smtp_ssl_factory(
                    cfg.smtp_host, cfg.smtp_port, local_hostname=hostname, timeout=SMTP_TIMEOUT, context=context
                )
            else:
                client = smtp_factory(cfg.smtp_host, cfg.smtp_port, local_hostname=hostname, timeout=SMTP_TIMEOUT)
            with client:
                client.ehlo()
                if cfg.smtp_security == "starttls":
                    client.starttls(context=context)
                    client.ehlo()
                if cfg.smtp_user:
                    client.login(cfg.smtp_user, cfg.smtp_password)
                client.send_message(msg)
                delivered = True
        except (smtplib.SMTPException, OSError) as exc:
            if delivered:
                # Thư đã được máy chủ nhận; chỉ lệnh QUIT/đóng kết nối lỗi, không được coi là thất bại (tránh gửi trùng).
                LOG.warning("Thư đã gửi nhưng đóng kết nối SMTP bị lỗi: %s", _smtp_detail(exc))
                return
            raise classify_smtp_error(exc) from None

    return send


# --------------------------------------------------------------------------
# Vòng xử lý
# --------------------------------------------------------------------------


class Mailer:
    def __init__(
        self,
        cfg: Config,
        db: SupabaseClient,
        send: Optional[SendFunc],
        *,
        dry_run: bool = False,
        now: Callable[[], datetime] = lambda: datetime.now(timezone.utc),
        out: Callable[[str], None] = print,
        templates_dir: Path = TEMPLATES_DIR,
    ):
        self.cfg = cfg
        self.db = db
        self.send = send
        self.dry_run = dry_run
        self.now = now
        self.out = out
        self.templates_dir = templates_dir
        # Sự cố chung của vòng gần nhất (None nếu vòng chạy bình thường).
        self.last_systemic: Optional[SystemicError] = None
        # Bộ xử lý thông báo hàng loạt (announcements.AnnouncementWorker); None = không xử lý thông báo.
        self.announcements: Optional[Any] = None

    def _fail(self, reg: Mapping[str, Any], code: str, detail: str, permanent: bool) -> str:
        """Ghi lỗi RIÊNG của một dòng. DB chỉ nhận `code`; `detail` (đã che secret) chỉ vào log."""
        rid = str(reg.get("id"))
        try:
            current = max(int(reg.get("confirmation_email_attempts") or 0), 0)
        except (TypeError, ValueError):
            current = 0
        attempts = self.cfg.max_attempts if permanent else min(current + 1, self.cfg.max_attempts)
        detail = scrub(detail, self.cfg.secrets)
        if permanent:
            LOG.error("Đăng ký %s: lỗi không thể thử lại, bỏ qua [%s]. %s", rid, code, detail)
        elif attempts >= self.cfg.max_attempts:
            LOG.warning("Đăng ký %s: đã thử %d lần, dừng thử lại [%s]. %s", rid, attempts, code, detail)
        else:
            LOG.warning(
                "Đăng ký %s: lỗi tạm thời (lần %d/%d), sẽ thử lại [%s]. %s",
                rid, attempts, self.cfg.max_attempts, code, detail,
            )
        if self.dry_run:
            return "failed"
        try:
            self.db.mark_failed(rid, attempts, code)
        except (SupabaseError, PermanentError) as exc:
            LOG.error("Đăng ký %s: không ghi được trạng thái lỗi: %s", rid, scrub(str(exc), self.cfg.secrets))
        return "failed"

    def process(self, reg: Mapping[str, Any], campaigns: dict[str, Optional[dict]]) -> str:
        """Xử lý một lượt đăng ký. Trả 'sent', 'dry' hoặc 'failed'.

        Ném SystemicError khi gặp sự cố chung (SMTP/Supabase hỏng): dòng KHÔNG bị tính thêm lần thử nào.
        """
        rid = str(reg.get("id"))
        try:
            user_id = parse_uuid(reg.get("user_id"))
            if user_id is None:
                raise PermanentError("user_id không phải UUID hợp lệ.", "invalid_user_id")
            campaign_id = pick_campaign_id(reg)
            if campaign_id is None:
                raise PermanentError("Đăng ký không có campaign_id/campaign_key hợp lệ.", "invalid_campaign_id")

            email = self.db.get_auth_email(user_id)
            if not email:
                raise PermanentError("Tài khoản không có địa chỉ email.", "no_auth_email")

            if campaign_id not in campaigns:
                campaigns[campaign_id] = self.db.get_campaign(campaign_id)
            campaign = campaigns[campaign_id]
            if campaign is None:
                raise PermanentError("Chiến dịch không tồn tại.", "campaign_not_found")

            name = display_name(self.db.get_profile_name(user_id), email)
            rendered = render_email(
                name=name,
                campaign_title=campaign.get("title") or "",
                location=campaign.get("location") or "",
                start_at=campaign.get("start_at"),
                end_at=campaign.get("end_at"),
                campaign_url=build_campaign_url(self.cfg.site_url, campaign_id),
                tz=self.cfg.tz,
                templates_dir=self.templates_dir,
            )
            msg = build_message(
                rendered, to_addr=email, from_addr=self.cfg.mail_from, reply_to=self.cfg.mail_reply_to
            )

            if self.dry_run:
                self.out(format_dry_run(rid, msg, rendered))
                return "dry"

            if self.send is None:
                raise SystemicError("Chưa cấu hình bộ gửi SMTP.", "smtp_not_configured")
            self.send(msg)
        except SystemicError:
            raise
        except PermanentError as exc:
            return self._fail(reg, exc.code, str(exc), permanent=True)
        except TransientError as exc:
            return self._fail(reg, exc.code, str(exc), permanent=False)
        except SupabaseError as exc:
            systemic = classify_supabase_error(exc)
            if systemic:
                raise SystemicError(str(exc), systemic) from None
            return self._fail(reg, "supabase_error", str(exc), permanent=False)
        except Exception as exc:  # lỗi không lường trước: không để làm sập cả vòng
            LOG.exception("Đăng ký %s: lỗi không lường trước", rid)
            return self._fail(reg, "unexpected_error", f"{type(exc).__name__}: {exc}", permanent=False)

        # Đánh dấu ngay sau khi SMTP thành công (xem README về đánh đổi gửi trùng).
        try:
            self.db.mark_sent(rid, self.now())
        except (SupabaseError, PermanentError) as exc:
            LOG.error(
                "Đăng ký %s: ĐÃ gửi thư tới %s nhưng không ghi được trạng thái (%s). Vòng sau có thể gửi trùng.",
                rid,
                mask_email(email),
                scrub(str(exc), self.cfg.secrets),
            )
            # Dừng vòng: Supabase đang không ghi được, gửi tiếp chỉ làm tăng số thư có nguy cơ gửi trùng.
            raise SystemicError(str(exc), "supabase_write_failed", sent=True) from None
        LOG.info("Đã gửi thư xác nhận cho đăng ký %s tới %s.", rid, mask_email(email))
        return "sent"

    def _systemic(self, exc: SystemicError) -> None:
        self.last_systemic = exc
        LOG.warning(
            "Sự cố chung [%s]: %s. Dừng vòng này; KHÔNG tính vào số lần thử của dòng nào, sẽ thử lại sau một lúc.",
            exc.code,
            scrub(str(exc), self.cfg.secrets),
        )

    def run_once(self, stop: Optional[threading.Event] = None) -> dict[str, int]:
        """Một vòng xử lý. stats["systemic"] = 1 nghĩa là vòng dừng vì sự cố chung (xem self.last_systemic)."""
        stats = {
            "found": 0, "sent": 0, "dry": 0, "failed": 0, "fetch_error": 0, "systemic": 0,
            "ann_sent": 0, "ann_failed": 0, "ann_tests": 0, "ann_busy": 0,
        }
        self.last_systemic = None
        try:
            pending = self.db.fetch_pending(self.cfg.max_attempts)
        except SupabaseError as exc:
            # Không lấy nổi danh sách thì không dòng nào được xử lý: luôn là sự cố chung.
            stats["fetch_error"] = 1
            stats["systemic"] = 1
            self._systemic(
                SystemicError(f"Không lấy được danh sách đăng ký chờ gửi: {exc}", classify_supabase_error(exc) or "supabase_error")
            )
            return stats
        stats["found"] = len(pending)
        if pending:
            LOG.info("Có %d đăng ký chờ gửi thư.", len(pending))
        campaigns: dict[str, Optional[dict]] = {}
        for reg in pending:
            if stop is not None and stop.is_set():
                break
            if not isinstance(reg, dict):
                continue
            try:
                stats[self.process(reg, campaigns)] += 1
            except SystemicError as exc:
                if exc.sent:
                    stats["sent"] += 1
                stats["systemic"] = 1
                self._systemic(exc)
                break
        # Thông báo hàng loạt chạy SAU thư xác nhận (xác nhận đăng ký luôn được ưu tiên), và bị bỏ qua
        # khi vòng này đã gặp sự cố chung hoặc đang dừng.
        if self.announcements is not None and not stats["systemic"] and not (stop is not None and stop.is_set()):
            try:
                result = self.announcements.run_round(stop)
            except SystemicError as exc:
                stats["systemic"] = 1
                self._systemic(exc)
            else:
                stats["ann_sent"] = result.get("sent", 0)
                stats["ann_failed"] = result.get("failed", 0)
                stats["ann_tests"] = result.get("tests", 0)
                stats["ann_busy"] = 1 if result.get("busy") else 0
        return stats


def format_dry_run(rid: str, msg: EmailMessage, rendered: RenderedEmail) -> str:
    return (
        f"===== DRY-RUN: đăng ký {rid} (không gửi, không ghi DB) =====\n"
        f"From: {msg['From']}\nTo: {msg['To']}\nSubject: {msg['Subject']}\n\n"
        f"{rendered.text}\n"
    )


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------

DEMO_DATA = dict(
    name="Nguyễn Văn An",
    campaign_title="Dọn rác kênh Mương - Hà Đông",
    location="Kênh Mương, phường Hà Cầu, quận Hà Đông, Hà Nội",
    start_at="2026-11-29T00:30:00+00:00",
    end_at="2026-11-29T04:30:00+00:00",
    campaign_url="https://hanoixanh.example.com/chien-dich?campaign=11111111-2222-4333-8444-555555555555",
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Gửi email xác nhận đăng ký chiến dịch Hà Nội Xanh (worker polling)."
    )
    parser.add_argument("--once", action="store_true", help="chạy một vòng rồi thoát")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="render và in thư ra màn hình, KHÔNG gửi SMTP, KHÔNG ghi DB (tự chạy một vòng)",
    )
    parser.add_argument("--demo", action="store_true", help="in thử mẫu thư với dữ liệu mẫu, không cần cấu hình")
    parser.add_argument(
        "--demo-announcement",
        action="store_true",
        help="in thử một thư thông báo hàng loạt với dữ liệu giả, không cần cấu hình",
    )
    parser.add_argument(
        "--html-out", metavar="FILE", help="với --demo / --demo-announcement: ghi bản HTML ra file để xem bằng trình duyệt"
    )
    parser.add_argument("--env-file", metavar="FILE", default=str(DEFAULT_ENV_FILE), help="đường dẫn file .env (mặc định mailer/.env)")
    parser.add_argument("-v", "--verbose", action="store_true", help="log chi tiết hơn")
    return parser


def run_demo(html_out: Optional[str], tz_name: str = DEFAULT_TIMEZONE) -> int:
    rendered = render_email(tz=resolve_timezone(tz_name), **DEMO_DATA)
    msg = build_message(rendered, to_addr="an@example.com", from_addr=DEFAULT_FROM)
    print(format_dry_run("demo", msg, rendered))
    if html_out:
        Path(html_out).write_text(rendered.html, encoding="utf-8")
        print(f"Đã ghi bản HTML: {html_out}")
    return 0


def backoff_delay(poll_seconds: int, failures: int) -> float:
    """Thời gian chờ sau `failures` vòng liên tiếp gặp sự cố chung: poll×2, ×4, ... tối đa 5 phút.

    failures = 0 (vòng bình thường) thì chờ đúng poll_seconds.
    """
    if failures <= 0:
        return float(poll_seconds)
    cap = max(BACKOFF_MAX_SECONDS, poll_seconds)
    return float(min(cap, poll_seconds * 2**min(failures, 20)))


def acquire_run_lock(path: Optional[Path] = None, *, supabase_url: str = "") -> Optional[Any]:
    """Khóa file không chặn (flock) để không chạy hai tiến trình mailer cùng lúc trên một máy.

    Trả file đang giữ khóa (giữ tham chiếu tới khi thoát; hệ điều hành tự nhả khi tiến trình chết)
    hoặc None nếu nền tảng không có fcntl (Windows) hay không tạo được file khóa. Ném LockHeldError
    nếu tiến trình khác đang giữ khóa. Khóa chỉ có hiệu lực trong MỘT máy.
    """
    if fcntl is None:
        LOG.debug("Nền tảng không có fcntl: bỏ qua khóa chống chạy trùng.")
        return None
    digest = hashlib.sha256(supabase_url.encode("utf-8")).hexdigest()[:12]
    candidates = [path] if path is not None else [DEFAULT_LOCK_FILE, Path(tempfile.gettempdir()) / f"hnx-mailer-{digest}.lock"]
    handle = None
    for candidate in candidates:
        try:
            handle = open(candidate, "a+")
            break
        except OSError as exc:
            LOG.debug("Không mở được file khóa %s (%s).", candidate, type(exc).__name__)
    if handle is None:
        LOG.warning("Không tạo được file khóa, chạy mà không có khóa chống chạy trùng.")
        return None
    try:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError as exc:
        handle.close()
        if exc.errno in (errno.EAGAIN, errno.EACCES, errno.EWOULDBLOCK):
            raise LockHeldError("Có tiến trình mailer khác đang chạy.", "already_running") from None
        LOG.warning("Không khóa được file khóa (%s), chạy mà không có khóa chống chạy trùng.", type(exc).__name__)
        return None
    try:
        handle.seek(0)
        handle.truncate()
        handle.write(f"{os.getpid()}\n")
        handle.flush()
    except OSError:
        pass
    return handle


def main(
    argv: Optional[list[str]] = None,
    environ: Optional[Mapping[str, str]] = None,
    *,
    http: HttpFunc = default_http,
    sender_factory: Callable[[Config], SendFunc] = make_smtp_sender,
    stop: Optional[threading.Event] = None,
    lock_path: Optional[Path] = None,
) -> int:
    args = build_parser().parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        stream=sys.stderr,
    )

    if args.demo:
        return run_demo(args.html_out)
    if args.demo_announcement:
        import announcements

        return announcements.run_demo(args.html_out)

    environ = os.environ if environ is None else environ
    try:
        env = merge_env(read_env_file(Path(args.env_file)), environ)
        cfg = load_config(env, dry_run=args.dry_run)
    except ConfigError as exc:
        print("Lỗi cấu hình:\n" + str(exc), file=sys.stderr)
        print("Xem mailer/.env.example và mailer/README.md.", file=sys.stderr)
        return EXIT_CONFIG_ERROR
    except (OSError, UnicodeDecodeError) as exc:
        print(f"Lỗi cấu hình: không đọc được file env ({type(exc).__name__}).", file=sys.stderr)
        return EXIT_CONFIG_ERROR

    # --dry-run không gửi thư, không ghi DB nên không cần khóa.
    lock = None
    if not args.dry_run:
        try:
            lock = acquire_run_lock(lock_path, supabase_url=cfg.supabase_url)
        except LockHeldError:
            print(
                "Đã có một tiến trình mailer khác đang chạy trên máy này (khóa mailer/.mailer.lock). "
                "Chỉ chạy một tiến trình cho mỗi cơ sở dữ liệu để tránh gửi trùng thư; "
                "kiểm tra systemd/tmux rồi thử lại.",
                file=sys.stderr,
            )
            return EXIT_ALREADY_RUNNING
    try:
        return _run(args, cfg, http, sender_factory, stop)
    finally:
        if lock is not None:
            lock.close()


def _run(
    args: argparse.Namespace,
    cfg: Config,
    http: HttpFunc,
    sender_factory: Callable[[Config], SendFunc],
    stop: Optional[threading.Event],
) -> int:
    db = SupabaseClient(cfg.supabase_url, cfg.service_key, http=http)
    send = None if args.dry_run else sender_factory(cfg)
    mailer = Mailer(cfg, db, send, dry_run=args.dry_run)
    if cfg.announcements_enabled:
        import announcements

        mailer.announcements = announcements.AnnouncementWorker(
            cfg, db, send, dry_run=args.dry_run, now=mailer.now, out=mailer.out
        )
    else:
        LOG.info("ANNOUNCEMENTS_ENABLED=false: bỏ qua thông báo hàng loạt.")

    stop_event = stop or threading.Event()
    if stop is None:
        for sig in (signal.SIGINT, signal.SIGTERM):
            signal.signal(sig, lambda *_: stop_event.set())

    if args.once or args.dry_run:
        stats = mailer.run_once(stop_event)
        LOG.info("Xong một vòng: %s", stats)
        if stats["systemic"] and mailer.last_systemic is not None:
            print(
                f"Lỗi hệ thống [{mailer.last_systemic.code}]: "
                f"{scrub(str(mailer.last_systemic), cfg.secrets)}",
                file=sys.stderr,
            )
            return EXIT_SYSTEM_ERROR
        return EXIT_OK

    LOG.info("Mailer chạy liên tục, kiểm tra mỗi %d giây. Nhấn Ctrl+C để dừng.", cfg.poll_seconds)
    failures = 0
    while not stop_event.is_set():
        stats = mailer.run_once(stop_event)
        failures = failures + 1 if stats["systemic"] else 0
        wait = backoff_delay(cfg.poll_seconds, failures)
        if failures:
            LOG.warning("Sự cố chung liên tiếp %d vòng, chờ %d giây rồi thử lại.", failures, wait)
        elif stats.get("ann_busy"):
            # Còn thư thông báo đang gửi dở: quay lại ngay (đã ngủ giữa các thư theo ANNOUNCE_PER_MINUTE)
            # nhưng vẫn kiểm tra thư xác nhận mới giữa các lô.
            wait = min(wait, 1.0)
        stop_event.wait(wait)
    LOG.info("Đã dừng.")
    return EXIT_OK


if __name__ == "__main__":
    # Chạy trực tiếp thì module này tên là __main__; đăng ký thêm dưới tên registration_mailer để
    # announcements.py (import registration_mailer) dùng CHUNG một bản, không nạp bản thứ hai
    # (nếu không các lớp lỗi như SystemicError sẽ có hai bản khác nhau và except không bắt được).
    sys.modules.setdefault("registration_mailer", sys.modules[__name__])
    sys.exit(main())
