import contextlib
import io
import json
import smtplib
import socket
import ssl
import tempfile
import threading
import unittest
from datetime import datetime, timezone
from email import message_from_bytes, policy
from pathlib import Path
from unittest import mock
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import registration_mailer as rm

HCM = ZoneInfo("Asia/Ho_Chi_Minh")
UID = "aaaaaaaa-1111-4222-8333-bbbbbbbbbbbb"
CID = "11111111-2222-4333-8444-555555555555"
REG_ID = "cccccccc-1111-4222-8333-dddddddddddd"
SERVICE_KEY = "test-service-key-xyz"
SMTP_PASSWORD = "test-smtp-password"

BASE_ENV = {
    "SUPABASE_URL": "https://example.supabase.co/",
    "SUPABASE_SERVICE_KEY": SERVICE_KEY,
    "SITE_URL": "https://hanoixanh.example.com/",
    "SMTP_HOST": "smtp.example.com",
    "SMTP_USER": "user@example.com",
    "SMTP_PASSWORD": SMTP_PASSWORD,
    "MAIL_FROM": "Hà Nội Xanh <hanoixanhh@example.com>",
}


def make_cfg(**overrides):
    env = dict(BASE_ENV)
    env.update(overrides)
    return rm.load_config(env)


def render(**overrides):
    args = dict(
        name="An",
        campaign_title="Dọn rác",
        location="Hồ Tây",
        start_at="2026-11-22T00:30:00+00:00",
        end_at="2026-11-22T04:30:00+00:00",
        campaign_url=f"https://hanoixanh.example.com/chien-dich?campaign={CID}",
        tz=HCM,
    )
    args.update(overrides)
    return rm.render_email(**args)


class EnvTests(unittest.TestCase):
    def test_parse_env_text(self):
        text = (
            "﻿# chú thích\n"
            "A=1\n"
            "export B = hai \n"
            'C="có # dấu thăng"\n'
            "D=giá trị # chú thích cuối dòng\n"
            "E='nháy đơn'\n"
            "dòng hỏng\n"
            "F=\n"
        )
        self.assertEqual(
            rm.parse_env_text(text),
            {"A": "1", "B": "hai", "C": "có # dấu thăng", "D": "giá trị", "E": "nháy đơn", "F": ""},
        )

    def test_real_environment_overrides_file(self):
        merged = rm.merge_env({"SMTP_HOST": "from-file", "SITE_URL": "https://a"}, {"SMTP_HOST": "from-env", "SITE_URL": " "})
        self.assertEqual(merged["SMTP_HOST"], "from-env")
        self.assertEqual(merged["SITE_URL"], "https://a")

    def test_defaults_and_normalisation(self):
        cfg = make_cfg()
        self.assertEqual(cfg.smtp_port, 587)
        self.assertEqual(cfg.smtp_security, "starttls")
        self.assertEqual(cfg.poll_seconds, 30)
        self.assertEqual(cfg.max_attempts, 5)
        self.assertEqual(cfg.timezone_name, "Asia/Ho_Chi_Minh")
        self.assertEqual(cfg.supabase_url, "https://example.supabase.co")
        self.assertEqual(cfg.site_url, "https://hanoixanh.example.com")

    def test_missing_required_variables(self):
        with self.assertRaises(rm.ConfigError) as ctx:
            rm.load_config({})
        message = str(ctx.exception)
        for key in ("SUPABASE_URL", "SUPABASE_SERVICE_KEY", "SITE_URL", "SMTP_HOST", "MAIL_FROM"):
            self.assertIn(key, message)

    def test_dry_run_does_not_need_smtp(self):
        cfg = rm.load_config(
            {"SUPABASE_URL": "https://x.supabase.co", "SUPABASE_SERVICE_KEY": "k", "SITE_URL": "https://s.example.com"},
            dry_run=True,
        )
        self.assertEqual(cfg.smtp_host, "")
        self.assertIn("hanoixanhh@gmail.com", cfg.mail_from)

    def test_invalid_values(self):
        for overrides in (
            {"SMTP_PORT": "abc"},
            {"SMTP_SECURITY": "tls13"},
            {"POLL_SECONDS": "0"},
            {"MAX_ATTEMPTS": "-1"},
            {"MAILER_TIMEZONE": "Mars/Base"},
            {"SITE_URL": "javascript:alert(1)"},
            {"MAIL_FROM": "không phải email"},
            {"SMTP_PASSWORD": ""},
        ):
            with self.subTest(overrides=overrides), self.assertRaises(rm.ConfigError):
                make_cfg(**overrides)

    def test_security_none_refuses_login_to_remote_host(self):
        with self.assertRaises(rm.ConfigError) as ctx:
            make_cfg(SMTP_SECURITY="none")  # có SMTP_USER/PASSWORD, host smtp.example.com
        self.assertIn("SMTP_SECURITY=none", str(ctx.exception))
        self.assertIn("dạng rõ", str(ctx.exception))

    def test_security_none_allowed_for_local_host_or_without_login(self):
        for host in ("localhost", "LOCALHOST", "127.0.0.1", "::1", "[::1]"):
            with self.subTest(host=host):
                self.assertEqual(make_cfg(SMTP_SECURITY="none", SMTP_HOST=host).smtp_security, "none")
        # Không đăng nhập thì không có mật khẩu để lộ.
        cfg = make_cfg(SMTP_SECURITY="none", SMTP_USER="", SMTP_PASSWORD="")
        self.assertEqual(cfg.smtp_security, "none")
        # Dry-run không dùng SMTP nên không bị chặn.
        env = dict(BASE_ENV, SMTP_SECURITY="none")
        self.assertEqual(rm.load_config(env, dry_run=True).smtp_security, "none")

    def test_other_security_modes_still_allow_login_to_remote_host(self):
        for mode in ("starttls", "ssl"):
            self.assertEqual(make_cfg(SMTP_SECURITY=mode).smtp_security, mode)

    def test_timezone_falls_back_to_utc7_without_tzdata(self):
        rm._tz_fallback_warned = False
        with mock.patch.object(rm, "ZoneInfo", side_effect=ZoneInfoNotFoundError("no tzdata")):
            with self.assertLogs("hnx.mailer", "WARNING") as logs:
                cfg = make_cfg()  # MAILER_TIMEZONE mặc định
                tz = cfg.tz
                cfg.tz  # lần thứ hai không cảnh báo lại
            self.assertEqual(len([l for l in logs.output if "tzdata" in l]), 1)
            self.assertEqual(tz.utcoffset(None).total_seconds(), 7 * 3600)
            self.assertEqual(rm.format_datetime("2026-11-22T00:30:00+00:00", tz), "22/11/2026 07:30")
            render_text = render(tz=tz).text
            self.assertIn("22/11/2026 07:30", render_text)

    def test_other_timezone_without_tzdata_reports_how_to_install(self):
        with mock.patch.object(rm, "ZoneInfo", side_effect=ZoneInfoNotFoundError("no tzdata")):
            with self.assertRaises(rm.ConfigError) as ctx:
                make_cfg(MAILER_TIMEZONE="Europe/Paris")
        message = str(ctx.exception)
        self.assertIn("pip install tzdata", message)
        self.assertIn("apt install tzdata", message)

    def test_secrets_not_in_repr(self):
        text = repr(make_cfg())
        self.assertNotIn(SERVICE_KEY, text)
        self.assertNotIn(SMTP_PASSWORD, text)


