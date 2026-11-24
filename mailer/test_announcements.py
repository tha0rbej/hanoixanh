import contextlib
import io
import re
import subprocess
import sys
import threading
import unittest
from datetime import datetime, timedelta, timezone
from email import message_from_bytes, policy
from pathlib import Path

import announcements as ann
import registration_mailer as rm
from test_registration_mailer import (
    BASE_ENV,
    CID,
    HCM,
    REG_ID,
    SERVICE_KEY,
    SMTP_PASSWORD,
    UID,
    FakeHttp,
    FakeSend,
    FakeStop,
    make_cfg,
    reg,
)

HERE = Path(__file__).resolve().parent
MIGRATION = HERE.parent / "supabase" / "migrations" / "20261124000000_campaign_announcements.sql"
NOW = datetime(2026, 11, 24, 3, 0, 0, tzinfo=timezone.utc)  # 10:00 ngày 24/11 giờ Hà Nội
AID = "dddddddd-1111-4222-8333-eeeeeeeeeeee"
ADMIN_ID = "99999999-1111-4222-8333-000000000001"
SUBJECT = "Dời giờ tập trung"
BODY = "Chiến dịch dời sang 8h sáng Chủ nhật.\nNhớ mang găng tay."


def uid(i):
    return f"aaaaaaaa-1111-4222-8333-{i:012d}"


def rid(i):
    return f"bbbbbbbb-1111-4222-8333-{i:012d}"


class FakeClock:
    def __init__(self):
        self.t = 1000.0
        self.sleeps = []

    def monotonic(self):
        return self.t

    def sleep(self, seconds):
        self.sleeps.append(seconds)
        self.t += seconds


class ClockStop:
    """Giả threading.Event: wait() chỉ làm đồng hồ giả chạy tới."""

    def __init__(self, clock):
        self.clock = clock
        self.flag = False

    def is_set(self):
        return self.flag

    def set(self):
        self.flag = True

    def wait(self, seconds=None):
        self.clock.sleep(seconds or 0)


class FakeAnnouncementApi:
    """Giả các hàm RPC của migration 20261124000000 (đủ để kiểm tra mailer)."""

    def __init__(self, http, recipients=3, tests=False):
        self.http = http
        self.status = "approved"
        self.subject = SUBJECT
        self.body = BODY
        self.recipients = []
        self.tests = []
        self.marks = []
        self.test_marks = []
        self.releases = []
        self.begins = []
        self.claims = []
        self.quota_args = []
        self.quota_extra = 0  # thư đã gửi hôm nay ngoài các thư của thông báo này (ví dụ thư xác nhận)
        for i in range(1, recipients + 1):
            http.emails[uid(i)] = f"user{i}@example.com"
            http.names[uid(i)] = f"Người Số {i}"
            self.recipients.append(
                {"recipient_id": rid(i), "user_id": uid(i), "status": "pending", "attempts": 0, "leased": False, "error_code": None}
            )
        if tests:
            http.emails[ADMIN_ID] = "admin@example.com"
            http.names[ADMIN_ID] = "Quản Trị Viên"
            self.tests.append({"requested_by": ADMIN_ID, "version": 3, "registrant_count": recipients})
        http.rpc_handlers.update(
            {
                "claim_announcement_tests": self.claim_tests,
                "mark_announcement_test_sent": self.mark_test_sent,
                "mark_announcement_test_failed": self.mark_test_failed,
                "claim_announcement_recipients": self.claim,
                "preview_announcement_recipients": self.preview,
                "begin_announcement_send": self.begin,
                "mark_announcement_recipient": self.mark,
                "release_announcement_recipients": self.release,
                "mail_sent_count_between": self.quota,
            }
        )

    def cancel(self):
        """Giống cancel_announcement: người còn pending thành skipped, thông báo thành cancelled."""
        self.status = "cancelled"
        for r in self.recipients:
            if r["status"] == "pending":
                r.update(status="skipped", error_code="cancelled", leased=False)

    def begin(self, args):
        """Giống begin_announcement_send: chỉ 'ok' khi còn pending, còn lease và thông báo đang chạy."""
        self.begins.append(args["p_recipient_id"])
        r = next((x for x in self.recipients if x["recipient_id"] == args["p_recipient_id"]), None)
        if r is None:
            return 200, {"status": "skip", "reason": "not_pending"}
        if self.status == "cancelled":
            return 200, {"status": "skip", "reason": "cancelled"}
        if self.status not in ("approved", "sending"):
            return 200, {"status": "skip", "reason": "announcement_not_active"}
        if r["status"] != "pending":
            return 200, {"status": "skip", "reason": "not_pending"}
        if not r["leased"]:
            return 200, {"status": "skip", "reason": "lease_lost"}
        return 200, {"status": "ok"}

    def item(self, r):
        return {
            "recipient_id": r["recipient_id"],
            "announcement_id": AID,
            "registration_id": REG_ID,
            "user_id": r["user_id"],
            "attempts": r["attempts"],
            "subject": self.subject,
            "body_text": self.body,
            "version": 3,
            "campaign_id": CID,
            "campaign_title": "Dọn rác Hồ Tây",
            "campaign_location": "Hồ Tây",
            "campaign_start_at": "2026-11-29T00:30:00+00:00",
            "campaign_end_at": None,
        }

    def sent(self):
        return [r for r in self.recipients if r["status"] == "sent"]

    def by_status(self, status):
        return [r for r in self.recipients if r["status"] == status]

    def claim_tests(self, args):
        items = [
            {
                "announcement_id": AID,
                "campaign_id": CID,
                "campaign_title": "Dọn rác Hồ Tây",
                "campaign_location": "Hồ Tây",
                "campaign_start_at": "2026-11-29T00:30:00+00:00",
                "campaign_end_at": None,
                "subject": self.subject,
                "body_text": self.body,
                **t,
            }
            for t in self.tests
        ]
        return 200, {"status": "ok", "items": items}

    def mark_test_sent(self, args):
        self.test_marks.append(("sent", args))
        self.tests.clear()
        return 200, {"status": "ok"}

    def mark_test_failed(self, args):
        self.test_marks.append(("failed", args))
        if args["p_permanent"]:
            self.tests.clear()
        return 200, {"status": "ok"}

    def claimable(self, max_attempts):
        if self.status not in ("approved", "sending"):
            return []
        return [r for r in self.recipients if r["status"] == "pending" and r["attempts"] < max_attempts and not r["leased"]]

    def claim(self, args):
        self.claims.append(args)
        rows = self.claimable(args["p_max_attempts"])[: args["p_limit"]]
        for r in rows:
            r["leased"] = True
        if rows:
            self.status = "sending"
        return 200, {"status": "ok", "items": [self.item(r) for r in rows]}

    def preview(self, args):
        rows = self.claimable(args["p_max_attempts"])[: args["p_limit"]]
        return 200, {"status": "ok", "items": [self.item(r) for r in rows]}

    def mark(self, args):
        self.marks.append(args)
        r = next((x for x in self.recipients if x["recipient_id"] == args["p_recipient_id"]), None)
        if r is None:
            return 200, {"status": "not_found"}
        if r["status"] != "pending":
            return 200, {"status": "already_final", "recipient_status": r["status"]}
        attempts = r["attempts"] + (1 if args["p_count_attempt"] else 0)
        status = args["p_status"]
        if status == "pending" and attempts >= args["p_max_attempts"]:
            status = "failed"
        r.update(status=status, attempts=attempts, error_code=args["p_error_code"], leased=status == "pending" and args["p_count_attempt"])
        if not self.by_status("pending") and self.status in ("approved", "sending"):
            self.status = "sent"
        return 200, {"status": "ok", "recipient_status": status, "announcement_status": self.status}

    def release(self, args):
        self.releases.append(args["p_recipient_ids"])
        for r in self.recipients:
            if r["recipient_id"] in args["p_recipient_ids"] and r["status"] == "pending":
                r["leased"] = False
        return 200, {"status": "ok", "released": len(args["p_recipient_ids"])}

    def quota(self, args):
        self.quota_args.append(args)
        total = self.quota_extra + len(self.sent())
        return 200, {"status": "ok", "total": total, "announcement_recipients": len(self.sent()), "confirmations": self.quota_extra}

    def rpc_names(self):
        return [c[1].rsplit("/", 1)[1] for c in self.http.calls if "/rest/v1/rpc/" in c[1]]


