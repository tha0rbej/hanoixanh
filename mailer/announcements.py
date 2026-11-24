"""Thông báo hàng loạt gửi tới mọi người đã đăng ký một chiến dịch.

Phần này nằm trong cùng tiến trình và cùng khóa file với mailer xác nhận đăng ký
(registration_mailer.py). Dữ liệu và hợp đồng nằm ở migration
supabase/migrations/20261124000000_campaign_announcements.sql; mailer chỉ gọi các hàm RPC của nó.

Mỗi vòng (sau khi xử lý thư xác nhận):

1. Gửi THỬ: claim_announcement_tests -> gửi tới đúng email Auth của admin đã yêu cầu
   (dòng đầu "[THỬ]") -> mark_announcement_test_sent.
2. Gửi THẬT: claim_announcement_recipients (giành lease nguyên tử) -> với mỗi người: lấy email Auth,
   tên, dựng thư, gửi, ghi kết quả bằng mark_announcement_recipient.

Tốc độ gửi bị giới hạn (ANNOUNCE_PER_MINUTE) và tổng số thư mỗi ngày bị giới hạn
(MAILER_DAILY_LIMIT) để Gmail không khóa tài khoản. Lỗi được phân loại như thư xác nhận:
sự cố CHUNG (SMTP/Supabase) không đốt lượt thử của ai và nhả lease; lỗi RIÊNG ghi mã lỗi ngắn.

Chỉ dùng thư viện chuẩn.
"""

from __future__ import annotations

import html
import logging
import re
import threading
import time
from datetime import datetime, time as dtime, timedelta, timezone, tzinfo
from email.message import EmailMessage
from pathlib import Path
from typing import Any, Callable, Mapping, Optional

import registration_mailer as rm

LOG = logging.getLogger("hnx.mailer.announcements")

TEMPLATES_DIR = rm.TEMPLATES_DIR
TEST_PREFIX = "[THỬ] "
DEFAULT_SUBJECT = "Thông báo từ Hà Nội Xanh"
PREVIEW_LIMIT = 5  # số thư tối đa --dry-run in ra cho mỗi loại
TEST_BATCH = 5
LEASE_SECONDS = 300
MAX_BATCH = 20
# Lý do begin_announcement_send báo `skip` mà cả thông báo đã dừng (không chỉ riêng một người).
STOP_BATCH_REASONS = frozenset({"cancelled", "announcement_not_active"})
BODY_MAX_CHARS = 6000  # cột body_text giới hạn 5000; chặn thêm ở mailer đề phòng dữ liệu sửa tay
URL_MAX_LEN = 2000
MISSING_WARN_EVERY = 3600  # giây giữa hai lần nhắc "chưa chạy migration"

# --------------------------------------------------------------------------
# Hàm thuần: văn bản thuần -> HTML an toàn
# --------------------------------------------------------------------------

_URL_RE = re.compile(r"https?://[^\s<>\"'`\\\x00-\x1f\x7f]+", re.IGNORECASE)
_CONTROL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def sanitize_body(text: Any) -> str:
    """Chuẩn hóa xuống dòng về \\n, bỏ ký tự điều khiển (giữ \\n và tab), cắt khoảng trắng hai đầu."""
    if text is None:
        return ""
    value = str(text).replace("\r\n", "\n").replace("\r", "\n")
    value = _CONTROL_RE.sub("", value).strip()
    if len(value) > BODY_MAX_CHARS:
        value = value[:BODY_MAX_CHARS].rstrip() + "…"
    return value


def _split_trailing_punctuation(url: str) -> tuple[str, str]:
    """Dấu câu ở cuối liên kết (dấu chấm, phẩy, ngoặc đóng thừa) thuộc về câu chứ không thuộc liên kết."""
    trail = ""
    while url:
        ch = url[-1]
        unbalanced_paren = ch == ")" and url.count("(") < url.count(")")
        unbalanced_bracket = ch == "]" and url.count("[") < url.count("]")
        if ch in ".,;:!?" or unbalanced_paren or unbalanced_bracket:
            trail = ch + trail
            url = url[:-1]
        else:
            break
    return url, trail