class PureFunctionTests(unittest.TestCase):
    def test_format_datetime_timezone(self):
        self.assertEqual(rm.format_datetime("2026-11-22T00:30:00+00:00", HCM), "22/11/2026 07:30")
        self.assertEqual(rm.format_datetime("2026-11-22T00:30:00Z", HCM), "22/11/2026 07:30")
        self.assertEqual(rm.format_datetime("2026-11-22T00:30:00", HCM), "22/11/2026 07:30")  # không múi giờ = UTC
        self.assertEqual(rm.format_datetime("2026-11-22 00:30:00.5+00", HCM), "22/11/2026 07:30")
        self.assertEqual(rm.format_datetime("2026-11-22T07:30:00+07:00", HCM), "22/11/2026 07:30")
        self.assertEqual(rm.format_datetime("2026-11-22T23:30:00+00:00", HCM), "23/11/2026 06:30")
        self.assertEqual(rm.format_datetime("2026-11-22T00:30:00+00:00", ZoneInfo("UTC")), "22/11/2026 00:30")

    def test_format_datetime_invalid(self):
        for value in (None, "", "không phải ngày", 12345):
            self.assertIsNone(rm.format_datetime(value, HCM))

    def test_parse_uuid(self):
        self.assertEqual(rm.parse_uuid(UID.upper()), UID)
        for bad in (
            None,
            "",
            "123",
            "campaign-1",
            UID[:-1],
            UID[:10] + "\n" + UID[10:],
            f"{UID},id.neq.0",
            f"{UID}&select=*",
            f"{UID}) or (id=not.is.null",
            "*",
            "../../auth/v1/admin/users",
            f"{UID}\nX-Evil: 1",
        ):
            with self.subTest(bad=bad):
                self.assertIsNone(rm.parse_uuid(bad))
        self.assertEqual(rm.parse_uuid(f" {UID}\n"), UID)  # khoảng trắng hai đầu bị bỏ, kết quả luôn là UUID sạch

    def test_pick_campaign_id(self):
        other = "99999999-2222-4333-8444-555555555555"
        self.assertEqual(rm.pick_campaign_id({"campaign_id": CID, "campaign_key": other}), CID)
        self.assertEqual(rm.pick_campaign_id({"campaign_id": None, "campaign_key": CID}), CID)
        self.assertEqual(rm.pick_campaign_id({"campaign_id": "", "campaign_key": CID.upper()}), CID)
        self.assertIsNone(rm.pick_campaign_id({"campaign_id": None, "campaign_key": "campaign-1"}))
        self.assertIsNone(rm.pick_campaign_id({"campaign_id": "not-a-uuid", "campaign_key": CID}))
        self.assertIsNone(rm.pick_campaign_id({}))

    def test_safe_http_url(self):
        self.assertEqual(rm.safe_http_url("https://a.example.com/x?y=1"), "https://a.example.com/x?y=1")
        for bad in ("javascript:alert(1)", "ftp://a.example.com", "//a.example.com", "https://a b", 'https://a"onclick=1', None):
            self.assertIsNone(rm.safe_http_url(bad))

    def test_display_name(self):
        self.assertEqual(rm.display_name("  Nguyễn  Văn An ", "x@y.com"), "Nguyễn Văn An")
        self.assertEqual(rm.display_name("", "nguyen.an@y.com"), "nguyen.an")
        self.assertEqual(rm.display_name(None, "@y.com"), "bạn")

    def test_scrub(self):
        text = rm.scrub(f"lỗi với {SERVICE_KEY} và {SMTP_PASSWORD}\n" + "x" * 1000, [SERVICE_KEY, SMTP_PASSWORD])
        self.assertNotIn(SERVICE_KEY, text)
        self.assertNotIn(SMTP_PASSWORD, text)
        self.assertLessEqual(len(text), rm.ERROR_MAX_LEN)