class WorkerCase(unittest.TestCase):
    """Dựng sẵn: FakeHttp, API giả, đồng hồ giả, bộ gửi giả và một AnnouncementWorker."""

    recipients = 3
    with_tests = False
    env = {}

    def setUp(self):
        self.http = FakeHttp()
        self.http.registrations = []
        self.api = FakeAnnouncementApi(self.http, recipients=self.recipients, tests=self.with_tests)
        self.cfg = make_cfg(**self.env)
        self.db = rm.SupabaseClient(self.cfg.supabase_url, SERVICE_KEY, http=self.http, sleep=lambda s: None)
        self.clock = FakeClock()
        self.stop = ClockStop(self.clock)
        self.now = NOW
        self.output = []
        self.send = FakeSend()
        self.worker = self.make_worker(self.send)

    def make_worker(self, send, dry_run=False):
        return ann.AnnouncementWorker(
            self.cfg,
            self.db,
            send,
            dry_run=dry_run,
            now=lambda: self.now,
            out=self.output.append,
            monotonic=self.clock.monotonic,
            sleep=self.clock.sleep,
        )

    def to_addrs(self):
        return [m["To"] for m in self.send.sent]


# --------------------------------------------------------------------------
# Hàm thuần
# --------------------------------------------------------------------------


class TextToHtmlTests(unittest.TestCase):
    def test_paragraphs_and_line_breaks(self):
        out = ann.text_to_html("Dòng 1\nDòng 2\n\nĐoạn hai\n\n\n\nĐoạn ba")
        self.assertEqual(out.count("<p "), 3)
        self.assertIn("Dòng 1<br>Dòng 2", out)
        self.assertNotIn("\n\n", out.replace("</p>\n            <p", ""))

    def test_no_html_passes_through(self):
        evil = '<script>alert(1)</script>\n<img src=x onerror=alert(1)>\n<a href="javascript:alert(1)">bấm</a> & "x" \'y\''
        out = ann.text_to_html(evil)
        self.assertNotIn("<script", out)
        self.assertNotIn("<img", out)
        self.assertNotIn('<a href="javascript', out)
        self.assertEqual(re.findall(r"<(?!/?p[ >]|br>)(\w+)", out), [])  # chỉ còn <p> và <br>
        self.assertIn("&lt;script&gt;alert(1)&lt;/script&gt;", out)
        self.assertIn("&lt;img src=x onerror=alert(1)&gt;", out)
        self.assertIn("&amp;", out)

    def test_http_and_https_urls_are_linked(self):
        out = ann.text_to_html("Xem https://example.com/a?b=1&c=2 và http://example.org/x nhé")
        self.assertIn('<a href="https://example.com/a?b=1&amp;c=2"', out)
        self.assertIn('<a href="http://example.org/x"', out)

    def test_trailing_punctuation_stays_outside_link(self):
        out = ann.text_to_html("Vào https://example.com/path. Hoặc (https://example.com/b), hết.")
        self.assertIn('href="https://example.com/path"', out)
        self.assertIn('href="https://example.com/b"', out)
        self.assertIn("</a>.", out)
        self.assertIn("</a>),", out)

    def test_non_http_schemes_are_not_linked(self):
        for text in (
            "javascript:alert(1)",
            "[bấm vào đây](javascript:alert(1))",
            "ftp://example.com/file",
            "data:text/html,<script>alert(1)</script>",
            "//example.com",
            "www.example.com",
            "http://",
        ):
            with self.subTest(text=text):
                out = ann.text_to_html(text)
                self.assertNotIn("<a ", out)
                self.assertNotIn("<script", out)

    def test_url_cannot_break_out_of_attribute(self):
        out = ann.text_to_html('https://example.com/"onmouseover="alert(1)')
        self.assertEqual(out.count("<a "), 1)
        self.assertNotIn('onmouseover="alert', out.split("</a>")[0])
        self.assertIn("&quot;onmouseover=&quot;alert(1)", out)
        self.assertNotIn('"onmouseover="', out)

    def test_control_characters_are_removed(self):
        out = ann.text_to_html("a\x00b\x07c\x1b[31md")
        self.assertNotRegex(out, r"[\x00-\x08\x0b\x0c\x0e-\x1f]")

    def test_empty_body(self):
        self.assertEqual(ann.text_to_html("   \n\n  "), "")
        self.assertEqual(ann.sanitize_body(None), "")