def linkify_line(line: str) -> str:
    """Escape toàn bộ dòng; chỉ URL http/https hợp lệ được bọc thành thẻ <a>."""
    out: list[str] = []
    pos = 0
    for match in _URL_RE.finditer(line):
        raw = match.group(0)
        url, trail = _split_trailing_punctuation(raw)
        safe = rm.safe_http_url(url) if len(url) <= URL_MAX_LEN else None
        if safe is None:
            continue  # để nguyên trong văn bản (đã escape ở lần ghép sau)
        out.append(html.escape(line[pos : match.start()]))
        out.append(
            f'<a href="{html.escape(safe, quote=True)}" style="color:#15803d;word-break:break-all;">'
            f"{html.escape(safe)}</a>"
        )
        out.append(html.escape(trail))
        pos = match.end()
    out.append(html.escape(line[pos:]))
    return "".join(out)


def text_to_html(text: str) -> str:
    """Văn bản thuần -> HTML: đoạn cách nhau bởi dòng trống thành <p>, xuống dòng đơn thành <br>.

    Mọi ký tự được escape nên không thẻ HTML nào đi qua được; chỉ URL http/https được thành liên kết.
    """
    body = sanitize_body(text)
    if not body:
        return ""
    paragraphs = [p for p in re.split(r"\n[ \t]*\n+", body) if p.strip()]
    rendered = []
    for paragraph in paragraphs:
        lines = [linkify_line(line.rstrip()) for line in paragraph.strip("\n").split("\n")]
        rendered.append('<p style="margin:0 0 14px;">' + "<br>".join(lines) + "</p>")
    return "\n            ".join(rendered)


# --------------------------------------------------------------------------
# Hàm thuần: dựng thư
# --------------------------------------------------------------------------