class RenderTests(unittest.TestCase):
    def test_basic_render(self):
        mail = render(name="Nguyễn Văn An", campaign_title="Dọn rác Hồ Tây")
        self.assertEqual(mail.subject, "Hà Nội Xanh – Xác nhận đăng ký: Dọn rác Hồ Tây")
        self.assertIn("Chào Nguyễn Văn An,", mail.text)
        self.assertIn('"Dọn rác Hồ Tây"', mail.text)
        self.assertIn("Chiến dịch sẽ diễn ra từ 22/11/2026 07:30 đến 22/11/2026 11:30.", mail.text)
        self.assertIn("Địa điểm: Hồ Tây", mail.text)
        self.assertIn(f"https://hanoixanh.example.com/chien-dich?campaign={CID}", mail.text)
        self.assertIn("hanoixanhh@gmail.com", mail.text)
        self.assertIn("+84 987 231 832", mail.text)
        self.assertIn("Ban Quản trị Hà Nội Xanh", mail.text)
        self.assertIn("Chào Nguyễn Văn An,", mail.html)
        self.assertIn(f'href="https://hanoixanh.example.com/chien-dich?campaign={CID}"', mail.html)
        self.assertNotIn("${", mail.text + mail.html)

    def test_html_escapes_every_value(self):
        evil = '<script>alert(1)</script> & "x"'
        mail = render(name=evil, campaign_title=evil, location=evil)
        self.assertNotIn("<script>", mail.html)
        self.assertIn("&lt;script&gt;", mail.html)
        self.assertIn("&amp;", mail.html)
        # Bản text giữ nguyên ký tự gốc (không phải HTML).
        self.assertIn("<script>", mail.text)

    def test_dollar_sign_in_values_is_not_substituted(self):
        mail = render(name="${ten} $dia_diem", campaign_title="Giá $5")
        self.assertIn("Chào ${ten} $dia_diem,", mail.text)
        self.assertIn("Giá $5", mail.subject)

    def test_empty_name_falls_back(self):
        mail = render(name="   ")
        self.assertIn("Chào bạn,", mail.text)
        self.assertIn("Chào bạn,", mail.html)

    def test_missing_end_at(self):
        mail = render(end_at=None)
        self.assertIn("Chiến dịch sẽ bắt đầu lúc 22/11/2026 07:30.", mail.text)
        self.assertNotIn(" đến ", mail.text.split("Địa điểm")[0].split("Chiến dịch sẽ")[1])

    def test_missing_start_at(self):
        mail = render(start_at=None, end_at=None)
        self.assertIn("sẽ được cập nhật sau", mail.text)

    def test_empty_location(self):
        for value in ("", "   ", None):
            mail = render(location=value)
            self.assertIn("Địa điểm: Sẽ cập nhật", mail.text)
            self.assertIn("Sẽ cập nhật", mail.html)

    def test_subject_has_no_line_breaks(self):
        mail = render(campaign_title="Dọn rác\r\nBcc: victim@example.com\nX: y")
        self.assertNotRegex(mail.subject, r"[\r\n]")
        msg = rm.build_message(mail, to_addr="a@example.com", from_addr="Hà Nội Xanh <h@example.com>")
        self.assertIsNone(msg["Bcc"])
        self.assertNotRegex(str(msg["Subject"]), r"[\r\n]")

    def test_unsafe_link_is_dropped(self):
        mail = render(campaign_url='javascript:alert("x")')
        self.assertNotIn("javascript", mail.html)
        self.assertNotIn("javascript", mail.text)
        self.assertNotIn("<a href=\"javascript", mail.html)

    def test_build_message_structure(self):
        msg = rm.build_message(
            render(), to_addr="an@example.com", from_addr="Hà Nội Xanh <h@example.com>", reply_to="r@example.com"
        )
        parsed = message_from_bytes(msg.as_bytes(), policy=policy.default)
        self.assertEqual(parsed.get_content_type(), "multipart/alternative")
        self.assertEqual(parsed["To"], "an@example.com")
        self.assertEqual(parsed["Reply-To"], "r@example.com")
        self.assertTrue(parsed["Message-ID"].endswith("@example.com>"))
        self.assertTrue(parsed["Date"])
        self.assertEqual(parsed.get_body(("plain",)).get_content_charset(), "utf-8")
        self.assertIn("Chào An,", parsed.get_body(("plain",)).get_content())
        self.assertIn("<strong>", parsed.get_body(("html",)).get_content())

    def test_build_message_rejects_bad_recipient(self):
        for bad in ("a@example.com\nBcc: x@example.com", "không có", "a b@example.com", "a@example.com, b@example.com"):
            with self.subTest(bad=bad), self.assertRaises(rm.PermanentError):
                rm.build_message(render(), to_addr=bad, from_addr="h@example.com")

    def test_custom_templates_dir(self):
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "registration_confirmation.txt").write_text("T ${ten}|${chien_dich}|${thoi_gian}|${dia_diem}|${dong_lien_ket}", encoding="utf-8")
            (Path(tmp) / "registration_confirmation.html").write_text("H ${ten}${nut_xem}", encoding="utf-8")
            mail = render(templates_dir=Path(tmp))
            self.assertTrue(mail.text.startswith("T An|Dọn rác|"))


# --------------------------------------------------------------------------
# Giả lập HTTP / SMTP
# --------------------------------------------------------------------------


class FakeHttp:
    """Giả Supabase: bảng đăng ký, người dùng Auth, profiles, campaigns."""

    def __init__(self):
        self.registrations = []
        self.emails = {UID: "an@example.com"}
        self.names = {UID: "Nguyễn Văn An"}
        self.campaigns = {
            CID: {"id": CID, "title": "Dọn rác Hồ Tây", "location": "Hồ Tây", "start_at": "2026-11-22T00:30:00+00:00", "end_at": None}
        }
        self.calls = []
        self.fail_all = False
        # Hàm RPC: tên -> hàm(args) trả (status, đối tượng JSON). Tên chưa đăng ký giống cơ sở dữ liệu
        # CHƯA chạy migration thông báo: PostgREST trả 404 PGRST202.
        self.rpc_handlers = {}

    def __call__(self, method, url, headers, body, timeout):
        self.calls.append((method, url, headers, json.loads(body) if body else None))
        if self.fail_all:
            raise OSError("mạng đứt")
        assert headers["apikey"] == SERVICE_KEY
        assert headers["Authorization"] == f"Bearer {SERVICE_KEY}"
        path = url.split("supabase.co", 1)[1]
        if method == "POST" and path.startswith("/rest/v1/rpc/"):
            name = path.rsplit("/", 1)[1]
            handler = self.rpc_handlers.get(name)
            if handler is None:
                missing = {"code": "PGRST202", "message": f"Could not find the function public.{name} in the schema cache"}
                return 404, json.dumps(missing).encode()
            status, payload = handler(json.loads(body) if body else {})
            return status, json.dumps(payload).encode()
        if method == "GET" and path.startswith("/rest/v1/campaign_registrations?"):
            return 200, json.dumps(self.registrations).encode()
        if method == "GET" and path.startswith("/auth/v1/admin/users/"):
            uid = path.rsplit("/", 1)[1]
            if uid in self.emails:
                return 200, json.dumps({"id": uid, "email": self.emails[uid]}).encode()
            if uid in self.names:  # người dùng có nhưng không có email
                return 200, json.dumps({"id": uid, "email": None}).encode()
            return 404, b'{"msg":"User not found"}'
        if method == "GET" and path.startswith("/rest/v1/profiles?"):
            uid = path.split("id=eq.", 1)[1].split("&", 1)[0]
            return 200, json.dumps([{"full_name": self.names[uid]}] if uid in self.names else []).encode()
        if method == "GET" and path.startswith("/rest/v1/campaigns?"):
            cid = path.split("id=eq.", 1)[1].split("&", 1)[0]
            return 200, json.dumps([self.campaigns[cid]] if cid in self.campaigns else []).encode()
        if method == "PATCH":
            return 204, b""
        return 500, b"unexpected"

    def patches(self):
        return [c for c in self.calls if c[0] == "PATCH"]