class RenderTests(unittest.TestCase):
    def render(self, **overrides):
        args = dict(
            name="An",
            subject=SUBJECT,
            body_text=BODY,
            campaign_title="Dọn rác Hồ Tây",
            location="Hồ Tây",
            start_at="2026-11-29T00:30:00+00:00",
            end_at="2026-11-29T04:30:00+00:00",
            campaign_url=f"https://hanoixanh.example.com/chien-dich?campaign={CID}",
            tz=HCM,
        )
        args.update(overrides)
        return ann.render_announcement(**args)

    def test_standard_format(self):
        mail = self.render()
        self.assertEqual(mail.subject, SUBJECT)
        text = mail.text
        self.assertTrue(text.startswith("Chào An,"))
        self.assertIn(BODY, text)
        self.assertIn('Chiến dịch "Dọn rác Hồ Tây"', text)
        self.assertIn("Chiến dịch sẽ diễn ra từ 29/11/2026 07:30 đến 29/11/2026 11:30.", text)
        self.assertIn("Địa điểm: Hồ Tây", text)
        self.assertIn(f"Xem chi tiết chiến dịch: https://hanoixanh.example.com/chien-dich?campaign={CID}", text)
        self.assertIn('Bạn nhận thư này vì đã đăng ký tham gia chiến dịch "Dọn rác Hồ Tây".', text)
        self.assertIn("hanoixanhh@gmail.com", text)
        self.assertIn("+84 987 231 832", text)
        self.assertIn("Ban Quản trị Hà Nội Xanh", text)
        self.assertIn("Chào An,", mail.html)
        self.assertIn(f'href="https://hanoixanh.example.com/chien-dich?campaign={CID}"', mail.html)
        self.assertIn("Bạn nhận thư này vì đã đăng ký tham gia chiến dịch", mail.html)
        self.assertIn("Chiến dịch sẽ diễn ra từ 29/11/2026 07:30", mail.html)
        self.assertNotIn("${", mail.text + mail.html)
        self.assertNotIn("[THỬ]", mail.text + mail.html)

    def test_text_part_keeps_original_but_html_is_escaped(self):
        evil = '<script>alert(1)</script> & "x"'
        mail = self.render(name=evil, body_text=evil, subject=evil, campaign_title=evil, location=evil)
        self.assertIn("<script>", mail.text)
        self.assertNotIn("<script>", mail.html)
        self.assertIn("&lt;script&gt;", mail.html)

    def test_dollar_signs_are_not_substituted(self):
        mail = self.render(name="${ten}", body_text="Giá $5 và ${chien_dich} và $dia_diem")
        self.assertIn("Chào ${ten},", mail.text)
        self.assertIn("Giá $5 và ${chien_dich} và $dia_diem", mail.text)

    def test_subject_is_one_clean_line(self):
        mail = self.render(subject="Dời giờ\r\nBcc: victim@example.com\n\tX-Evil: 1\x00")
        self.assertNotRegex(mail.subject, r"[\x00-\x1f\x7f]")
        msg = ann.build_announcement_message(mail, to_addr="a@example.com", from_addr="Hà Nội Xanh <h@example.com>")
        self.assertIsNone(msg["Bcc"])
        self.assertIsNone(msg["X-Evil"])
        self.assertNotRegex(str(msg["Subject"]), r"[\r\n]")

    def test_subject_falls_back_when_empty(self):
        self.assertEqual(self.render(subject="  \n ").subject, ann.DEFAULT_SUBJECT)

    def test_test_mail_is_marked(self):
        mail = self.render(test=True, registrant_count=42)
        self.assertTrue(mail.subject.startswith("[THỬ] "))
        self.assertTrue(mail.text.startswith("[THỬ] "))
        self.assertIn("42 người", mail.text.split("\n\n")[0])
        self.assertIn("[THỬ]", mail.html)

    def test_unsafe_link_is_dropped(self):
        mail = self.render(campaign_url='javascript:alert("x")')
        self.assertNotIn("javascript", mail.html + mail.text)

    def test_missing_campaign_details(self):
        mail = self.render(campaign_title="", location="", start_at=None, end_at=None)
        self.assertIn("Địa điểm: Sẽ cập nhật", mail.text)
        self.assertIn("sẽ được cập nhật sau", mail.text)

    def test_message_headers(self):
        mail = self.render()
        msg = ann.build_announcement_message(
            mail, to_addr="an@example.com", from_addr="Hà Nội Xanh <h@example.com>", reply_to="r@example.com", ref_id="hnx-ann-123"
        )
        parsed = message_from_bytes(msg.as_bytes(), policy=policy.default)
        self.assertEqual(parsed["Auto-Submitted"], "auto-generated")
        self.assertEqual(parsed["X-Entity-Ref-ID"], "hnx-ann-123")
        self.assertTrue(re.fullmatch(r"<[^<>\s]+@example\.com>", parsed["Message-ID"]))
        self.assertEqual(parsed["Reply-To"], "r@example.com")
        self.assertEqual(parsed.get_content_type(), "multipart/alternative")
        self.assertIn("Chào An,", parsed.get_body(("plain",)).get_content())

    def test_ref_id_cannot_inject_headers(self):
        msg = ann.build_announcement_message(
            self.render(), to_addr="an@example.com", from_addr="h@example.com", ref_id="x\r\nBcc: victim@example.com"
        )
        self.assertIsNone(msg["Bcc"])
        self.assertNotRegex(str(msg["X-Entity-Ref-ID"]), r"[\r\n]")

    def test_recipient_address_injection_is_rejected(self):
        for bad in ("a@example.com\nBcc: x@example.com", "a b@example.com", "không có"):
            with self.subTest(bad=bad), self.assertRaises(rm.PermanentError):
                ann.build_announcement_message(self.render(), to_addr=bad, from_addr="h@example.com")


class ConfigTests(unittest.TestCase):
    def test_defaults(self):
        cfg = make_cfg()
        self.assertTrue(cfg.announcements_enabled)
        self.assertEqual(cfg.announce_per_minute, 20)
        self.assertEqual(cfg.daily_limit, 400)

    def test_overrides(self):
        cfg = make_cfg(ANNOUNCEMENTS_ENABLED="false", ANNOUNCE_PER_MINUTE="5", MAILER_DAILY_LIMIT="450")
        self.assertFalse(cfg.announcements_enabled)
        self.assertEqual((cfg.announce_per_minute, cfg.daily_limit), (5, 450))
        for value in ("0", "no", "OFF", "False"):
            self.assertFalse(make_cfg(ANNOUNCEMENTS_ENABLED=value).announcements_enabled)
        for value in ("1", "yes", "ON", "True"):
            self.assertTrue(make_cfg(ANNOUNCEMENTS_ENABLED=value).announcements_enabled)

    def test_invalid_values(self):
        for overrides in (
            {"ANNOUNCEMENTS_ENABLED": "có"},
            {"ANNOUNCE_PER_MINUTE": "0"},
            {"ANNOUNCE_PER_MINUTE": "abc"},
            {"MAILER_DAILY_LIMIT": "0"},
            {"MAILER_DAILY_LIMIT": "-5"},
        ):
            with self.subTest(overrides=overrides), self.assertRaises(rm.ConfigError):
                make_cfg(**overrides)

    def test_batch_size_and_interval(self):
        worker = lambda ppm: ann.AnnouncementWorker(make_cfg(ANNOUNCE_PER_MINUTE=str(ppm)), None, None)  # noqa: E731
        self.assertEqual([worker(p).batch_size for p in (1, 2, 20, 60, 120)], [1, 1, 7, 20, 20])
        self.assertEqual(worker(20).interval, 3.0)
        self.assertEqual(worker(1).interval, 60.0)

    def test_new_variables_are_read_from_env_file(self):
        env = rm.merge_env(
            rm.parse_env_text("ANNOUNCE_PER_MINUTE=7\nMAILER_DAILY_LIMIT=123\nANNOUNCEMENTS_ENABLED=false\n"), {}
        )
        self.assertEqual(env["ANNOUNCE_PER_MINUTE"], "7")
        self.assertEqual(env["MAILER_DAILY_LIMIT"], "123")
        self.assertEqual(env["ANNOUNCEMENTS_ENABLED"], "false")


# --------------------------------------------------------------------------
# Gửi thử
# --------------------------------------------------------------------------


class TestMailTests(WorkerCase):
    recipients = 4
    with_tests = True

    def test_test_mail_goes_only_to_the_requesting_admin(self):
        result = self.worker.run_round(self.stop)
        # thư thử + 4 thư thật: kiểm tra riêng thư thử
        test_msg = self.send.sent[0]
        self.assertEqual(test_msg["To"], "admin@example.com")
        self.assertTrue(test_msg["Subject"].startswith("[THỬ] "))
        body = test_msg.get_body(("plain",)).get_content()
        self.assertTrue(body.startswith("[THỬ] "))
        self.assertIn("Chào Quản Trị Viên,", body)
        self.assertIn("Nhớ mang găng tay.", body)
        self.assertIn("4 người", body.split("\n\n")[0])
        self.assertEqual(result["tests"], 1)
        self.assertEqual(self.api.test_marks, [("sent", {"p_announcement_id": AID, "p_version": 3})])
        # Không người đăng ký nào nhận bản thử: mọi thư còn lại đều không có tiền tố.
        self.assertNotIn("admin@example.com", [m["To"] for m in self.send.sent[1:]])
        self.assertTrue(all(not m["Subject"].startswith("[THỬ]") for m in self.send.sent[1:]))

    def test_test_mail_sent_once_per_request(self):
        self.worker.run_round(self.stop)
        self.worker.run_round(self.stop)
        admin_mails = [m for m in self.send.sent if m["To"] == "admin@example.com"]
        self.assertEqual(len(admin_mails), 1)

    def test_test_mail_without_admin_email_is_failed_with_code(self):
        self.http.emails.pop(ADMIN_ID)
        self.worker.run_round(self.stop)
        self.assertNotIn("admin@example.com", self.to_addrs())
        kind, args = self.api.test_marks[0]
        self.assertEqual(kind, "failed")
        self.assertEqual((args["p_error_code"], args["p_permanent"], args["p_version"]), ("no_auth_email", True, 3))

    def test_test_mail_transient_error_is_not_permanent(self):
        send = FakeSend(error=rm.TransientError("SMTP: greylisted", "smtp_recipient_deferred"))
        worker = self.make_worker(send)
        worker.run_round(self.stop)
        kind, args = self.api.test_marks[0]
        self.assertEqual((kind, args["p_error_code"], args["p_permanent"]), ("failed", "smtp_recipient_deferred", False))

    def test_test_mail_smtp_outage_is_systemic_and_marks_nothing(self):
        worker = self.make_worker(FakeSend(error=rm.SystemicError(f"SMTP auth {SMTP_PASSWORD}", "smtp_auth_failed")))
        with self.assertRaises(rm.SystemicError) as ctx:
            worker.run_round(self.stop)
        self.assertEqual(ctx.exception.code, "smtp_auth_failed")
        self.assertEqual(self.api.test_marks, [])
        self.assertEqual(self.api.marks, [])