def render_announcement(
    *,
    name: str,
    subject: str,
    body_text: str,
    campaign_title: str,
    location: str,
    start_at: Any,
    end_at: Any,
    campaign_url: str,
    tz: tzinfo,
    test: bool = False,
    registrant_count: Optional[int] = None,
    templates_dir: Path = TEMPLATES_DIR,
) -> rm.RenderedEmail:
    ten = rm.clean_inline(name, 100) or "bạn"
    chien_dich = rm.clean_inline(campaign_title, 200) or "chiến dịch của Hà Nội Xanh"
    dia_diem = rm.clean_inline(location, 300) or rm.TBD_TEXT
    thoi_gian = rm.describe_time(start_at, end_at, tz)
    link = rm.safe_http_url(campaign_url)

    tieu_de = rm.clean_inline(subject, 150) or DEFAULT_SUBJECT
    if test:
        tieu_de = TEST_PREFIX + tieu_de
    noi_dung = sanitize_body(body_text)

    if test:
        who = f"{registrant_count} người" if isinstance(registrant_count, int) and registrant_count >= 0 else "những người"
        note = (
            f"{TEST_PREFIX}Đây là thư gửi thử riêng cho bạn, chưa gửi cho ai khác. "
            f"Khi bạn xác nhận, thư sẽ được gửi tới {who} đã đăng ký chiến dịch."
        )
        dong_thu = note + "\n\n"
        khoi_thu = (
            '<p style="margin:0 0 18px;padding:10px 14px;background-color:#fef9c3;border-radius:8px;'
            f'font-size:14px;color:#713f12;"><strong>{html.escape(TEST_PREFIX.strip())}</strong> '
            f"{html.escape(note[len(TEST_PREFIX):])}</p>"
        )
    else:
        dong_thu = ""
        khoi_thu = ""

    text_link = f"Xem chi tiết chiến dịch: {link}\n" if link else ""
    text = rm.load_template("announcement.txt", templates_dir).substitute(
        dong_thu=dong_thu,
        ten=ten,
        noi_dung=noi_dung,
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
    body_html = rm.load_template("announcement.html", templates_dir).substitute(
        khoi_thu=khoi_thu,
        tieu_de=esc(tieu_de),
        ten=esc(ten),
        noi_dung_html=text_to_html(noi_dung),
        chien_dich=esc(chien_dich),
        thoi_gian=esc(thoi_gian),
        dia_diem=esc(dia_diem),
        nut_xem=button,
    )
    return rm.RenderedEmail(subject=tieu_de, text=text, html=body_html)


def build_announcement_message(
    rendered: rm.RenderedEmail,
    *,
    to_addr: str,
    from_addr: str,
    reply_to: str = "",
    ref_id: str = "",
) -> EmailMessage:
    headers = {"X-Entity-Ref-ID": ref_id} if ref_id else None
    return rm.build_message(rendered, to_addr=to_addr, from_addr=from_addr, reply_to=reply_to, extra_headers=headers)


def format_dry_run(label: str, msg: EmailMessage, rendered: rm.RenderedEmail) -> str:
    return (
        f"===== DRY-RUN: {label} (không gửi, không ghi DB) =====\n"
        f"From: {msg['From']}\nTo: {msg['To']}\nSubject: {msg['Subject']}\n\n"
        f"{rendered.text}\n"
    )


DEMO_ANNOUNCEMENT = dict(
    name="Nguyễn Văn An",
    subject="Dời giờ tập trung sang 8h sáng Chủ nhật",
    body_text=(
        "Do dự báo có mưa sớm, Ban tổ chức dời giờ tập trung sang 8h sáng Chủ nhật (29/11).\n"
        "Địa điểm tập trung giữ nguyên.\n\n"
        "Bạn nhớ mang theo găng tay và túi đựng rác cá nhân. Xem hướng dẫn tại "
        "https://hanoixanh.example.com/chien-dich?campaign=11111111-2222-4333-8444-555555555555."
    ),
    campaign_title=rm.DEMO_DATA["campaign_title"],
    location=rm.DEMO_DATA["location"],
    start_at=rm.DEMO_DATA["start_at"],
    end_at=rm.DEMO_DATA["end_at"],
    campaign_url=rm.DEMO_DATA["campaign_url"],
)


def run_demo(html_out: Optional[str], tz_name: str = rm.DEFAULT_TIMEZONE) -> int:
    tz = rm.resolve_timezone(tz_name)
    rendered = render_announcement(tz=tz, **DEMO_ANNOUNCEMENT)
    msg = build_announcement_message(rendered, to_addr="an@example.com", from_addr=rm.DEFAULT_FROM, ref_id="hnx-ann-demo")
    print(format_dry_run("thông báo mẫu", msg, rendered))
    test_rendered = render_announcement(tz=tz, test=True, registrant_count=42, **DEMO_ANNOUNCEMENT)
    print("----- Phần đầu của thư GỬI THỬ -----")
    print(test_rendered.subject)
    print(test_rendered.text.split("\n\n", 1)[0])
    if html_out:
        Path(html_out).write_text(rendered.html, encoding="utf-8")
        print(f"Đã ghi bản HTML: {html_out}")
    return 0


# --------------------------------------------------------------------------
# Worker
# --------------------------------------------------------------------------


def _function_missing(exc: rm.SupabaseError) -> bool:
    """PostgREST báo không có hàm RPC (chưa chạy migration thông báo)."""
    text = str(exc)
    return exc.status == 404 and ("PGRST202" in text or "Could not find the function" in text)


def _items(response: Any) -> list[dict]:
    """Danh sách phần tử từ {"status":"ok","items":[...]} (hoặc mảng trần)."""
    if isinstance(response, dict):
        if response.get("status") not in (None, "ok"):
            LOG.warning("RPC trả trạng thái %r, bỏ qua.", response.get("status"))
            return []
        response = response.get("items")
    if not isinstance(response, list):
        return []
    return [item for item in response if isinstance(item, dict)]


class AnnouncementWorker:
    """Xử lý thư thử và thư thông báo của một vòng. Được Mailer.run_once gọi sau phần thư xác nhận."""

    def __init__(
        self,
        cfg: rm.Config,
        db: rm.SupabaseClient,
        send: Optional[rm.SendFunc],
        *,
        dry_run: bool = False,
        now: Callable[[], datetime] = lambda: datetime.now(timezone.utc),
        out: Callable[[str], None] = print,
        templates_dir: Path = TEMPLATES_DIR,
        monotonic: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
    ):
        self.cfg = cfg
        self.db = db
        self.send = send
        self.dry_run = dry_run
        self.now = now
        self.out = out
        self.templates_dir = templates_dir
        self._monotonic = monotonic
        self._sleep = sleep
        self._last_send: Optional[float] = None
        self._blocked_until: Optional[datetime] = None
        self._missing_logged: Optional[float] = None
        # recipient_id -> tham số mark_announcement_recipient của thư ĐÃ gửi nhưng chưa ghi được vào DB.
        # Vòng sau ghi lại trước khi gửi tiếp, và không gửi lại những người này nếu lease hết hạn.
        self._unmarked: dict[str, dict[str, Any]] = {}

    # ---- tiện ích ----

    @property
    def interval(self) -> float:
        return 60.0 / max(1, self.cfg.announce_per_minute)

    @property
    def batch_size(self) -> int:
        """Lô đủ nhỏ để một lô gửi xong trong khoảng 20 giây: thư xác nhận mới không phải chờ lâu."""
        return max(1, min(MAX_BATCH, round(self.cfg.announce_per_minute / 3)))

    def _wait(self, stop: Optional[threading.Event], seconds: float) -> None:
        if stop is not None:
            stop.wait(seconds)
        else:
            self._sleep(seconds)

    def _pace(self, stop: Optional[threading.Event]) -> bool:
        """Ngủ đủ khoảng cách giữa hai thư. False nếu tiến trình được yêu cầu dừng trong lúc chờ."""
        if self._last_send is not None:
            wait = self.interval - (self._monotonic() - self._last_send)
            if wait > 0:
                self._wait(stop, wait)
        return not (stop is not None and stop.is_set())

    def _day_bounds(self, now: datetime) -> tuple[datetime, datetime]:
        local = now.astimezone(self.cfg.tz)
        start = datetime.combine(local.date(), dtime.min, tzinfo=self.cfg.tz)
        end = datetime.combine(local.date() + timedelta(days=1), dtime.min, tzinfo=self.cfg.tz)
        return start, end

    def _quota_remaining(self) -> int:
        start, end = self._day_bounds(self.now())
        response = self.db.rpc(
            "mail_sent_count_between",
            {
                "p_from": start.astimezone(timezone.utc).isoformat(),
                "p_to": end.astimezone(timezone.utc).isoformat(),
            },
        )
        total = response.get("total") if isinstance(response, dict) else None
        if not isinstance(total, int) or isinstance(total, bool):
            raise rm.SupabaseError(200, "mail_sent_count_between trả dữ liệu không hợp lệ")
        return self.cfg.daily_limit - total

    def _block_until_tomorrow(self) -> None:
        _, end = self._day_bounds(self.now())
        self._blocked_until = end.astimezone(timezone.utc)
        LOG.warning(
            "Đã đạt hạn mức %d thư/ngày (MAILER_DAILY_LIMIT, tính cả thư xác nhận). Dừng gửi thông báo tới %s; "
            "thư xác nhận đăng ký mới vẫn được gửi bình thường.",
            self.cfg.daily_limit,
            end.strftime("%d/%m/%Y %H:%M"),
        )

    def _log_missing_migration(self) -> None:
        mono = self._monotonic()
        if self._missing_logged is None or mono - self._missing_logged >= MISSING_WARN_EVERY:
            self._missing_logged = mono
            LOG.warning(
                "Chưa có hàm RPC thông báo trong Supabase: hãy chạy migration 20261124000000_campaign_announcements.sql. "
                "Bỏ qua thông báo hàng loạt; thư xác nhận vẫn gửi bình thường."
            )

    def _release(self, items: list[dict]) -> None:
        ids = [rid for rid in (rm.parse_uuid(i.get("recipient_id")) for i in items) if rid and rid not in self._unmarked]
        if not ids:
            return
        try:
            self.db.rpc("release_announcement_recipients", {"p_recipient_ids": ids})
        except (rm.SupabaseError, rm.PermanentError) as exc:
            # Không nhả được thì lease tự hết hạn sau LEASE_SECONDS; chỉ ghi log.
            LOG.warning("Không nhả được lease của %d người nhận (sẽ tự hết hạn): %s", len(ids), rm.scrub(str(exc), self.cfg.secrets))

    # ---- vòng xử lý ----

    def run_round(self, stop: Optional[threading.Event] = None) -> dict[str, Any]:
        """Một vòng thông báo. Trả {"sent","failed","tests","busy"}; ném SystemicError khi gặp sự cố chung."""
        result: dict[str, Any] = {"sent": 0, "failed": 0, "tests": 0, "busy": False}
        try:
            if self.dry_run:
                self._dry_run_round(result)
            else:
                self._round(stop, result)
        except rm.SupabaseError as exc:
            if _function_missing(exc):
                self._log_missing_migration()
                return result
            code = rm.classify_supabase_error(exc) or "supabase_error"
            raise rm.SystemicError(f"Gọi RPC thông báo lỗi: {exc}", code) from None
        return result

    def _round(self, stop: Optional[threading.Event], result: dict[str, Any]) -> None:
        now = self.now()
        if self._blocked_until is not None:
            if now < self._blocked_until:
                LOG.debug("Đang dừng gửi thông báo vì hết hạn mức ngày, tới %s.", self._blocked_until.isoformat())
                return
            self._blocked_until = None

        self._retry_unmarked()

        remaining: Optional[int] = None

        tests = _items(self.db.rpc("claim_announcement_tests", {"p_limit": TEST_BATCH}))
        for item in tests:
            if stop is not None and stop.is_set():
                return
            if remaining is None:
                remaining = self._quota_remaining()
            if remaining <= 0:
                break
            if self._process_test(item, stop):
                remaining -= 1
                result["tests"] += 1
        if remaining is not None and remaining <= 0:
            self._block_until_tomorrow()
            return

        items = _items(
            self.db.rpc(
                "claim_announcement_recipients",
                {"p_limit": self.batch_size, "p_max_attempts": self.cfg.max_attempts, "p_lease_seconds": LEASE_SECONDS},
            )
        )
        if not items:
            return
        LOG.info("Có %d người nhận thông báo trong lô này.", len(items))
        # Từ đây mọi lease đã giành phải được dùng hết hoặc nhả lại (xem finally trong _send_batch).
        try:
            if remaining is None:
                remaining = self._quota_remaining()
        except BaseException:
            self._release(items)
            raise
        if remaining <= 0:
            self._release(items)
            self._block_until_tomorrow()
            return
        if remaining < len(items):
            self._release(items[remaining:])
            items = items[:remaining]
        self._send_batch(items, remaining, stop, result)

    def _send_batch(
        self, items: list[dict], remaining: int, stop: Optional[threading.Event], result: dict[str, Any]
    ) -> None:
        pending = list(items)
        try:
            while pending:
                if stop is not None and stop.is_set():
                    return
                item = pending[0]
                rid = rm.parse_uuid(item.get("recipient_id"))
                if rid is not None and rid in self._unmarked:
                    pending.pop(0)  # đã gửi ở vòng trước, chỉ còn chờ ghi DB
                    continue
                try:
                    outcome = self._process_recipient(item, stop)
                except rm.SystemicError as exc:
                    if exc.sent:
                        pending.pop(0)  # thư đã đi: giữ lease của nó, đừng nhả
                    raise
                if outcome == "stopped":
                    return
                pending.pop(0)
                if outcome in ("skipped", "skipped_all"):
                    result["busy"] = True
                    if outcome == "skipped_all":
                        # Thông báo đã hủy/dừng: những người còn lại của nó đã bị DB bỏ qua, không cần hỏi từng người.
                        aid = item.get("announcement_id")
                        pending = [p for p in pending if p.get("announcement_id") != aid]
                    continue
                result["busy"] = True
                if outcome == "sent":
                    result["sent"] += 1
                    remaining -= 1
                    if remaining <= 0:
                        result["busy"] = False
                        self._block_until_tomorrow()
                        return
                elif outcome == "failed":
                    result["failed"] += 1
        finally:
            # Còn lease chưa dùng (dừng giữa chừng, sự cố chung, hết hạn mức): nhả để lấy lại được ngay.
            if pending:
                self._release(pending)

    def _retry_unmarked(self) -> None:
        for rid, args in list(self._unmarked.items()):
            try:
                self._mark_recipient(rid, **args)
            except (rm.SupabaseError, rm.PermanentError) as exc:
                raise rm.SystemicError(
                    f"Vẫn không ghi được trạng thái đã gửi cho {len(self._unmarked)} người nhận: {exc}",
                    "supabase_write_failed",
                ) from None
            del self._unmarked[rid]

    # ---- ghi trạng thái ----

    def _mark_recipient(self, recipient_id: str, *, status: str, error_code: Optional[str], count_attempt: bool) -> None:
        last: Optional[Exception] = None
        for attempt in range(3):
            try:
                response = self.db.rpc(
                    "mark_announcement_recipient",
                    {
                        "p_recipient_id": recipient_id,
                        "p_status": status,
                        "p_error_code": error_code,
                        "p_count_attempt": count_attempt,
                        "p_max_attempts": self.cfg.max_attempts,
                    },
                )
                if isinstance(response, dict) and response.get("status") == "already_final":
                    LOG.warning(
                        "Người nhận %s đã ở trạng thái %s (có thể thông báo vừa bị hủy), không ghi đè.",
                        recipient_id,
                        response.get("recipient_status"),
                    )
                return
            except rm.SupabaseError as exc:
                last = exc
                if attempt < 2:
                    self._sleep(1.0 + attempt)
        assert last is not None
        raise last

    # ---- thư thử ----

    def _process_test(self, item: Mapping[str, Any], stop: Optional[threading.Event]) -> bool:
        """Gửi một thư thử. True nếu đã gửi. Ném SystemicError khi gặp sự cố chung."""
        aid = rm.parse_uuid(item.get("announcement_id"))
        try:
            version = int(item.get("version"))  # type: ignore[arg-type]
        except (TypeError, ValueError):
            version = 0
        if aid is None or version <= 0:
            LOG.error("Yêu cầu gửi thử có dữ liệu không hợp lệ, bỏ qua.")
            return False
        try:
            admin_id = rm.parse_uuid(item.get("requested_by"))
            if admin_id is None:
                raise rm.PermanentError("Không biết gửi thử cho ai.", "invalid_user_id")
            email = self.db.get_auth_email(admin_id)
            if not email:
                raise rm.PermanentError("Tài khoản admin không có địa chỉ email.", "no_auth_email")
            name = rm.display_name(self.db.get_profile_name(admin_id), email)
            rendered, msg = self._compose(item, name, email, test=True, ref_id=f"hnx-ann-test-{aid}-v{version}-{int(self.now().timestamp())}")
            if self.send is None:
                raise rm.SystemicError("Chưa cấu hình bộ gửi SMTP.", "smtp_not_configured")
            if not self._pace(stop):
                return False
            try:
                self.send(msg)
            finally:
                self._last_send = self._monotonic()
        except rm.SystemicError:
            raise
        except rm.PermanentError as exc:
            self._fail_test(aid, version, exc.code, str(exc), permanent=True)
            return False
        except rm.TransientError as exc:
            self._fail_test(aid, version, exc.code, str(exc), permanent=False)
            return False
        except rm.SupabaseError as exc:
            systemic = rm.classify_supabase_error(exc)
            if systemic:
                raise rm.SystemicError(str(exc), systemic) from None
            self._fail_test(aid, version, "supabase_error", str(exc), permanent=False)
            return False
        except Exception as exc:  # lỗi không lường trước: không để làm sập cả vòng
            LOG.exception("Thư thử của thông báo %s: lỗi không lường trước", aid)
            self._fail_test(aid, version, "unexpected_error", f"{type(exc).__name__}: {exc}", permanent=False)
            return False

        try:
            self.db.rpc("mark_announcement_test_sent", {"p_announcement_id": aid, "p_version": version})
        except rm.SupabaseError as exc:
            LOG.error(
                "ĐÃ gửi thư thử của thông báo %s tới %s nhưng không ghi được trạng thái (%s).",
                aid, rm.mask_email(email), rm.scrub(str(exc), self.cfg.secrets),
            )
            raise rm.SystemicError(str(exc), "supabase_write_failed", sent=True) from None
        LOG.info("Đã gửi thư thử của thông báo %s tới %s.", aid, rm.mask_email(email))
        return True

    def _fail_test(self, aid: str, version: int, code: str, detail: str, *, permanent: bool) -> None:
        LOG.warning(
            "Thư thử của thông báo %s lỗi [%s]%s: %s",
            aid, code, "" if permanent else " (sẽ thử lại)", rm.scrub(detail, self.cfg.secrets),
        )
        try:
            self.db.rpc(
                "mark_announcement_test_failed",
                {"p_announcement_id": aid, "p_version": version, "p_error_code": code, "p_permanent": permanent},
            )
        except (rm.SupabaseError, rm.PermanentError) as exc:
            LOG.error("Không ghi được lỗi thư thử: %s", rm.scrub(str(exc), self.cfg.secrets))

    # ---- thư thật ----

    def _compose(
        self, item: Mapping[str, Any], name: str, email: str, *, test: bool, ref_id: str
    ) -> "tuple[rm.RenderedEmail, EmailMessage]":
        campaign_id = rm.parse_uuid(item.get("campaign_id"))
        if campaign_id is None:
            raise rm.PermanentError("Thông báo không có chiến dịch hợp lệ.", "invalid_campaign_id")
        count = item.get("registrant_count")
        rendered = render_announcement(
            name=name,
            subject=item.get("subject") or "",
            body_text=item.get("body_text") or "",
            campaign_title=item.get("campaign_title") or "",
            location=item.get("campaign_location") or "",
            start_at=item.get("campaign_start_at"),
            end_at=item.get("campaign_end_at"),
            campaign_url=rm.build_campaign_url(self.cfg.site_url, campaign_id),
            tz=self.cfg.tz,
            test=test,
            registrant_count=count if isinstance(count, int) and not isinstance(count, bool) else None,
            templates_dir=self.templates_dir,
        )
        msg = build_announcement_message(
            rendered, to_addr=email, from_addr=self.cfg.mail_from, reply_to=self.cfg.mail_reply_to, ref_id=ref_id
        )
        return rendered, msg

    def _begin_send(self, recipient_id: str) -> Optional[str]:
        """Xin phép DB gửi thư thật cho một người. None = được gửi; chuỗi = lý do phải bỏ qua.

        Lỗi HTTP ném SupabaseError (người gọi xếp loại sự cố chung); trả lời lạ là sự cố chung.
        """
        response = self.db.rpc(
            "begin_announcement_send", {"p_recipient_id": recipient_id, "p_lease_seconds": LEASE_SECONDS}
        )
        status = response.get("status") if isinstance(response, dict) else None
        if status == "ok":
            return None
        if status == "skip":
            reason = response.get("reason")
            return reason if isinstance(reason, str) and reason else "unknown"
        raise rm.SystemicError("begin_announcement_send trả dữ liệu không hợp lệ", "supabase_bad_response")

    def _process_recipient(self, item: Mapping[str, Any], stop: Optional[threading.Event]) -> str:
        """Gửi cho một người. Trả 'sent', 'failed', 'retry', 'skipped', 'skipped_all' hoặc 'stopped'.

        'skipped': DB báo không được gửi (đã hủy, không còn pending, mất lease): không gửi, không tính lần thử.
        'skipped_all': như trên và cả thông báo đã dừng nên các người còn lại của nó trong lô cũng bỏ qua.

        Ném SystemicError khi gặp sự cố chung: người nhận KHÔNG bị tính thêm lần thử nào.
        """
        rid = rm.parse_uuid(item.get("recipient_id"))
        if rid is None:
            LOG.error("Người nhận có recipient_id không hợp lệ, bỏ qua.")
            return "failed"
        email = ""
        try:
            user_id = rm.parse_uuid(item.get("user_id"))
            if user_id is None:
                raise rm.PermanentError("user_id không phải UUID hợp lệ.", "invalid_user_id")
            email_or_none = self.db.get_auth_email(user_id)
            if not email_or_none:
                raise rm.PermanentError("Tài khoản không có địa chỉ email.", "no_auth_email")
            email = email_or_none
            name = rm.display_name(self.db.get_profile_name(user_id), email)
            _, msg = self._compose(item, name, email, test=False, ref_id=f"hnx-ann-{rid}")
            if self.send is None:
                raise rm.SystemicError("Chưa cấu hình bộ gửi SMTP.", "smtp_not_configured")
            if not self._pace(stop):
                return "stopped"
            # Hỏi DB NGAY trước khi gửi (sau khi đã chờ giãn cách): thông báo có thể vừa bị hủy.
            skip_reason = self._begin_send(rid)
            if skip_reason is not None:
                LOG.info("Bỏ qua người nhận %s, không gửi thư [%s].", rid, skip_reason)
                return "skipped_all" if skip_reason in STOP_BATCH_REASONS else "skipped"
            try:
                self.send(msg)
            finally:
                self._last_send = self._monotonic()
        except rm.SystemicError:
            raise
        except rm.PermanentError as exc:
            return self._fail_recipient(rid, exc.code, str(exc), permanent=True)
        except rm.TransientError as exc:
            return self._fail_recipient(rid, exc.code, str(exc), permanent=False)
        except rm.SupabaseError as exc:
            systemic = rm.classify_supabase_error(exc)
            if systemic:
                raise rm.SystemicError(str(exc), systemic) from None
            return self._fail_recipient(rid, "supabase_error", str(exc), permanent=False)
        except Exception as exc:  # lỗi không lường trước: không để làm sập cả vòng
            LOG.exception("Người nhận %s: lỗi không lường trước", rid)
            return self._fail_recipient(rid, "unexpected_error", f"{type(exc).__name__}: {exc}", permanent=False)

        args = {"status": "sent", "error_code": None, "count_attempt": True}
        try:
            self._mark_recipient(rid, **args)
        except (rm.SupabaseError, rm.PermanentError) as exc:
            LOG.error(
                "ĐÃ gửi thông báo tới %s (người nhận %s) nhưng không ghi được trạng thái (%s). "
                "Sẽ ghi lại ở vòng sau; nếu tiến trình tắt trước đó, người này có thể nhận thư lần hai.",
                rm.mask_email(email), rid, rm.scrub(str(exc), self.cfg.secrets),
            )
            self._unmarked[rid] = args
            raise rm.SystemicError(str(exc), "supabase_write_failed", sent=True) from None
        LOG.info("Đã gửi thông báo cho người nhận %s tới %s.", rid, rm.mask_email(email))
        return "sent"

    def _fail_recipient(self, rid: str, code: str, detail: str, *, permanent: bool) -> str:
        """Ghi lỗi RIÊNG của một người: DB chỉ nhận `code`, chi tiết (đã che secret) chỉ vào log."""
        detail = rm.scrub(detail, self.cfg.secrets)
        if permanent:
            LOG.error("Người nhận %s: lỗi không thể thử lại [%s]. %s", rid, code, detail)
        else:
            LOG.warning("Người nhận %s: lỗi tạm thời, sẽ thử lại tới tối đa %d lần [%s]. %s", rid, self.cfg.max_attempts, code, detail)
        try:
            self._mark_recipient(
                rid, status="failed" if permanent else "pending", error_code=code, count_attempt=True
            )
        except (rm.SupabaseError, rm.PermanentError) as exc:
            LOG.error("Người nhận %s: không ghi được trạng thái lỗi: %s", rid, rm.scrub(str(exc), self.cfg.secrets))
        return "failed" if permanent else "retry"

    # ---- --dry-run ----

    def _dry_run_round(self, result: dict[str, Any]) -> None:
        """In thư sẽ gửi cho các yêu cầu thử và tối đa PREVIEW_LIMIT người nhận kế tiếp; chỉ đọc, không ghi DB."""
        tests = _items(self.db.rpc("claim_announcement_tests", {"p_limit": PREVIEW_LIMIT}))
        for item in tests:
            self._dry_run_item(item, test=True, label=f"thư THỬ của thông báo {item.get('announcement_id')}")
        recipients = _items(
            self.db.rpc("preview_announcement_recipients", {"p_limit": PREVIEW_LIMIT, "p_max_attempts": self.cfg.max_attempts})
        )
        for item in recipients:
            self._dry_run_item(item, test=False, label=f"thông báo {item.get('announcement_id')} cho người nhận {item.get('recipient_id')}")
        if not tests and not recipients:
            self.out("DRY-RUN: không có thư thông báo hoặc thư thử nào đang chờ.")

    def _dry_run_item(self, item: Mapping[str, Any], *, test: bool, label: str) -> None:
        try:
            user_id = rm.parse_uuid(item.get("requested_by" if test else "user_id"))
            if user_id is None:
                raise rm.PermanentError("user_id không hợp lệ.", "invalid_user_id")
            email = self.db.get_auth_email(user_id)
            if not email:
                raise rm.PermanentError("Tài khoản không có địa chỉ email.", "no_auth_email")
            name = rm.display_name(self.db.get_profile_name(user_id), email)
            rendered, msg = self._compose(item, name, email, test=test, ref_id="hnx-ann-dry-run")
            self.out(format_dry_run(label, msg, rendered))
        except rm.MailerError as exc:
            self.out(f"DRY-RUN: {label}: sẽ lỗi [{exc.code}]")