class FakeSend:
    def __init__(self, error=None):
        self.error = error
        self.sent = []

    def __call__(self, msg):
        if self.error:
            raise self.error
        self.sent.append(msg)


def reg(**overrides):
    row = {"id": REG_ID, "user_id": UID, "campaign_id": None, "campaign_key": CID, "confirmation_email_attempts": 0}
    row.update(overrides)
    return row


NOW = datetime(2026, 11, 23, 3, 0, 0, tzinfo=timezone.utc)


class FlowTests(unittest.TestCase):
    def setUp(self):
        self.http = FakeHttp()
        self.http.registrations = [reg()]
        self.cfg = make_cfg()
        self.db = rm.SupabaseClient(self.cfg.supabase_url, SERVICE_KEY, http=self.http, sleep=lambda s: None)
        self.output = []

    def mailer(self, send, dry_run=False):
        return rm.Mailer(self.cfg, self.db, send, dry_run=dry_run, now=lambda: NOW, out=self.output.append)

    def test_pending_query(self):
        self.mailer(FakeSend()).run_once()
        method, url, _, _ = self.http.calls[0]
        self.assertEqual(method, "GET")
        for part in (
            "status=eq.registered",
            "confirmation_email_sent_at=is.null",
            "confirmation_email_attempts=lt.5",
            "order=created_at.asc",
            "limit=20",
        ):
            self.assertIn(part, url)

    def test_success_marks_sent(self):
        send = FakeSend()
        stats = self.mailer(send).run_once()
        self.assertEqual((stats["found"], stats["sent"], stats["failed"]), (1, 1, 0))
        self.assertEqual(len(send.sent), 1)
        msg = send.sent[0]
        self.assertEqual(msg["To"], "an@example.com")
        self.assertIn("Dọn rác Hồ Tây", msg["Subject"])
        body = msg.get_body(("plain",)).get_content()
        self.assertIn("Chào Nguyễn Văn An,", body)
        self.assertIn("Chiến dịch sẽ bắt đầu lúc 22/11/2026 07:30.", body)
        (method, url, headers, payload), = self.http.patches()
        self.assertIn(f"id=eq.{REG_ID}", url)
        self.assertIn("confirmation_email_sent_at=is.null", url)
        self.assertEqual(payload, {"confirmation_email_sent_at": "2026-11-23T03:00:00+00:00", "confirmation_email_error": None})
        self.assertEqual(headers["Prefer"], "return=minimal")

    def test_campaign_id_preferred_and_cached(self):
        other = "99999999-2222-4333-8444-555555555555"
        self.http.campaigns[other] = dict(self.http.campaigns[CID], id=other, title="Chiến dịch khác")
        second = "cccccccc-1111-4222-8333-eeeeeeeeeeee"
        self.http.registrations = [reg(campaign_id=CID, campaign_key=other), reg(id=second, campaign_key=None, campaign_id=CID)]
        send = FakeSend()
        self.mailer(send).run_once()
        self.assertEqual(len(send.sent), 2)
        self.assertTrue(all("Dọn rác Hồ Tây" in m["Subject"] for m in send.sent))
        campaign_calls = [c for c in self.http.calls if "/rest/v1/campaigns?" in c[1]]
        self.assertEqual(len(campaign_calls), 1)  # đã cache theo vòng

    def test_name_falls_back_to_email_local_part(self):
        self.http.names[UID] = ""
        send = FakeSend()
        self.mailer(send).run_once()
        self.assertIn("Chào an,", send.sent[0].get_body(("plain",)).get_content())

    def test_row_transient_failure_increments_attempts_and_stores_only_code(self):
        detail = f"SMTP SMTPRecipientsRefused: {{'an@example.com': (450, b'greylisted')}} {SMTP_PASSWORD}"
        send = FakeSend(error=rm.TransientError(detail, "smtp_recipient_deferred"))
        with self.assertLogs("hnx.mailer", "WARNING") as logs:
            stats = self.mailer(send).run_once()
        self.assertEqual((stats["sent"], stats["failed"], stats["systemic"]), (0, 1, 0))
        (_, url, _, payload), = self.http.patches()
        self.assertIn(f"id=eq.{REG_ID}", url)
        self.assertEqual(payload, {"confirmation_email_attempts": 1, "confirmation_email_error": "smtp_recipient_deferred"})
        # Chi tiết đầy đủ chỉ nằm trong log (đã che secret), không vào DB.
        log_text = "\n".join(logs.output)
        self.assertIn("greylisted", log_text)
        self.assertNotIn(SMTP_PASSWORD, log_text)

    def test_attempts_capped_at_max(self):
        self.http.registrations = [reg(confirmation_email_attempts=4)]
        self.mailer(FakeSend(error=rm.TransientError("SMTP: x", "smtp_error"))).run_once()
        (_, _, _, payload), = self.http.patches()
        self.assertEqual(payload["confirmation_email_attempts"], 5)

    def test_negative_attempts_never_go_below_one(self):
        self.http.registrations = [reg(confirmation_email_attempts=-2147483648)]
        self.mailer(FakeSend(error=rm.TransientError("x", "smtp_error"))).run_once()
        (_, _, _, payload), = self.http.patches()
        self.assertEqual(payload["confirmation_email_attempts"], 1)

    def test_missing_email_is_permanent(self):
        self.http.emails.clear()  # người dùng còn, nhưng không có email
        send = FakeSend()
        stats = self.mailer(send).run_once()
        self.assertEqual(stats["failed"], 1)
        self.assertEqual(send.sent, [])
        (_, _, _, payload), = self.http.patches()
        self.assertEqual(payload["confirmation_email_attempts"], 5)
        self.assertEqual(payload["confirmation_email_error"], "no_auth_email")

    def test_unknown_user_is_permanent(self):
        self.http.emails.clear()
        self.http.names.clear()
        self.mailer(FakeSend()).run_once()
        (_, _, _, payload), = self.http.patches()
        self.assertEqual(payload["confirmation_email_attempts"], 5)
        self.assertEqual(payload["confirmation_email_error"], "auth_user_not_found")

    def test_missing_campaign_is_permanent(self):
        self.http.campaigns.clear()
        send = FakeSend()
        self.mailer(send).run_once()
        self.assertEqual(send.sent, [])
        (_, _, _, payload), = self.http.patches()
        self.assertEqual(payload["confirmation_email_attempts"], 5)
        self.assertEqual(payload["confirmation_email_error"], "campaign_not_found")

    def test_bad_campaign_key_is_permanent_and_never_queried(self):
        self.http.registrations = [reg(campaign_key="x&select=*")]
        self.mailer(FakeSend()).run_once()
        (_, _, _, payload), = self.http.patches()
        self.assertEqual(payload["confirmation_email_attempts"], 5)
        self.assertEqual(payload["confirmation_email_error"], "invalid_campaign_id")
        self.assertFalse([c for c in self.http.calls if "select=*" in c[1]])
        self.assertFalse([c for c in self.http.calls if "/rest/v1/campaigns?" in c[1]])

    def test_bad_user_id_has_its_own_code(self):
        self.http.registrations = [reg(user_id="x,id.neq.0")]
        self.mailer(FakeSend()).run_once()
        (_, _, _, payload), = self.http.patches()
        self.assertEqual(payload["confirmation_email_error"], "invalid_user_id")

    # ---- Sự cố CHUNG: không đốt số lần thử của dòng nào ----

    def test_systemic_smtp_error_burns_no_row_and_stops_round(self):
        second = "cccccccc-1111-4222-8333-eeeeeeeeeeee"
        self.http.registrations = [reg(), reg(id=second)]
        send = FakeSend(error=rm.SystemicError(f"SMTP SMTPAuthenticationError: {SMTP_PASSWORD}", "smtp_auth_failed"))
        mailer = self.mailer(send)
        with self.assertLogs("hnx.mailer", "WARNING") as logs:
            stats = mailer.run_once()
        self.assertEqual((stats["sent"], stats["failed"], stats["systemic"]), (0, 0, 1))
        self.assertEqual(self.http.patches(), [])  # không PATCH attempts của dòng nào
        self.assertEqual(mailer.last_systemic.code, "smtp_auth_failed")
        # Vòng dừng ngay ở dòng đầu: dòng thứ hai không bị đụng tới.
        self.assertFalse([c for c in self.http.calls if second in c[1]])
        self.assertNotIn(SMTP_PASSWORD, "\n".join(logs.output))

    def test_real_smtp_auth_failure_burns_nothing_and_recovers(self):
        regs = [reg(id=f"cccccccc-1111-4222-8333-{i:012d}") for i in range(3)]
        self.http.registrations = regs
        SmtpSenderTests.FakeSmtp.instances = []
        SmtpSenderTests.FakeSmtp.fail_login = True
        sender = rm.make_smtp_sender(self.cfg, smtp_factory=SmtpSenderTests.FakeSmtp)
        mailer = self.mailer(sender)
        try:
            for _ in range(6):  # nhiều vòng liên tiếp, nhiều hơn MAX_ATTEMPTS
                stats = mailer.run_once()
                self.assertEqual((stats["systemic"], stats["failed"]), (1, 0))
        finally:
            SmtpSenderTests.FakeSmtp.fail_login = False
        self.assertEqual(self.http.patches(), [])
        # Mật khẩu được sửa: cả ba dòng vẫn còn nguyên số lần thử và được gửi.
        send = FakeSend()
        stats = self.mailer(send).run_once()
        self.assertEqual((stats["sent"], stats["failed"], stats["systemic"]), (3, 0, 0))
        self.assertTrue(all("confirmation_email_attempts" not in p[3] for p in self.http.patches()))

    def test_supabase_unauthorized_on_auth_admin_is_systemic(self):
        for status in (401, 403, 429, 500, 502, 503):
            with self.subTest(status=status):
                original = self.http.__call__

                def fail_auth(method, url, headers, body, timeout, status=status, original=original):
                    if "/auth/v1/admin/users/" in url:
                        return status, b'{"msg":"nope"}'
                    return original(method, url, headers, body, timeout)

                self.http.calls.clear()
                db = rm.SupabaseClient(self.cfg.supabase_url, SERVICE_KEY, http=fail_auth, sleep=lambda s: None)
                send = FakeSend()
                mailer = rm.Mailer(self.cfg, db, send, now=lambda: NOW, out=self.output.append)
                stats = mailer.run_once()
                self.assertEqual((stats["systemic"], stats["failed"]), (1, 0))
                self.assertEqual(self.http.patches(), [])
                self.assertEqual(send.sent, [])

    def test_supabase_network_error_midway_is_systemic(self):
        original = self.http.__call__

        def drop(method, url, headers, body, timeout):
            if "/rest/v1/campaigns?" in url:
                raise OSError("mạng đứt")
            return original(method, url, headers, body, timeout)

        db = rm.SupabaseClient(self.cfg.supabase_url, SERVICE_KEY, http=drop, sleep=lambda s: None)
        mailer = rm.Mailer(self.cfg, db, FakeSend(), now=lambda: NOW, out=self.output.append)
        stats = mailer.run_once()
        self.assertEqual(stats["systemic"], 1)
        self.assertEqual(mailer.last_systemic.code, "supabase_unreachable")
        self.assertEqual(self.http.patches(), [])

    def test_supabase_404_on_auth_user_is_row_permanent_not_systemic(self):
        self.http.emails.clear()
        self.http.names.clear()
        stats = self.mailer(FakeSend()).run_once()
        self.assertEqual((stats["failed"], stats["systemic"]), (1, 0))

    def test_fetch_error_is_systemic(self):
        mailer = self.mailer(FakeSend())
        self.http.fail_all = True
        stats = mailer.run_once()
        self.assertEqual((stats["fetch_error"], stats["systemic"]), (1, 1))
        self.assertEqual(mailer.last_systemic.code, "supabase_unreachable")
        self.http.fail_all = False
        stats = mailer.run_once()
        self.assertEqual(stats["systemic"], 0)
        self.assertIsNone(mailer.last_systemic)

    def test_mark_sent_failure_stops_round_to_limit_duplicates(self):
        second = "cccccccc-1111-4222-8333-eeeeeeeeeeee"
        self.http.registrations = [reg(), reg(id=second)]
        original = self.http.__call__

        def no_patch(method, url, headers, body, timeout):
            if method == "PATCH":
                return 503, b"busy"
            return original(method, url, headers, body, timeout)

        db = rm.SupabaseClient(self.cfg.supabase_url, SERVICE_KEY, http=no_patch, sleep=lambda s: None)
        send = FakeSend()
        mailer = rm.Mailer(self.cfg, db, send, now=lambda: NOW, out=self.output.append)
        stats = mailer.run_once()
        self.assertEqual((stats["sent"], stats["systemic"]), (1, 1))
        self.assertEqual(len(send.sent), 1)  # dòng thứ hai không được gửi khi không ghi được trạng thái
        self.assertEqual(mailer.last_systemic.code, "supabase_write_failed")

    def test_old_burn_scenario_five_rounds_of_outage(self):
        """Kịch bản cũ: SMTP/Supabase lỗi 5 vòng liên tiếp làm mọi dòng đạt MAX_ATTEMPTS."""
        self.http.registrations = [reg(id=f"cccccccc-1111-4222-8333-{i:012d}") for i in range(4)]
        mailer = self.mailer(FakeSend(error=rm.SystemicError("SMTP SMTPConnectError", "smtp_connect_failed")))
        for _ in range(5):
            mailer.run_once()
        self.assertEqual(self.http.patches(), [])

    def test_bad_user_id_is_never_put_in_url(self):
        self.http.registrations = [reg(user_id="x,id.neq.0")]
        self.mailer(FakeSend()).run_once()
        self.assertFalse([c for c in self.http.calls if "neq" in c[1]])

    def test_dry_run_neither_sends_nor_writes(self):
        send = FakeSend()
        stats = self.mailer(send, dry_run=True).run_once()
        self.assertEqual(stats["dry"], 1)
        self.assertEqual(send.sent, [])
        self.assertEqual(self.http.patches(), [])
        self.assertEqual(len(self.output), 1)
        self.assertIn("Chào Nguyễn Văn An,", self.output[0])
        self.assertIn("Subject: Hà Nội Xanh – Xác nhận đăng ký: Dọn rác Hồ Tây", self.output[0])

    def test_dry_run_failure_does_not_write(self):
        self.http.campaigns.clear()
        self.mailer(FakeSend(), dry_run=True).run_once()
        self.assertEqual(self.http.patches(), [])

    def test_fetch_failure_is_reported_not_raised(self):
        self.http.fail_all = True
        stats = self.mailer(FakeSend()).run_once()
        self.assertEqual(stats["fetch_error"], 1)

    def test_stop_event_interrupts_batch(self):
        self.http.registrations = [reg(), reg(id="cccccccc-1111-4222-8333-eeeeeeeeeeee")]
        stop = threading.Event()
        stop.set()
        send = FakeSend()
        self.mailer(send).run_once(stop)
        self.assertEqual(send.sent, [])

    def test_mark_sent_retries_then_logs(self):
        calls = {"n": 0}
        original = self.http.__call__

        def flaky(method, url, headers, body, timeout):
            if method == "PATCH":
                calls["n"] += 1
                if calls["n"] < 3:
                    return 503, b"busy"
            return original(method, url, headers, body, timeout)

        self.db = rm.SupabaseClient(self.cfg.supabase_url, SERVICE_KEY, http=flaky, sleep=lambda s: None)
        stats = self.mailer(FakeSend()).run_once()
        self.assertEqual(stats["sent"], 1)
        self.assertEqual(calls["n"], 3)