# --------------------------------------------------------------------------
# Gửi thật
# --------------------------------------------------------------------------


class BulkSendTests(WorkerCase):
    recipients = 5

    def test_one_personal_mail_per_recipient(self):
        result = self.worker.run_round(self.stop)
        self.assertEqual((result["sent"], result["failed"], result["busy"]), (5, 0, True))
        self.assertEqual(self.to_addrs(), [f"user{i}@example.com" for i in range(1, 6)])
        for i, msg in enumerate(self.send.sent, start=1):
            body = msg.get_body(("plain",)).get_content()
            self.assertIn(f"Chào Người Số {i},", body)
            self.assertIn("Chiến dịch dời sang 8h sáng Chủ nhật.", body)
            self.assertEqual(msg["Subject"], SUBJECT)
            self.assertEqual(msg["X-Entity-Ref-ID"], f"hnx-ann-{rid(i)}")
            for j in range(1, 6):
                if j != i:
                    self.assertNotIn(f"user{j}@example.com", msg.as_string())  # không lộ địa chỉ người khác
        self.assertEqual([m["p_recipient_id"] for m in self.api.marks], [rid(i) for i in range(1, 6)])
        self.assertTrue(all(m["p_status"] == "sent" and m["p_count_attempt"] for m in self.api.marks))

    def test_announcement_becomes_sent_when_nothing_is_left(self):
        self.cfg = make_cfg(ANNOUNCE_PER_MINUTE="120")
        self.worker = self.make_worker(self.send)
        self.worker.run_round(self.stop)
        self.assertEqual(self.api.status, "sent")
        self.assertEqual(len(self.api.sent()), 5)

    def test_claim_uses_lease_attempts_and_batch_size(self):
        self.worker.run_round(self.stop)
        (args, *_) = self.api.claims
        self.assertEqual(args, {"p_limit": 7, "p_max_attempts": 5, "p_lease_seconds": 300})

    def test_no_duplicate_when_recipient_already_sent(self):
        self.api.recipients[0]["status"] = "sent"
        self.api.recipients[1]["status"] = "skipped"
        self.worker.run_round(self.stop)
        self.assertEqual(self.to_addrs(), ["user3@example.com", "user4@example.com", "user5@example.com"])
        # Vòng tiếp theo, và vòng sau nữa: không ai nhận thêm thư.
        self.worker.run_round(self.stop)
        self.worker.run_round(self.stop)
        self.assertEqual(len(self.send.sent), 3)

    def test_marking_an_already_final_recipient_does_not_resend_or_fail(self):
        # Hủy đúng lúc thư đang đi (sau begin, trước mark): mailer ghi nhận, không ném lỗi, không gửi tiếp.
        class CancelDuringFirstSend(FakeSend):
            def __call__(inner, msg):
                super().__call__(msg)
                for r in self.api.recipients:
                    if r["recipient_id"] == rid(1):
                        r["status"] = "skipped"
                self.api.cancel()

        self.send = CancelDuringFirstSend()
        self.worker = self.make_worker(self.send)
        with self.assertLogs("hnx.mailer", "WARNING") as logs:
            result = self.worker.run_round(self.stop)
        self.assertEqual(len(self.send.sent), 1)
        self.assertEqual(result["failed"], 0)
        self.assertTrue(any("không ghi đè" in line for line in logs.output))

    def test_cancel_midway_stops_the_rest_of_the_batch(self):
        class CancelAfterSecond(FakeSend):
            def __call__(inner, msg):
                super().__call__(msg)
                if len(inner.sent) == 2:
                    self.api.cancel()

        self.send = CancelAfterSecond()
        self.worker = self.make_worker(self.send)
        result = self.worker.run_round(self.stop)
        self.assertEqual(self.to_addrs(), ["user1@example.com", "user2@example.com"])
        self.assertEqual(result["sent"], 2)
        self.assertEqual(result["failed"], 0)
        # Thư thứ 2 đang đi lúc hủy nên DB không ghi "sent" cho nó; 3 người sau không bị đụng tới.
        self.assertEqual(self.api.begins, [rid(1), rid(2), rid(3)])
        self.assertEqual(len(self.api.sent()), 1)
        self.assertEqual(len(self.api.by_status("skipped")), 4)
        self.assertTrue(all(r["attempts"] == 0 for r in self.api.by_status("skipped")))
        # Vòng sau không còn gì để gửi.
        self.worker.run_round(self.stop)
        self.assertEqual(len(self.send.sent), 2)

    def test_begin_is_asked_before_every_real_mail_but_not_for_test_mails(self):
        self.worker.run_round(self.stop)
        self.assertEqual(self.api.begins, [rid(i) for i in range(1, 6)])
        # Mỗi thư: begin rồi mới tới mark của chính nó.
        names = [n for n in self.api.rpc_names() if n in ("begin_announcement_send", "mark_announcement_recipient")]
        self.assertEqual(names, ["begin_announcement_send", "mark_announcement_recipient"] * 5)

    def test_skip_does_not_burn_attempts_or_report_errors(self):
        for reason in ("not_pending", "lease_lost"):
            with self.subTest(reason=reason):
                self.setUp()
                self.http.rpc_handlers["begin_announcement_send"] = lambda args, reason=reason: (
                    200,
                    {"status": "skip", "reason": reason},
                )
                with self.assertNoLogs("hnx.mailer", "WARNING"):
                    result = self.worker.run_round(self.stop)
                self.assertEqual(self.send.sent, [])
                self.assertEqual((result["sent"], result["failed"]), (0, 0))
                self.assertEqual(self.api.marks, [])
                self.assertTrue(all(r["attempts"] == 0 for r in self.api.recipients))

    def test_begin_server_error_is_systemic_and_nothing_is_sent(self):
        for status in (500, 401, 403, 0):
            with self.subTest(status=status):
                self.setUp()
                self.http.rpc_handlers["begin_announcement_send"] = lambda args, status=status: (status, {"message": "boom"})
                with self.assertRaises(rm.SystemicError):
                    self.worker.run_round(self.stop)
                self.assertEqual(self.send.sent, [])
                self.assertTrue(all(r["attempts"] == 0 for r in self.api.recipients))
                self.assertTrue(all(not r["leased"] for r in self.api.by_status("pending")))  # lease được nhả

    def test_begin_garbage_answer_is_systemic_and_nothing_is_sent(self):
        self.http.rpc_handlers["begin_announcement_send"] = lambda args: (200, {"status": "weird"})
        with self.assertRaises(rm.SystemicError):
            self.worker.run_round(self.stop)
        self.assertEqual(self.send.sent, [])
        self.assertTrue(all(r["attempts"] == 0 for r in self.api.recipients))

    def test_rate_limit_sleeps_between_mails(self):
        self.worker.run_round(self.stop)
        # 20 thư/phút = 3 giây giữa hai thư; 5 thư => 4 lần chờ.
        self.assertEqual(len(self.clock.sleeps), 4)
        self.assertTrue(all(abs(s - 3.0) < 1e-6 for s in self.clock.sleeps))
        self.assertGreaterEqual(self.clock.t - 1000.0, 12.0)

    def test_rate_limit_does_not_wait_after_a_failed_row(self):
        self.http.emails.pop(uid(2))  # người số 2 không có email: lỗi riêng, không gửi => không phải ngủ
        self.worker.run_round(self.stop)
        self.assertEqual(len(self.send.sent), 4)
        self.assertEqual(len(self.clock.sleeps), 3)

    def test_rate_limit_uses_announce_per_minute(self):
        self.cfg = make_cfg(ANNOUNCE_PER_MINUTE="6")
        self.worker = self.make_worker(self.send)
        self.worker.run_round(self.stop)
        self.assertEqual(self.api.claims[0]["p_limit"], 2)  # lô nhỏ: 6/3 = 2 người
        self.assertEqual(len(self.send.sent), 2)
        self.assertEqual(self.clock.sleeps, [10.0])  # 6 thư/phút = 10 giây giữa hai thư

    def test_rate_limit_keeps_spacing_across_rounds(self):
        self.cfg = make_cfg(ANNOUNCE_PER_MINUTE="3")  # lô 1 người, cách nhau 20 giây
        self.worker = self.make_worker(self.send)
        for _ in range(3):
            self.worker.run_round(self.stop)
        self.assertEqual(len(self.send.sent), 3)
        self.assertEqual(self.clock.sleeps, [20.0, 20.0])

    def test_stop_event_during_wait_releases_unsent_leases(self):
        class StopAfterFirst(ClockStop):
            def wait(self, seconds=None):
                super().wait(seconds)
                self.flag = True

        stop = StopAfterFirst(self.clock)
        result = self.worker.run_round(stop)
        self.assertEqual(result["sent"], 1)
        self.assertEqual(len(self.send.sent), 1)
        self.assertEqual(self.api.releases, [[rid(i) for i in range(2, 6)]])
        self.assertTrue(all(not r["leased"] for r in self.api.by_status("pending")))

    def test_html_part_is_safe_for_hostile_body(self):
        self.api.body = '<script>alert(1)</script>\n<img src=x onerror=alert(1)>\nhttps://example.com/x'
        self.worker.run_round(self.stop)
        html_part = self.send.sent[0].get_body(("html",)).get_content()
        self.assertNotIn("<script", html_part)
        self.assertNotIn("<img", html_part)
        self.assertIn('href="https://example.com/x"', html_part)
        text_part = self.send.sent[0].get_body(("plain",)).get_content()
        self.assertIn("<script>alert(1)</script>", text_part)  # bản text giữ nguyên văn


