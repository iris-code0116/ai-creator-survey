"""Run with Python Playwright and Chromium: python -m unittest discover -s _tests -v.
Set CHROMIUM_PATH when Chromium is installed in a nonstandard location.
The review server uses the deployed project path. External traffic is intercepted.
"""
import os
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from shutil import which
from threading import Thread
import unittest
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
PREFIX = "/ai-creator-survey/"
DRAFT = "ai-creator-survey:v4:draft"


class StaticSite(SimpleHTTPRequestHandler):
    def do_GET(self):
        if not self.path.startswith(PREFIX):
            return self.send_error(404)
        self.path = "/" + self.path[len(PREFIX):]
        super().do_GET()

    def log_message(self, *_):
        pass


class SurveyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), partial(StaticSite, directory=ROOT))
        Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.url = f"http://127.0.0.1:{cls.server.server_port}{PREFIX}"
        cls.engine = sync_playwright().start()
        cls.browser = cls.engine.chromium.launch(executable_path=os.getenv("CHROMIUM_PATH") or which("chromium"))

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.engine.stop()
        cls.server.shutdown()
        cls.server.server_close()

    def setUp(self):
        self.context = self.browser.new_context(viewport={"width": 390, "height": 844}, reduced_motion="reduce")
        self.page = self.context.new_page()
        self.errors, self.posts, self.unexpected = [], [], []
        self.response = (200, '{"success":"true"}')
        self.page.on("pageerror", lambda err: self.errors.append(str(err)))
        self.context.route("**/*", self.route)
        self.page.goto(self.url)

    def tearDown(self):
        self.context.close()
        self.assertEqual(self.unexpected, [])
        self.assertEqual(self.errors, [])

    def route(self, route):
        req = route.request
        host = urlsplit(req.url).hostname
        if host == "127.0.0.1":
            return route.continue_()
        if host != "formsubmit.co" or req.method != "POST":
            self.unexpected.append((host, req.method))
            return route.abort()
        self.posts.append(req.post_data_json)
        if self.response is None:
            return route.abort()
        status, body = self.response
        route.fulfill(status=status, content_type="application/json", body=body)

    def next(self):
        self.page.locator("#nextBtn").click()

    def draft(self):
        return self.page.evaluate("(k) => JSON.parse(sessionStorage.getItem(k))", DRAFT)

    def start(self):
        p = self.page
        p.locator('label.check').click()
        p.locator('[data-group="ageRange"] button').first.click()
        for key in ["p01", "p02", "p03", "p04"]:
            p.locator(f'[data-key="{key}"]').fill("测试 " + key)

    def ready(self):
        self.start()
        self.next()
        self.page.locator('[data-key="p05"]').fill("测试 p05")
        self.next()
        expect(self.page.locator("#s3")).to_be_visible()
        self.assertEqual(self.posts, [])

    def test_consent_storage_and_refresh(self):
        p = self.page
        p.locator('[data-key="p01"]').fill("临时输入")
        self.next()
        expect(p.locator("#err-consent")).to_be_visible()
        self.assertIsNone(self.draft())
        self.assertEqual(p.evaluate("localStorage.length"), 0)
        p.reload()
        expect(p.locator('[data-key="p01"]')).to_have_value("")
        self.start()
        self.next()
        p.reload()
        expect(p.locator("#s2")).to_be_visible()
        p.locator("#backBtn").click()
        expect(p.locator('[data-key="p01"]')).to_have_value("测试 p01")
        p.locator('label.check').click()
        self.assertIsNone(self.draft())
        self.assertEqual(self.posts, [])

    def test_storage_unavailable(self):
        self.page.add_init_script("Storage.prototype.setItem = Storage.prototype.getItem = Storage.prototype.removeItem = () => { throw Error('blocked'); }")
        self.page.reload()
        self.ready()
        self.next()
        expect(self.page.locator("#seal")).to_be_visible()
        expect(self.page.locator("#seal")).to_have_text("已提交")

    def test_legacy_cleanup_and_expiry(self):
        p = self.page
        p.evaluate("""() => {
          localStorage.setItem('aics_submitted', 'damaged');
          localStorage.setItem('aics_survey_v3_draft', '{"state":{"p01":"old"}}');
          localStorage.setItem('unrelated', 'leave alone');
        }""")
        p.reload()
        self.assertEqual(p.evaluate("Object.keys(localStorage)"), ["unrelated"])
        self.start()
        p.evaluate("(k) => { const d = JSON.parse(sessionStorage[k]); d.expires = Date.now()-1; sessionStorage[k]=JSON.stringify(d); }", DRAFT)
        p.reload()
        self.assertIsNone(self.draft())
        expect(p.locator('[data-key="p01"]')).to_have_value("")
        self.start()
        p.clock.install()
        p.locator('[data-key="p01"]').fill("触发新的计时器")
        p.clock.fast_forward(30 * 60 * 1000 + 10)
        self.assertIsNone(self.draft())

    def test_confirmation_once_download_and_optional_answers(self):
        p = self.page
        self.ready()
        p.locator('[data-key="c01"]').fill("测试 c01")
        p.evaluate("() => { const b=document.querySelector('#nextBtn'); b.click(); b.click(); }")
        expect(p.locator("#seal")).to_be_visible()
        expect(p.locator("#seal")).to_have_text("已提交")
        self.assertEqual(len(self.posts), 1)
        payload = self.posts[0]
        self.assertEqual(payload["c01"], "测试 c01")
        self.assertEqual(payload["c03"], "")
        self.assertNotIn("_captcha", payload)
        self.assertEqual(payload["ageRange"], "5-7 岁")
        self.assertIsNone(self.draft())
        self.assertEqual(p.evaluate("localStorage.length"), 0)
        with p.expect_download() as download:
            p.locator("#dlBtn2").click()
        self.assertIn(payload["id"], download.value.suggested_filename)
        self.assertIn("测试 c01", download.value.path().read_text())
        p.reload()
        expect(p.locator("#consent")).not_to_be_checked()
        expect(p.locator('[data-key="p01"]')).to_have_value("")

    def test_unconfirmed_receipts(self):
        for response in [(200, '{}'), (200, '{"success":"false"}'), (200, 'challenge'), (503, '{}'), None]:
            with self.subTest(response=response):
                self.response = response
                self.ready()
                self.next()
                expect(self.page.locator("#seal")).to_have_text("未发送")
                expect(self.page.locator("#stepLabel")).to_have_text("未发送")
                expect(self.page.locator("#copyBtn")).to_be_visible()
                expect(self.page.locator("#transcript")).to_contain_text("测试 p01")
                self.assertIsNone(self.draft())
                self.page.reload()
                self.posts.clear()

    def test_timeout_falls_back_without_retry(self):
        self.ready()
        p = self.page
        pending = []
        p.route("https://formsubmit.co/**", lambda route: pending.append(route))
        p.clock.install()
        with p.expect_request("https://formsubmit.co/**"):
            self.next()
        p.clock.fast_forward(15001)
        expect(p.locator("#seal")).to_have_text("未发送")
        expect(p.locator("#copyBtn")).to_be_visible()
        self.assertEqual(len(pending), 1)
        pending[0].abort()
        self.assertIsNone(self.draft())

    def test_external_connections_blocked(self):
        error = self.page.evaluate("""async () => {
            try { await fetch('https://example.invalid/sample'); }
            catch(e) { return e.name; }
        }""")
        self.assertEqual(error, "TypeError")

    def test_honeypot(self):
        self.ready()
        self.page.locator('[name="_honey"]').evaluate("el => el.value = 'filled'")
        self.next()
        expect(self.page.locator("#seal")).to_have_text("未发送")
        self.assertEqual(self.posts, [])

    def test_static_policy_blocks_inline_script(self):
        self.page.evaluate("""() => {
          const script=document.createElement('script'); script.textContent='window.unexpectedRun=true';
          document.head.append(script);
        }""")
        self.assertFalse(self.page.evaluate("Boolean(window.unexpectedRun)"))

    def test_invalid_age(self):
        self.start()
        self.page.locator("#age").fill("19")
        self.next()
        expect(self.page.locator("#err-age")).to_be_visible()
        self.page.locator("#age").fill("9")
        self.next()
        expect(self.page.locator("#s2")).to_be_visible()


if __name__ == "__main__":
    unittest.main()
