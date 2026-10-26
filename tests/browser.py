"""Проверка на потребителските потоци в отделно копие на сайта."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import urllib.request
import urllib.error

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = Path(os.environ.get("TP24_TEST_RUNTIME", "/workspace/.tradepulse24-env"))


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


with tempfile.TemporaryDirectory(prefix="tp24-browser-") as folder:
    temporary = Path(folder)
    site = temporary / "site"
    shutil.copytree(ROOT, site, ignore=shutil.ignore_patterns(".git", "*.log", "config.php", "config.local.php", "workspace.json", "ai-cache.json", "*.lock"))
    shutil.copyfile(site / "api/config.example.php", site / "api/config.php")
    (site / "data/news.json").write_text(json.dumps({"events": [{"id": "browser-boc", "title": "BOC Monetary Policy Report", "currency": "CAD", "impact": "high", "time": int(time.time()) + 3600, "forecast": "", "previous": "", "actual": None, "source": "Тестов календар"}], "updated": int(time.time())}))
    config = (RUNTIME / "httpd.conf").read_text()
    config = config.replace("127.0.0.1:8080", "127.0.0.1:8081").replace(str(ROOT), str(site))
    config = config.replace(str(RUNTIME / "run/httpd.pid"), str(temporary / "httpd.pid"))
    config = config.replace(str(RUNTIME / "logs/apache-error.log"), str(temporary / "apache-error.log"))
    (temporary / "httpd.conf").write_text(config)
    process_env = os.environ.copy()
    process_env.update({"TP24_ADMIN_PASSWORD": "local-browser-test-only", "LD_LIBRARY_PATH": str(RUNTIME / "runtime/usr/lib/x86_64-linux-gnu"), "PHP_INI_SCAN_DIR": ""})
    process_env.pop("GEMINI_API_KEY", None)
    process = subprocess.Popen([str(RUNTIME / "runtime/usr/sbin/apache2"), "-f", str(temporary / "httpd.conf"), "-DFOREGROUND"], env=process_env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, start_new_session=True)
    base = "http://127.0.0.1:8081"

    def request(path, data=None):
        try:
            with urllib.request.urlopen(urllib.request.Request(base + path, data=data, headers={"Content-Type": "application/json"}), timeout=10) as response:
                return response.status, response.read()
        except urllib.error.HTTPError as response:
            return response.code, response.read()

    try:
        for attempt in range(30):
            try:
                assert request("/")[0] == 200
                break
            except OSError:
                if process.poll() is not None:
                    raise RuntimeError(process.stderr.read().decode())
                time.sleep(0.1)
        original_results = digest(site / "data/results.json")
        original_custom = digest(site / "data/custom.json")
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path="/usr/bin/chromium", headless=True, args=["--no-sandbox"])
            page = browser.new_page(viewport={"width": 1440, "height": 1000})
            errors, ai_requests = [], []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.on("request", lambda request: ai_requests.append(request.url) if "/api/news-ai.php" in request.url or "/api/risk-ai.php" in request.url else None)
            for route in ["", "strategies", "watch", "news", "settings", "help", "risk", "lab", "workshop"]:
                page.goto(base + "/#/" + route, wait_until="networkidle")
                page.wait_for_function("S.data?.ready")
                assert len(page.locator("#main").inner_text()) > 30, route
                assert not errors, (route, errors)
            assert page.locator("[data-trading-style]").count() == 2
            page.goto(base + "/#/workshop", wait_until="networkidle")
            page.locator("#lab-pass").fill("local-browser-test-only")
            page.get_by_role("button", name="Влез", exact=True).click()
            page.wait_for_function("LAB.authed")
            page.locator('a[href="#/workshop/new"]').click()
            page.locator('[data-f="name"]').fill("Дневна проверка")
            page.get_by_role("button", name="Запази стратегията", exact=True).click()
            page.wait_for_function("LAB.custom.length === 1 && location.hash === '#/workshop'")
            page.locator('summary').filter(has_text="Пулс · проверка на Gemini").click()
            page.locator('[data-lab="gemini-check"]').click()
            page.wait_for_function("!LAB.geminiChecking && LAB.geminiCheck?.code === 'not_configured'")
            assert "not_configured" in page.locator("#main").inner_text()
            key = page.evaluate("LAB.custom[0].key")
            variant = key + "-H1"
            assert digest(site / "data/results.json") == original_results
            assert digest(site / "data/custom.json") == original_custom
            assert request("/data/private/workspace.json")[0] == 403
            assert request("/api/workspace.php")[0] == 403
            page.get_by_role("button", name="Зареди историята", exact=True).click()
            page.wait_for_function("!!LAB.loaded", timeout=60000)
            page.locator('[data-lab="run"]').click()
            page.wait_for_function("(id) => !LAB.running && !!LAB.results[id]", arg=variant, timeout=60000)
            assert not page.evaluate("(id) => LAB.published.has(id)", variant)
            page.locator('[data-lab="save"]').click()
            page.wait_for_function("!LAB.saving && !LAB.dirty")
            assert digest(site / "data/results.json") == original_results
            page.goto(base + "/#/workshop/edit/" + key, wait_until="networkidle")
            page.locator('[data-f="stop.mult"]').fill("2")
            page.locator('[data-f="stop.mult"]').dispatch_event("change")
            page.get_by_role("button", name="Запази стратегията", exact=True).click()
            page.wait_for_function("LAB.custom[0].version === 2")
            assert page.evaluate("(id) => !LAB.results[id]", variant)
            assert page.evaluate("LAB.history[0].strategy.version") == 1
            assert not page.evaluate("(key) => !!S.catalog[key]", key)
            page.locator('[data-lab="run"]').click()
            page.wait_for_function("(id) => !LAB.running && LAB.results[id]?.version === 2", arg=variant, timeout=60000)
            page.locator(f'[data-lab-pub="{variant}"]').check()
            page.locator('[data-lab="publish"]').click()
            page.wait_for_function("(key) => !LAB.saving && S.catalog[key]?.spec.version === 2", arg=key)
            published = digest(site / "data/custom.json")
            page.goto(base + "/#/workshop/edit/" + key, wait_until="networkidle")
            page.locator('[data-f="stop.mult"]').fill("2.5")
            page.locator('[data-f="stop.mult"]').dispatch_event("change")
            page.get_by_role("button", name="Запази стратегията", exact=True).click()
            page.wait_for_function("LAB.custom[0].version === 3")
            assert page.evaluate("(key) => S.catalog[key].spec.version", key) == 2
            assert digest(site / "data/custom.json") == published
            print("OK: authenticated draft, real worker test, private save, version history, explicit publishing and published-rule isolation")

            page.goto(base + "/#/risk", wait_until="networkidle")
            page.locator('#journal-form [name="risk"]').fill("10")
            page.locator('#journal-form [name="net"]').fill("-10")
            page.get_by_role("button", name="Запази сделката", exact=True).click()
            page.wait_for_function("JOURNAL.trades.length === 1")
            page.reload(wait_until="networkidle")
            assert page.evaluate("JOURNAL.trades.length") == 1
            assert page.evaluate("RiskJournal.stats(journalTrades()).daily") == 0.5
            page.locator('[data-trading-style="swing"]').click()
            page.goto(base + "/#/workshop/new", wait_until="networkidle")
            assert page.evaluate("LAB.form.tfs[0]") == "H4"
            assert page.locator('[data-f-tf="H1"]').count() == 0
            page.goto(base + "/#/risk", wait_until="networkidle")
            assert page.evaluate("RiskJournal.stats(journalTrades()).daily") == 0.5
            page.evaluate("""() => { const t=Date.now()/1000; saveJournal(Array.from({length:10},(_,i)=>({id:'r'+i,pair:'EURUSD',style:'day',currency:'USD',dir:1,status:'closed',risk:10,risk_pct:.5,net:i%2?20:-10,opened:t-6000-i*100,closed:t-100-i*100,tag:'plan',note:'Лична бележка'}))); render(); }""")
            assert not ai_requests
            page.locator('[data-risk-ai]').click()
            page.wait_for_function("!JOURNAL.busy && !!JOURNAL.error")
            assert "не е настроен" in page.locator("#main").inner_text()

            page.goto(base + "/#/news", wait_until="networkidle")
            event_id = page.evaluate("S.data.news.find(e => e.title.includes('BOC Monetary Policy Report'))?.id || S.data.news[0]?.id")
            assert event_id, "Calendar cache is needed for the news flow"
            page.goto(base + "/#/analysis/" + event_id, wait_until="networkidle")
            assert len(ai_requests) == 1
            page.locator('[data-ai-run]').click()
            page.wait_for_function("!NEWS_AI.busy && !!NEWS_AI.error")
            assert "не е настроен" in page.locator("#main").inner_text()

            page.evaluate("""() => { S.data.signals.push({id:'browser-H4-USDCAD-1',strategy:'lib_golden_cross-H4',strategy_name:'Тестов сигнал',pair:'USDCAD',pair_name:'USD/CAD',tf:'H4',style:'swing',status:'pending',signal_time:Date.now()/1000-60,orders:[{dir:1,type:'stop',entry:1.4,stop:1.39,targets:[{w:1,level:1.42}]}]}); }""")
            page.goto(base + "/#/analysis/" + event_id + "/browser-H4-USDCAD-1", wait_until="networkidle")

            def provider_fixture(route):
                body = json.loads(route.request.post_data)
                assert set(body) == {"event_id", "signal"}
                assert body["signal"]["pair"] == "USDCAD"
                assert not {"balance", "password", "note", "risk"}.intersection(body["signal"])
                route.fulfill(status=200, content_type="application/json", body=json.dumps({"ok": True, "generated_at": int(time.time()), "source": "Тестов отговор", "cached": False,
                    "analysis": {"summary": '<img src=x onerror="window.bad=true">', "relevance": "Условен сценарий.", "status": "caution", "scenarios": ["Пример"], "considerations": ["Провери данните"], "limitations": ["Тест"]}}))

            page.route("**/api/news-ai.php", provider_fixture)
            page.locator('[data-ai-run]').click()
            page.wait_for_function("!NEWS_AI.busy && NEWS_AI.results.size > 0")
            assert page.locator('#main img[src="x"]').count() == 0
            assert not page.evaluate("!!window.bad")
            assert not errors, errors
            page.goto(base + "/#/risk", wait_until="networkidle")
            page.set_viewport_size({"width": 390, "height": 844})
            assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), "Mobile layout overflows"
            page.screenshot(path="/tmp/tradepulse24-risk-mobile.png", full_page=True)
            broken = browser.new_page()
            broken.route("**/assets/js/fx-core.js*", lambda route: route.abort())
            broken.goto(base + "/#/", wait_until="networkidle")
            broken.locator(".startup-error").wait_for()
            assert "script_missing" in broken.locator(".startup-error").inner_text()
            assert "fx-core.js" in broken.locator(".startup-error").inner_text()
            broken.close()
            bad_data = browser.new_page()
            bad_data.route("**/data/meta.json*", lambda route: route.fulfill(status=200, content_type="application/json", body=json.dumps({"prices_updated":int(time.time()),"quotes":{"EURUSD":{"price":1.1,"time":int(time.time())}}})))
            bad_data.route("**/data/recent.json*", lambda route: route.fulfill(status=200, content_type="application/json", body='{"prices":null}'))
            bad_data.goto(base + "/#/", wait_until="networkidle")
            bad_data.locator(".startup-error").wait_for()
            assert "data_or_script_error" in bad_data.locator(".startup-error").inner_text()
            bad_data.close()
            browser.close()
            print("OK: missing scripts and invalid recent data show a diagnostic instead of a permanent loading screen")
            print("OK: journal persistence, style selection, portfolio totals, optional AI, missing-key fallback, escaped output and mobile layout")
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