class FailureTests(WorkerCase):
    recipients = 4

    def test_systemic_smtp_failure_burns_no_attempt_and_releases_all_leases(self):
        class FailOnSecond:
            def __init__(self):
                self.sent = []

            def __call__(self, msg):
                if len(self.sent) == 1:
                    raise rm.SystemicError(f"SMTP SMTPAuthenticationError {SMTP_PASSWORD}", "smtp_auth_failed")
                self.sent.append(msg)

        send = FailOnSecond()
        worker = self.make_worker(send)
        with self.assertRaises(rm.SystemicError) as ctx:
            worker.run_round(self.stop)
        self.assertEqual(ctx.exception.code, "smtp_auth_failed")
        self.assertEqual(len(send.sent), 1)
        # Chỉ người đầu được ghi 'sent'; không ai bị đánh lỗi hay tăng lần thử.
        self.assertEqual([(m["p_recipient_id"], m["p_status"]) for m in self.api.marks], [(rid(1), "sent")])
        self.assertEqual([r["attempts"] for r in self.api.recipients], [1, 0, 0, 0])
        self.assertEqual(self.api.releases, [[rid(2), rid(3), rid(4)]])
        self.assertTrue(all(not r["leased"] for r in self.api.by_status("pending")))

    def test_many_systemic_rounds_never_fail_anyone(self):
        send = FakeSend(error=rm.SystemicError("SMTP SMTPConnectError", "smtp_connect_failed"))
        worker = self.make_worker(send)
        for _ in range(8):  # nhiều hơn MAX_ATTEMPTS
            with self.assertRaises(rm.SystemicError):
                worker.run_round(self.stop)
        self.assertTrue(all(r["status"] == "pending" and r["attempts"] == 0 and not r["leased"] for r in self.api.recipients))
        self.assertEqual([m for m in self.api.marks if m["p_count_attempt"]], [])
        # SMTP khỏe lại: cả bốn người vẫn được gửi.
        good = self.make_worker(FakeSend())
        result = good.run_round(self.stop)
        self.assertEqual(result["sent"], 4)

    def test_mailer_reports_systemic_and_skips_announcement_when_confirmations_hit_systemic(self):
        self.http.registrations = [reg()]
        send = FakeSend(error=rm.SystemicError("SMTP down", "smtp_connect_failed"))
        mailer = rm.Mailer(self.cfg, self.db, send, now=lambda: NOW, out=self.output.append)
        mailer.announcements = self.make_worker(send)
        stats = mailer.run_once(self.stop)
        self.assertEqual(stats["systemic"], 1)
        self.assertEqual(self.api.rpc_names(), [])  # chưa động tới thông báo
        self.assertEqual(mailer.last_systemic.code, "smtp_connect_failed")

    def test_mailer_reports_announcement_systemic(self):
        send = FakeSend(error=rm.SystemicError("SMTP down", "smtp_auth_failed"))
        mailer = rm.Mailer(self.cfg, self.db, send, now=lambda: NOW, out=self.output.append)
        mailer.announcements = self.make_worker(send)
        stats = mailer.run_once(self.stop)
        self.assertEqual((stats["systemic"], stats["ann_sent"]), (1, 0))
        self.assertEqual(mailer.last_systemic.code, "smtp_auth_failed")
        self.assertEqual(self.api.marks, [])

    def test_supabase_outage_during_claim_is_systemic(self):
        for status, code in ((401, "supabase_unauthorized"), (429, "supabase_rate_limited"), (503, "supabase_server_error")):
            with self.subTest(status=status):
                self.http.rpc_handlers["claim_announcement_recipients"] = lambda args, status=status: (status, {"message": "x"})
                with self.assertRaises(rm.SystemicError) as ctx:
                    self.worker.run_round(self.stop)
                self.assertEqual(ctx.exception.code, code)
        self.assertEqual(self.send.sent, [])

    def test_network_error_is_systemic(self):
        self.http.fail_all = True
        with self.assertRaises(rm.SystemicError) as ctx:
            self.worker.run_round(self.stop)
        self.assertEqual(ctx.exception.code, "supabase_unreachable")

    def test_auth_outage_midway_is_systemic_and_releases(self):
        original = self.http.__call__

        def dead_auth(method, url, headers, body, timeout):
            if "/auth/v1/admin/users/" in url:
                return 503, b"down"
            return original(method, url, headers, body, timeout)

        db = rm.SupabaseClient(self.cfg.supabase_url, SERVICE_KEY, http=dead_auth, sleep=lambda s: None)
        worker = ann.AnnouncementWorker(self.cfg, db, self.send, now=lambda: NOW, monotonic=self.clock.monotonic, sleep=self.clock.sleep)
        with self.assertRaises(rm.SystemicError) as ctx:
            worker.run_round(self.stop)
        self.assertEqual(ctx.exception.code, "supabase_server_error")
        self.assertEqual(self.api.marks, [])
        self.assertEqual(self.api.releases, [[rid(i) for i in range(1, 5)]])

    def test_row_without_email_is_failed_with_code_and_others_continue(self):
        self.http.emails.pop(uid(2))
        with self.assertLogs("hnx.mailer", "ERROR"):
            result = self.worker.run_round(self.stop)
        self.assertEqual((result["sent"], result["failed"]), (3, 1))
        self.assertEqual(self.to_addrs(), ["user1@example.com", "user3@example.com", "user4@example.com"])
        failed = next(m for m in self.api.marks if m["p_recipient_id"] == rid(2))
        self.assertEqual(
            (failed["p_status"], failed["p_error_code"], failed["p_count_attempt"]), ("failed", "no_auth_email", True)
        )
        self.assertEqual(self.api.recipients[1]["status"], "failed")

    def test_unknown_auth_user_is_failed_with_code(self):
        self.http.emails.pop(uid(1))
        self.http.names.pop(uid(1))  # 404 từ Auth
        with self.assertLogs("hnx.mailer", "ERROR"):
            self.worker.run_round(self.stop)
        self.assertEqual(self.api.recipients[0]["error_code"], "auth_user_not_found")

    def test_smtp_permanent_refusal_is_failed_with_code_only(self):
        detail = "SMTP SMTPRecipientsRefused: {'user1@example.com': (550, b'no such user')}"
        send = FakeSend(error=rm.PermanentError(detail, "smtp_recipient_refused"))
        worker = self.make_worker(send)
        with self.assertLogs("hnx.mailer", "ERROR") as logs:
            result = worker.run_round(self.stop)
        self.assertEqual(result["failed"], 4)
        self.assertTrue(all(m["p_status"] == "failed" and m["p_error_code"] == "smtp_recipient_refused" for m in self.api.marks))
        # Chuỗi lỗi thô chỉ ở log, không vào DB.
        self.assertTrue(all("no such user" not in str(m) for m in self.api.marks))
        self.assertIn("no such user", "\n".join(logs.output))

    def test_smtp_transient_refusal_counts_attempt_until_max(self):
        send = FakeSend(error=rm.TransientError("SMTP: greylisted", "smtp_recipient_deferred"))
        worker = self.make_worker(send)
        self.api.recipients = self.api.recipients[:1]
        with self.assertLogs("hnx.mailer", "WARNING"):
            result = worker.run_round(self.stop)
        self.assertEqual(result["failed"], 0)  # chưa phải thất bại cuối
        first = self.api.marks[0]
        self.assertEqual((first["p_status"], first["p_error_code"], first["p_count_attempt"]), ("pending", "smtp_recipient_deferred", True))
        self.assertEqual((self.api.recipients[0]["status"], self.api.recipients[0]["attempts"]), ("pending", 1))
        # Hết thời gian lease thử lại; tới lần thứ 5 thì thành failed.
        for _ in range(4):
            self.api.recipients[0]["leased"] = False
            with self.assertLogs("hnx.mailer", "WARNING"):
                worker.run_round(self.stop)
        self.assertEqual((self.api.recipients[0]["status"], self.api.recipients[0]["attempts"]), ("failed", 5))
        self.assertEqual(self.api.recipients[0]["error_code"], "smtp_recipient_deferred")

    def test_unexpected_error_is_row_transient(self):
        send = FakeSend(error=RuntimeError("lỗi lạ"))
        worker = self.make_worker(send)
        with self.assertLogs("hnx.mailer", "WARNING"):
            worker.run_round(self.stop)
        self.assertTrue(all(m["p_status"] == "pending" and m["p_error_code"] == "unexpected_error" for m in self.api.marks))

    def test_bad_user_id_is_never_put_in_url(self):
        self.api.recipients[0]["user_id"] = "x,id.neq.0"
        with self.assertLogs("hnx.mailer", "ERROR"):
            self.worker.run_round(self.stop)
        self.assertFalse([c for c in self.http.calls if "neq" in c[1]])
        self.assertEqual(self.api.recipients[0]["error_code"], "invalid_user_id")

    def test_sent_but_not_recorded_is_retried_and_never_resent(self):
        fail_marks = {"on": True}
        original = self.api.mark

        def flaky(args):
            if fail_marks["on"]:
                return 503, {"message": "busy"}
            return original(args)

        self.http.rpc_handlers["mark_announcement_recipient"] = flaky
        with self.assertRaises(rm.SystemicError) as ctx, self.assertLogs("hnx.mailer", "ERROR"):
            self.worker.run_round(self.stop)
        self.assertEqual(ctx.exception.code, "supabase_write_failed")
        self.assertTrue(ctx.exception.sent)
        self.assertEqual(len(self.send.sent), 1)  # dừng ngay, không gửi tiếp khi không ghi được
        # Supabase hồi phục; lease của người 1 hết hạn nên bị giành lại, nhưng KHÔNG được gửi lần hai.
        fail_marks["on"] = False
        self.api.recipients[0]["leased"] = False
        result = self.worker.run_round(self.stop)
        self.assertEqual(self.api.recipients[0]["status"], "sent")
        self.assertEqual(self.to_addrs().count("user1@example.com"), 1)
        self.assertEqual(result["sent"], 3)
        self.assertEqual(len(self.send.sent), 4)