class SmtpSenderTests(unittest.TestCase):
    class FakeSmtp:
        instances = []
        fail_login = False
        send_error = None
        exit_error = None

        def __init__(self, host, port, local_hostname=None, timeout=None, context=None):
            self.host, self.port, self.context = host, port, context
            self.local_hostname = local_hostname
            self.log = []
            self.fail_login = False
            type(self).instances.append(self)

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            self.log.append("quit")
            if type(self).exit_error:
                raise type(self).exit_error

        def ehlo(self):
            self.log.append("ehlo")

        def starttls(self, context=None):
            self.log.append("starttls")

        def login(self, user, password):
            self.log.append(("login", user, password))
            if type(self).fail_login:
                raise smtplib.SMTPAuthenticationError(535, b"bad credentials")

        def send_message(self, msg):
            if type(self).send_error:
                raise type(self).send_error
            self.log.append(("send", msg["To"]))

    def setUp(self):
        self.FakeSmtp.instances = []
        self.FakeSmtp.fail_login = False
        self.FakeSmtp.send_error = None
        self.FakeSmtp.exit_error = None
        self.msg = rm.build_message(render(), to_addr="an@example.com", from_addr="h@example.com")

    def send_with(self, error):
        self.FakeSmtp.send_error = error
        try:
            rm.make_smtp_sender(make_cfg(), smtp_factory=self.FakeSmtp)(self.msg)
        except rm.MailerError as exc:
            return exc
        return None

    def test_quit_failure_after_delivery_is_not_a_failure(self):
        self.FakeSmtp.exit_error = OSError("mất kết nối khi QUIT")
        with self.assertLogs("hnx.mailer", "WARNING"):
            rm.make_smtp_sender(make_cfg(), smtp_factory=self.FakeSmtp)(self.msg)  # không ném lỗi: thư đã gửi

    def test_starttls_flow(self):
        rm.make_smtp_sender(make_cfg(), smtp_factory=self.FakeSmtp)(self.msg)
        log = self.FakeSmtp.instances[0].log
        self.assertEqual(log, ["ehlo", "starttls", "ehlo", ("login", "user@example.com", SMTP_PASSWORD), ("send", "an@example.com"), "quit"])

    def test_ssl_and_none_modes(self):
        rm.make_smtp_sender(make_cfg(SMTP_SECURITY="ssl", SMTP_PORT="465"), smtp_ssl_factory=self.FakeSmtp)(self.msg)
        self.assertEqual(self.FakeSmtp.instances[0].port, 465)
        self.assertNotIn("starttls", self.FakeSmtp.instances[0].log)
        rm.make_smtp_sender(make_cfg(SMTP_SECURITY="none", SMTP_USER="", SMTP_PASSWORD=""), smtp_factory=self.FakeSmtp)(self.msg)
        self.assertNotIn("starttls", self.FakeSmtp.instances[1].log)
        self.assertFalse([e for e in self.FakeSmtp.instances[1].log if isinstance(e, tuple) and e[0] == "login"])

    def test_auth_failure_is_systemic(self):
        self.FakeSmtp.fail_login = True
        with self.assertRaises(rm.SystemicError) as ctx:
            rm.make_smtp_sender(make_cfg(), smtp_factory=self.FakeSmtp)(self.msg)
        self.assertEqual(ctx.exception.code, "smtp_auth_failed")

    def test_connection_errors_are_systemic(self):
        def raiser(error):
            def factory(*a, **k):
                raise error

            return factory

        cases = [
            (ConnectionRefusedError("từ chối"), "smtp_network_error"),
            (OSError("không tới được mạng"), "smtp_network_error"),
            (socket.timeout("quá thời gian"), "smtp_timeout"),
            (ssl.SSLError("lỗi TLS"), "smtp_tls_error"),
            (smtplib.SMTPConnectError(421, b"busy"), "smtp_connect_failed"),
            (smtplib.SMTPServerDisconnected("đứt"), "smtp_server_disconnected"),
            (smtplib.SMTPNotSupportedError("không hỗ trợ STARTTLS"), "smtp_not_supported"),
            (smtplib.SMTPHeloError(501, b"bad helo"), "smtp_helo_failed"),
        ]
        for error, code in cases:
            with self.subTest(code=code, error=type(error).__name__):
                with self.assertRaises(rm.SystemicError) as ctx:
                    rm.make_smtp_sender(make_cfg(), smtp_factory=raiser(error))(self.msg)
                self.assertEqual(ctx.exception.code, code)

    def test_sender_refused_is_systemic(self):
        exc = self.send_with(smtplib.SMTPSenderRefused(550, b"sender not allowed", "h@example.com"))
        self.assertIsInstance(exc, rm.SystemicError)
        self.assertEqual(exc.code, "smtp_sender_refused")

    def test_recipients_refused_is_row_permanent(self):
        exc = self.send_with(smtplib.SMTPRecipientsRefused({"an@example.com": (550, b"no such user")}))
        self.assertIsInstance(exc, rm.PermanentError)
        self.assertEqual(exc.code, "smtp_recipient_refused")

    def test_recipients_deferred_is_row_transient(self):
        exc = self.send_with(smtplib.SMTPRecipientsRefused({"an@example.com": (450, b"try later")}))
        self.assertIsInstance(exc, rm.TransientError)
        self.assertEqual(exc.code, "smtp_recipient_deferred")

    def test_data_error_5xx_is_row_permanent(self):
        exc = self.send_with(smtplib.SMTPDataError(554, b"message rejected as spam"))
        self.assertIsInstance(exc, rm.PermanentError)
        self.assertEqual(exc.code, "smtp_data_rejected")
        exc = self.send_with(smtplib.SMTPDataError(552, b"5.3.4 message size exceeds fixed limit"))
        self.assertIsInstance(exc, rm.PermanentError)

    def test_data_error_quota_or_4xx_is_systemic(self):
        exc = self.send_with(smtplib.SMTPDataError(550, b"5.4.5 Daily user sending quota exceeded"))
        self.assertIsInstance(exc, rm.SystemicError)
        self.assertEqual(exc.code, "smtp_quota_exceeded")
        exc = self.send_with(smtplib.SMTPDataError(451, b"4.3.0 temporary local problem"))
        self.assertIsInstance(exc, rm.SystemicError)
        self.assertEqual(exc.code, "smtp_temporary_failure")

    def test_error_detail_keeps_server_text_for_logs_only(self):
        exc = self.send_with(smtplib.SMTPRecipientsRefused({"an@example.com": (550, b"no such user")}))
        self.assertIn("no such user", str(exc))
        self.assertNotIn("no such user", exc.code)