# --------------------------------------------------------------------------
# Hạn mức ngày
# --------------------------------------------------------------------------


class DailyLimitTests(WorkerCase):
    recipients = 5
    env = {"MAILER_DAILY_LIMIT": "10"}

    def test_quota_window_is_the_local_day(self):
        self.worker.run_round(self.stop)
        args = self.api.quota_args[0]
        # 24/11/2026 00:00 giờ Hà Nội (UTC+7) = 23/11 17:00 UTC, kéo dài đúng 24 giờ.
        self.assertEqual(args, {"p_from": "2026-11-23T17:00:00+00:00", "p_to": "2026-11-24T17:00:00+00:00"})

    def test_confirmation_mails_count_towards_the_limit(self):
        self.api.quota_extra = 8  # 8 thư xác nhận đã gửi hôm nay: còn 2 thư
        with self.assertLogs("hnx.mailer.announcements", "WARNING") as logs:
            result = self.worker.run_round(self.stop)
        self.assertEqual(result["sent"], 2)
        self.assertEqual(self.to_addrs(), ["user1@example.com", "user2@example.com"])
        self.assertTrue(any("hạn mức 10 thư/ngày" in line for line in logs.output))
        # Phần lease chưa dùng đã được nhả; không ai bị tính lần thử.
        self.assertEqual([r["attempts"] for r in self.api.recipients[2:]], [0, 0, 0])
        self.assertTrue(all(not r["leased"] for r in self.api.recipients[2:]))
        self.assertFalse(result["busy"])

    def test_limit_already_reached_sends_nothing_and_stays_stopped_until_tomorrow(self):
        self.api.quota_extra = 10
        with self.assertLogs("hnx.mailer.announcements", "WARNING"):
            self.worker.run_round(self.stop)
        self.assertEqual(self.send.sent, [])
        self.assertTrue(all(not r["leased"] and r["attempts"] == 0 for r in self.api.recipients))
        before = len(self.http.calls)
        self.now = NOW + timedelta(hours=10)  # 20:00 cùng ngày giờ Hà Nội
        self.worker.run_round(self.stop)
        self.assertEqual(len(self.http.calls), before)  # không gọi gì nữa, không tốn một RPC
        # Qua nửa đêm giờ Hà Nội (17:00 UTC): tiếp tục gửi.
        self.now = datetime(2026, 11, 24, 17, 0, 1, tzinfo=timezone.utc)
        self.api.quota_extra = 0
        result = self.worker.run_round(self.stop)
        self.assertEqual(result["sent"], 5)
        self.assertEqual(self.api.quota_args[-1]["p_from"], "2026-11-24T17:00:00+00:00")

    def test_hitting_the_limit_exactly_stops_the_day(self):
        self.api.quota_extra = 9
        with self.assertLogs("hnx.mailer.announcements", "WARNING"):
            result = self.worker.run_round(self.stop)
        self.assertEqual(result["sent"], 1)
        calls = len(self.http.calls)
        self.worker.run_round(self.stop)
        self.assertEqual(len(self.http.calls), calls)

    def test_test_mails_also_respect_the_limit(self):
        api = FakeAnnouncementApi(self.http, recipients=0, tests=True)
        api.quota_extra = 10
        with self.assertLogs("hnx.mailer.announcements", "WARNING"):
            self.worker.run_round(self.stop)
        self.assertEqual(self.send.sent, [])
        self.assertEqual(api.test_marks, [])

    def test_confirmations_are_sent_first_even_when_limit_is_reached(self):
        self.api.quota_extra = 10
        self.http.registrations = [reg()]
        mailer = rm.Mailer(self.cfg, self.db, self.send, now=lambda: NOW, out=self.output.append)
        mailer.announcements = self.worker
        with self.assertLogs("hnx.mailer.announcements", "WARNING"):
            stats = mailer.run_once(self.stop)
        self.assertEqual(stats["sent"], 1)  # thư xác nhận vẫn gửi
        self.assertEqual(stats["ann_sent"], 0)
        self.assertEqual(len(self.send.sent), 1)
        self.assertIn("Xác nhận đăng ký", self.send.sent[0]["Subject"])


# --------------------------------------------------------------------------
# Tích hợp với Mailer / CLI
# --------------------------------------------------------------------------


class MailerIntegrationTests(WorkerCase):
    recipients = 2

    def test_confirmation_mail_goes_before_announcements(self):
        self.http.registrations = [reg()]
        mailer = rm.Mailer(self.cfg, self.db, self.send, now=lambda: NOW, out=self.output.append)
        mailer.announcements = self.worker
        stats = mailer.run_once(self.stop)
        subjects = [m["Subject"] for m in self.send.sent]
        self.assertIn("Xác nhận đăng ký", subjects[0])
        self.assertEqual(subjects[1:], [SUBJECT, SUBJECT])
        self.assertEqual((stats["sent"], stats["ann_sent"], stats["ann_busy"], stats["systemic"]), (1, 2, 1, 0))

    def test_missing_migration_is_not_an_outage(self):
        self.http.rpc_handlers.clear()
        mailer = rm.Mailer(self.cfg, self.db, self.send, now=lambda: NOW, out=self.output.append)
        mailer.announcements = self.worker
        with self.assertLogs("hnx.mailer.announcements", "WARNING") as logs:
            stats = mailer.run_once(self.stop)
            mailer.run_once(self.stop)
        self.assertEqual(stats["systemic"], 0)
        self.assertEqual(len([l for l in logs.output if "20261124000000" in l]), 1)  # nhắc một lần, không spam

    def test_disabled_by_default_object(self):
        mailer = rm.Mailer(self.cfg, self.db, self.send, now=lambda: NOW, out=self.output.append)
        self.assertIsNone(mailer.announcements)
        mailer.run_once(self.stop)
        self.assertEqual(self.api.rpc_names(), [])