class FakeStop:
    """Giả threading.Event: ghi lại các lần chờ, tự dừng sau `rounds` lần chờ."""

    def __init__(self, rounds, on_wait=None):
        self.waits = []
        self.rounds = rounds
        self.on_wait = on_wait

    def is_set(self):
        return len(self.waits) >= self.rounds

    def set(self):
        self.rounds = 0

    def wait(self, seconds=None):
        self.waits.append(seconds)
        if self.on_wait:
            self.on_wait(len(self.waits))


class CliTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.lock_path = Path(self._tmp.name) / ".mailer.lock"

    def run_main(self, argv, env, http=None, stop=None, sender=None):
        sender = sender or FakeSend()
        code = rm.main(
            argv + ["--env-file", "/nonexistent/.env"],
            env,
            http=http or FakeHttp(),
            sender_factory=lambda cfg: sender,
            stop=stop or threading.Event(),
            lock_path=self.lock_path,
        )
        return code, sender

    def test_missing_config_exits_with_error(self):
        code, _ = self.run_main(["--once"], {})
        self.assertEqual(code, 2)

    def test_once_sends(self):
        http = FakeHttp()
        http.registrations = [reg()]
        code, sender = self.run_main(["--once"], BASE_ENV, http=http)
        self.assertEqual(code, 0)
        self.assertEqual(len(sender.sent), 1)
        self.assertEqual(len(http.patches()), 1)

    def test_dry_run_without_smtp_config(self):
        http = FakeHttp()
        http.registrations = [reg()]
        env = {k: v for k, v in BASE_ENV.items() if not k.startswith(("SMTP_", "MAIL_"))}
        code, sender = self.run_main(["--dry-run"], env, http=http)
        self.assertEqual(code, 0)
        self.assertEqual(sender.sent, [])
        self.assertEqual(http.patches(), [])

    def test_once_returns_1_when_fetch_fails(self):
        http = FakeHttp()
        http.fail_all = True
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr):
            code, _ = self.run_main(["--once"], BASE_ENV, http=http)
        self.assertEqual(code, 1)
        self.assertIn("Lỗi hệ thống [supabase_unreachable]", stderr.getvalue())

    def test_once_returns_1_with_reason_on_smtp_auth_failure(self):
        http = FakeHttp()
        http.registrations = [reg()]
        sender = FakeSend(error=rm.SystemicError(f"SMTP SMTPAuthenticationError: {SMTP_PASSWORD}", "smtp_auth_failed"))
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr):
            code, _ = self.run_main(["--once"], BASE_ENV, http=http, sender=sender)
        self.assertEqual(code, 1)
        self.assertIn("smtp_auth_failed", stderr.getvalue())
        self.assertNotIn(SMTP_PASSWORD, stderr.getvalue())
        self.assertEqual(http.patches(), [])

    def test_once_returns_0_when_only_rows_fail(self):
        http = FakeHttp()
        http.registrations = [reg()]
        http.campaigns.clear()
        code, _ = self.run_main(["--once"], BASE_ENV, http=http)
        self.assertEqual(code, 0)

    def test_loop_backs_off_exponentially_then_resets(self):
        http = FakeHttp()
        http.registrations = [reg()]
        http.fail_all = True

        def on_wait(n):
            if n == 3:
                http.fail_all = False  # Supabase hồi phục sau 3 vòng lỗi
            if n == 4:
                http.registrations = []  # dòng đã gửi ở vòng 4 (giả lập: không còn chờ)

        stop = FakeStop(rounds=6, on_wait=on_wait)
        code, sender = self.run_main([], dict(BASE_ENV, POLL_SECONDS="30"), http=http, stop=stop)
        self.assertEqual(code, 0)
        # 3 vòng lỗi: 60, 120, 240 giây; vòng thứ 4 thành công thì đặt lại về 30 giây.
        self.assertEqual(stop.waits, [60, 120, 240, 30, 30, 30])
        self.assertEqual(len(sender.sent), 1)
        self.assertEqual(len(http.patches()), 1)  # chỉ PATCH đánh dấu đã gửi, không có PATCH attempts

    def test_loop_backoff_is_capped(self):
        http = FakeHttp()
        http.fail_all = True
        stop = FakeStop(rounds=7)
        self.run_main([], dict(BASE_ENV, POLL_SECONDS="30"), http=http, stop=stop)
        self.assertEqual(stop.waits, [60, 120, 240, 300, 300, 300, 300])

    def test_backoff_delay_values(self):
        self.assertEqual(rm.backoff_delay(30, 0), 30)
        self.assertEqual([rm.backoff_delay(30, n) for n in (1, 2, 3, 4, 5, 50)], [60, 120, 240, 300, 300, 300])
        self.assertEqual(rm.backoff_delay(600, 1), 600)  # POLL_SECONDS lớn hơn trần: không rút ngắn
        self.assertEqual(rm.backoff_delay(1, 1), 2)

    # ---- khóa chống chạy hai tiến trình ----

    @unittest.skipIf(rm.fcntl is None, "nền tảng không có fcntl")
    def test_lock_blocks_second_process_and_releases(self):
        first = rm.acquire_run_lock(self.lock_path)
        self.assertIsNotNone(first)
        with self.assertRaises(rm.LockHeldError):
            rm.acquire_run_lock(self.lock_path)
        first.close()
        again = rm.acquire_run_lock(self.lock_path)
        self.assertIsNotNone(again)
        again.close()

    @unittest.skipIf(rm.fcntl is None, "nền tảng không có fcntl")
    def test_main_exits_3_when_lock_held(self):
        holder = rm.acquire_run_lock(self.lock_path)
        try:
            http = FakeHttp()
            stderr = io.StringIO()
            with contextlib.redirect_stderr(stderr):
                code, sender = self.run_main(["--once"], BASE_ENV, http=http)
            self.assertEqual(code, 3)
            self.assertIn("tiến trình mailer khác đang chạy", stderr.getvalue())
            self.assertEqual(http.calls, [])  # chưa gọi Supabase
            # --dry-run không cần khóa nên vẫn chạy được.
            code, _ = self.run_main(["--dry-run"], BASE_ENV, http=http)
            self.assertEqual(code, 0)
        finally:
            holder.close()

    @unittest.skipIf(rm.fcntl is None, "nền tảng không có fcntl")
    def test_main_releases_lock_on_exit(self):
        self.assertEqual(self.run_main(["--once"], BASE_ENV)[0], 0)
        self.assertEqual(self.run_main(["--once"], BASE_ENV)[0], 0)  # lần 2 không bị khóa cũ chặn

    def test_lock_skipped_without_fcntl(self):
        with mock.patch.object(rm, "fcntl", None):
            self.assertIsNone(rm.acquire_run_lock(self.lock_path))
            self.assertEqual(self.run_main(["--once"], BASE_ENV)[0], 0)
        self.assertFalse(self.lock_path.exists())

    def test_demo_does_not_take_lock(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(rm.main(["--demo"], {}, lock_path=Path(tmp) / "x.lock"), 0)
            self.assertFalse((Path(tmp) / "x.lock").exists())

    def test_loop_stops_on_event(self):
        stop = threading.Event()
        http = FakeHttp()
        http.registrations = []
        timer = threading.Timer(0.2, stop.set)
        timer.start()
        code, _ = self.run_main([], dict(BASE_ENV, POLL_SECONDS="1"), http=http, stop=stop)
        timer.cancel()
        self.assertEqual(code, 0)
        self.assertGreaterEqual(len(http.calls), 1)

    def test_demo_needs_no_config(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "demo.html"
            self.assertEqual(rm.main(["--demo", "--html-out", str(target)], {}), 0)
            self.assertIn("Nguyễn Văn An", target.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