class CliAnnouncementTests(unittest.TestCase):
    def setUp(self):
        import tempfile

        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.lock_path = Path(self._tmp.name) / ".mailer.lock"

    def run_main(self, argv, env, http, stop=None, sender=None):
        sender = sender or FakeSend()
        code = rm.main(
            argv + ["--env-file", "/nonexistent/.env"],
            env,
            http=http,
            sender_factory=lambda cfg: sender,
            stop=stop or threading.Event(),
            lock_path=self.lock_path,
        )
        return code, sender

    def rpc_names(self, http):
        return [c[1].rsplit("/", 1)[1] for c in http.calls if "/rest/v1/rpc/" in c[1]]

    def test_once_processes_announcements_by_default(self):
        http = FakeHttp()
        api = FakeAnnouncementApi(http, recipients=2)
        code, sender = self.run_main(["--once"], dict(BASE_ENV, ANNOUNCE_PER_MINUTE="120"), http)
        self.assertEqual(code, 0)
        self.assertEqual(len(sender.sent), 2)
        self.assertEqual(api.status, "sent")

    def test_announcements_disabled_skips_everything(self):
        http = FakeHttp()
        FakeAnnouncementApi(http, recipients=2)
        with self.assertLogs("hnx.mailer", "INFO") as logs:
            code, sender = self.run_main(["--once"], dict(BASE_ENV, ANNOUNCEMENTS_ENABLED="false"), http)
        self.assertEqual(code, 0)
        self.assertEqual(sender.sent, [])
        self.assertEqual(self.rpc_names(http), [])
        self.assertTrue(any("ANNOUNCEMENTS_ENABLED=false" in line for line in logs.output))

    def test_announcements_disabled_still_sends_confirmations(self):
        http = FakeHttp()
        http.registrations = [reg()]
        code, sender = self.run_main(["--once"], dict(BASE_ENV, ANNOUNCEMENTS_ENABLED="false"), http)
        self.assertEqual((code, len(sender.sent)), (0, 1))

    def test_once_exit_code_1_on_announcement_smtp_failure(self):
        http = FakeHttp()
        FakeAnnouncementApi(http, recipients=1)
        sender = FakeSend(error=rm.SystemicError(f"SMTP {SMTP_PASSWORD}", "smtp_auth_failed"))
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr), self.assertLogs("hnx.mailer", "WARNING"):
            code, _ = self.run_main(["--once"], BASE_ENV, http, sender=sender)
        self.assertEqual(code, 1)
        self.assertIn("smtp_auth_failed", stderr.getvalue())
        self.assertNotIn(SMTP_PASSWORD, stderr.getvalue())

    def test_dry_run_prints_without_writing_or_sending(self):
        http = FakeHttp()
        api = FakeAnnouncementApi(http, recipients=8, tests=True)
        stdout = io.StringIO()
        with contextlib.redirect_stdout(stdout):
            code, sender = self.run_main(["--dry-run"], BASE_ENV, http)
        out = stdout.getvalue()
        self.assertEqual(code, 0)
        self.assertEqual(sender.sent, [])
        self.assertEqual(sorted(set(self.rpc_names(http))), ["claim_announcement_tests", "preview_announcement_recipients"])
        self.assertEqual(api.marks, [])
        self.assertEqual(api.claims, [])
        self.assertTrue(all(not r["leased"] and r["status"] == "pending" for r in api.recipients))
        self.assertEqual(http.patches(), [])
        self.assertIn("To: admin@example.com", out)
        self.assertIn("Subject: [THỬ] " + SUBJECT, out)
        self.assertEqual(out.count("Subject: " + SUBJECT), ann.PREVIEW_LIMIT)  # chỉ 5 người đầu, không phải cả 8
        self.assertIn("Chào Người Số 1,", out)
        self.assertNotIn("Chào Người Số 6,", out)

    def test_dry_run_without_pending_work(self):
        http = FakeHttp()
        FakeAnnouncementApi(http, recipients=0)
        stdout = io.StringIO()
        with contextlib.redirect_stdout(stdout):
            code, _ = self.run_main(["--dry-run"], BASE_ENV, http)
        self.assertEqual(code, 0)
        self.assertIn("không có thư thông báo", stdout.getvalue())

    def test_loop_comes_back_quickly_while_announcements_are_in_flight(self):
        http = FakeHttp()
        FakeAnnouncementApi(http, recipients=3)
        stop = FakeStop(rounds=5)
        code, sender = self.run_main([], dict(BASE_ENV, POLL_SECONDS="30", ANNOUNCE_PER_MINUTE="120"), http, stop=stop)
        self.assertEqual(code, 0)
        self.assertEqual(len(sender.sent), 3)
        pacing = [w for w in stop.waits if w < 1.0]  # khoảng nghỉ giữa các thư (0,5 giây ở 120 thư/phút)
        self.assertEqual(len(pacing), 2)
        # Còn việc: quay lại sau 1 giây; hết việc: về chu kỳ thường 30 giây.
        self.assertEqual([w for w in stop.waits if w >= 1.0], [1.0, 30, 30])

    def test_demo_announcement_needs_no_config(self):
        import tempfile

        stdout = io.StringIO()
        with tempfile.TemporaryDirectory() as tmp, contextlib.redirect_stdout(stdout):
            target = Path(tmp) / "ann.html"
            self.assertEqual(rm.main(["--demo-announcement", "--html-out", str(target)], {}), 0)
            html_text = target.read_text(encoding="utf-8")
        out = stdout.getvalue()
        self.assertIn("Chào Nguyễn Văn An,", out)
        self.assertIn("Subject: " + ann.DEMO_ANNOUNCEMENT["subject"], out)
        self.assertIn("[THỬ]", out)
        self.assertIn("<a href=\"https://hanoixanh.example.com/", html_text)

    def test_demo_announcement_runs_as_a_script(self):
        proc = subprocess.run(
            [sys.executable, str(HERE / "registration_mailer.py"), "--demo-announcement"],
            capture_output=True, text=True, timeout=60, cwd="/",
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("Chào Nguyễn Văn An,", proc.stdout)


# --------------------------------------------------------------------------
# Hợp đồng SQL (kiểm tra tĩnh, không có Postgres)
# --------------------------------------------------------------------------


class MigrationContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = MIGRATION.read_text(encoding="utf-8")
        cls.code = "\n".join(line for line in cls.sql.splitlines() if not line.lstrip().startswith("--"))

    def test_every_public_function_is_service_role_only(self):
        created = re.findall(r"create or replace function public\.(\w+)\(", self.code)
        self.assertTrue(created)
        helpers = {
            "announcement_max_recipients", "announcement_is_admin", "announcement_owns_thread", "announcement_registrant_count",
            "announcement_short_name", "announcement_refresh_progress", "announcement_to_json",
        }
        for name in created:
            with self.subTest(function=name):
                self.assertRegex(self.code, rf"revoke all on function public\.{name}\([^)]*\) from public, anon, authenticated;")
                if name not in helpers:
                    self.assertRegex(self.code, rf"grant execute on function public\.{name}\([^)]*\) to service_role;")
        for name in created:
            self.assertNotRegex(self.code, rf"grant execute on function public\.{name}\([^)]*\) to (anon|authenticated|public)")

    def test_security_definer_functions_pin_search_path(self):
        for match in re.finditer(r"create or replace function public\.(\w+)\((.*?)\n\$\$;", self.code, re.S):
            header = match.group(0).split("as $$", 1)[0]
            if "security definer" in header:
                with self.subTest(function=match.group(1)):
                    self.assertIn("set search_path = public", header)

    def test_no_function_returns_an_email_address(self):
        self.assertNotRegex(self.code, r"(?i)\bemail\b")
        self.assertNotIn("auth.users", self.code)

    def test_rls_enabled_and_select_only_for_admins(self):
        for table in ("campaign_announcements", "campaign_announcement_versions", "campaign_announcement_recipients"):
            self.assertIn(f"alter table public.{table} enable row level security;", self.code)
            self.assertRegex(self.code, rf"create policy \w+ on public\.{table}\s+for select to authenticated using \(public\.is_admin\(\)\);")
            self.assertRegex(self.code, rf"grant select on public\.{table} to authenticated;")
        self.assertNotRegex(self.code, r"create policy[^;]*for (insert|update|delete|all)")

    def test_double_send_is_blocked_by_unique_constraint(self):
        self.assertRegex(self.code, r"unique \(announcement_id, user_id\)")
        self.assertIn("on conflict (announcement_id, user_id) do nothing", self.code)

    def test_admin_is_verified_in_every_agent_rpc(self):
        for name in ("upsert_announcement_draft", "request_announcement_test", "approve_announcement", "cancel_announcement"):
            body = re.search(rf"create or replace function public\.{name}\(.*?\n\$\$;", self.code, re.S).group(0)
            with self.subTest(function=name):
                self.assertIn("public.announcement_is_admin(p_admin_id)", body)
                self.assertIn("public.announcement_owns_thread(p_thread_id, p_admin_id)", body)

    def function_body(self, name):
        return re.search(rf"create or replace function public\.{name}\(.*?\n\$\$;", self.code, re.S).group(0)

    def test_begin_send_checks_state_and_locks_announcement_before_recipient(self):
        body = self.function_body("begin_announcement_send")
        for reason in ("cancelled", "not_pending", "lease_lost", "announcement_not_active"):
            self.assertIn(f"'{reason}'", body)
        # Cùng thứ tự khóa với cancel_announcement (thông báo trước, người nhận sau) để không deadlock.
        locks = [m.start() for m in re.finditer(r"for update", body)]
        self.assertEqual(len(locks), 2)
        self.assertIn("public.campaign_announcements\n", body[: locks[0]].rsplit("select", 1)[1])
        self.assertIn("public.campaign_announcement_recipients\n", body[locks[0] : locks[1]].rsplit("select", 1)[1])
        self.assertRegex(self.code, r"grant execute on function public\.begin_announcement_send\(uuid, integer\) to service_role;")

    def test_approve_takes_the_turn_start_from_the_database_clock(self):
        body = self.function_body("approve_announcement")
        self.assertRegex(body, r"agent_messages[^;]*role = 'user'")
        self.assertIn("p_turn_started_at", body)  # vẫn giữ tham số làm dự phòng
        self.assertIn("needs_admin_review", body)

    def test_mailer_rpc_names_exist_in_migration(self):
        used = set(re.findall(r'"((?:begin|claim|mark|preview|release|mail)_[a-z_]+)"', (HERE / "announcements.py").read_text(encoding="utf-8")))
        self.assertTrue(used)
        for name in used:
            with self.subTest(rpc=name):
                self.assertRegex(self.code, rf"create or replace function public\.{name}\(")


if __name__ == "__main__":
    unittest.main()
