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
    shutil.copytree(ROOT, site, ignore=shutil.ignore_patterns(".git", "*.log", "config.php", "config.local.php", "workspace.json", "*-cache.json", "*.lock"))
    shutil.copyfile(site / "api/config.example.php", site / "api/config.php")
    (site / "data/news.json").write_text(json.dumps({"events": [{"id": "browser-boc", "title": "BOC Monetary Policy Report", "currency": "CAD", "impact": "high", "time": int(time.time()) + 3600, "forecast": "", "previous": "", "actual": None, "source": "Тестов календар"}], "updated": int(time.time())}))
    config = (RUNTIME / "httpd.conf").read_text()
    config = config.replace("127.0.0.1:8080", "127.0.0.1:8081").replace(str(ROOT), str(site))
    config = config.replace(str(RUNTIME / "run/httpd.pid"), str(temporary / "httpd.pid"))
    config = config.replace(str(RUNTIME / "logs/apache-error.log"), str(temporary / "apache-error.log"))
    (temporary / "httpd.conf").write_text(config)
    process_env = os.environ.copy()
    process_env.update({"TP24_ADMIN_PASSWORD": "local-browser-test-only", "LD_LIBRARY_PATH": str(RUNTIME / "runtime/usr/lib/x86_64-linux-gnu"), "PHP_INI_SCAN_DIR": ""})
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
            errors, requests = [], []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.on("request", lambda request: requests.append(request))
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
            page.locator('summary').filter(has_text="Пулс · проверка на Groq").click()
            page.locator('[data-puls-check]').click()
            page.wait_for_function("!LAB.pulsChecking && LAB.pulsCheck?.code === 'not_configured'")
            assert page.evaluate("FX.BOOK_CANDIDATES.length") == 7
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

            public_before_revision = digest(site / "data/results.json")
            page.goto(base + "/#/lab", wait_until="networkidle")
            page.locator('[data-lab-filter="revised"]').click()
            assert page.locator('[data-lab-sel]').count() == 9
            page.locator('[data-trading-style="swing"]').click()
            assert page.locator('[data-lab-sel]').count() == 22
            page.locator('[data-lab="select-none"]').click()
            revised = "rev_book_role_reversal-H4"
            page.locator(f'[data-lab-sel="{revised}"]').check()
            page.locator('[data-lab="run"]').click()
            page.wait_for_function('(id) => !LAB.running && !!LAB.results[id]?.comparison', arg=revised, timeout=90000)
            page.wait_for_function('document.querySelector(\'[data-lab="run"]\')?.disabled === false')
            assert page.evaluate('(id) => LAB.results[id].version', revised) == 2
            assert not page.evaluate('(id) => LAB.published.has(id)', revised)
            assert page.evaluate('(id) => LAB.results[id].per_pair.every(p => p.review && p.assessment)', revised)
            row = page.locator(f'tr:has([data-lab-sel="{revised}"])')
            row.locator('summary').filter(has_text="Какво променихме и сравнение").click()
            assert "Оригинал:" in row.inner_text() and "двоен моделен разход" in row.inner_text()
            page.locator('[data-lab="save"]').click()
            page.wait_for_function('!LAB.saving && !LAB.dirty')
            assert digest(site / "data/results.json") == public_before_revision
            page.locator('[data-trading-style="day"]').click()
            print("OK: scoped revision filters, real revised worker comparison, pair reviews and private save without automatic publishing")

            journal_request_start = len(requests)
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
            page.goto(base + "/#/news", wait_until="networkidle")
            assert "Защо следим новините" in page.locator("#main").inner_text()
            assert "Избери дата" in page.locator("#main").inner_text()
            assert "Europe/Sofia" in page.locator("#main").inner_text()
            if not page.locator('[data-news-event="browser-boc"]').count():
                page.locator('[data-news-next]').first.click()
            assert "Банката на Канада" in page.locator("#main").inner_text()
            assert page.locator('a[href^="#/analysis"]').count() >= 1
            page.evaluate("""() => {
              const t=Date.now()/1000, title='Calendar elapsed fixture';
              S.data.news.push({id:'elapsed-fixture',title,title_bg:title,currency:'USD',impact:'high',time:t-60,actual:null,explain:'Статично обяснение.'});
              S.data.news.push({id:'zero-fixture',title:'Calendar zero fixture',title_bg:'Calendar zero fixture',currency:'CAD',impact:'medium',time:t-90,actual:0});
              S.data.news.push({id:'tomorrow-fixture',title:'Tomorrow fixture',title_bg:'Tomorrow fixture',currency:'USD',impact:'high',time:t+86400});
              S.newsDay='today';S.newsShowPast=false;render();
            }""")
            assert not page.locator('[data-news-event="elapsed-fixture"]').count()
            page.locator('[data-newspast]').click()
            past_day = page.evaluate('FX.calendar.dayKey(Date.now()/1000-60)')
            if not page.locator('[data-news-event="elapsed-fixture"]').count():
                page.locator(f'[data-newsday="{past_day}"]').click()
            assert 'няма резултат в източника' in page.locator('[data-news-event="elapsed-fixture"]').inner_text()
            assert 'Обявено: 0' in page.locator('[data-news-event="zero-fixture"]').inner_text()
            page.locator('[data-newspast]').click()
            assert not page.locator('[data-news-event="elapsed-fixture"]').count()
            tomorrow = page.evaluate('FX.calendar.dayKey(Date.now()/1000+86400)')
            page.locator(f'[data-newsday="{tomorrow}"]').click()
            assert page.locator('[data-news-event="tomorrow-fixture"]').count() == 1
            assert 'Утре' in page.locator('.news-date-heading').inner_text()
            page.evaluate("S.data.news=S.data.news.filter(e=>!e.id.endsWith('-fixture'));S.newsDay='today';S.newsShowPast=false;render();")
            if not page.locator('[data-news-event="browser-boc"]').count():
                page.locator('[data-news-next]').first.click()
            print("OK: today/date navigation, hidden past events, explicit unknown result, reported zero and tomorrow selection")

            assert all(r.url.startswith(base + "/") or r.url.startswith("blob:") for r in requests)
            for sent in [r for r in requests[journal_request_start:] if r.method == "POST"]:
                assert sent.url.startswith(base + "/api/save.php"), "Journal records stay in the browser"
                payload = json.loads(sent.post_data)
                assert payload["action"] in ["workspace", "check"]
                assert not {"trades", "balance", "note", "net", "risk_pct"}.intersection(payload)
            assert request("/api/puls.php")[0] == 200
            assert request("/api/puls.php", b'{"action":"check"}')[0] == 403
            assert request("/api/save.php")[0] == 405
            assert request("/api/cron.php")[0] == 403
            for protected in ["config.php", "config.local.php", "config.example.php", "lib.php", "workspace.php", "puls-lib.php"]:
                assert request("/api/" + protected)[0] == 403, protected
            # При обновяване с копиране стари файлове могат да останат на хостинга.
            for retired in ["news-ai.php", "risk-ai.php", "gemini-check.php"]:
                (site / "api" / retired).write_text("<?php echo 'obsolete-code-ran';")
                code, body = request("/api/" + retired)
                assert code == 403 and b"obsolete-code-ran" not in body, retired
            page.locator('a[href^="#/analysis/"]').first.click()
            page.locator('#puls-question').fill("Какво да следя?")
            page.get_by_role("button", name="Попитай Пулс", exact=True).click()
            page.wait_for_function("!pulsPage(S.route.id).chat.busy && !!pulsPage(S.route.id).chat.error")
            assert "not_configured" in page.locator('#main').inner_text()
            page.evaluate("""() => { S.settings.smartPairs=false; S.data.signals.push({id:'two-orders',strategy:'lib_golden_cross-H4',strategy_name:'Проверка на посоката',pair:'USDCAD',tf:'H4',style:'swing',status:'pending',orders:[{dir:1,entry:1.4,stop:1.39},{dir:-1,entry:1.39,stop:1.4}]}); render(); }""")
            assert page.locator('#puls-signal option[value="two-orders~1"]').count() == 1
            assert page.locator('#puls-signal option[value="two-orders~-1"]').count() == 1
            page.locator('#puls-signal').select_option('two-orders~-1')
            day = page.evaluate('pulsToday()')
            overview_response = {"ok": True, "kind": "overview", "day": day, "generated_at": int(time.time()), "data_updated": int(time.time()) - 1800, "model": "test-fixture", "content": {
                "summary": "Дневен обзор за проверка.", "focus": ["Следим календара."], "day": ["Провери спреда около събитието."], "swing": ["Прегледай отворените позиции."], "unknowns": ["Няма текст на доклада."]}, "sources": [
                    {"name": "Тестов календар", "url": "https://nfs.faireconomy.media/ff_calendar_thisweek.json", "updated": int(time.time()) - 1800},
                    {"name": "Тестови котировки", "url": "https://twelvedata.com/", "updated": int(time.time()) - 900}]}
            counters = {"chat": 0, "overview": 0}

            def assistant_fixture(route):
                if route.request.method == "GET":
                    route.fulfill(status=200, content_type="application/json", body=json.dumps({"ok": True, "configured": True, "day": day, "needs_refresh": counters["overview"] == 0, "overview": overview_response if counters["overview"] else None}))
                    return
                body = json.loads(route.request.post_data)
                assert not {"balance", "password", "note", "trades"}.intersection(body)
                if body["action"] == "overview":
                    assert set(body) == {"action"}
                    counters["overview"] += 1
                    route.fulfill(status=200, content_type="application/json", body=json.dumps(overview_response))
                    return
                assert body["action"] == "chat" and body["signal"]["dir"] == -1 and body["signal"]["pair"] == "USDCAD"
                assert not {"balance", "password", "note", "risk"}.intersection(body["signal"])
                if counters["chat"]: assert len(body["history"]) == 2
                counters["chat"] += 1
                reply = {"ok": True, "kind": "chat", "day": day, "generated_at": int(time.time()), "data_updated": int(time.time()) - 30, "content": {
                    "answer": '<img src=x onerror="window.bad=true"> Условен сценарий.', "watch": ["Провери прогнозата."], "unknowns": ["Резултатът още не е обявен."]}, "sources": [{"name": "Календар", "url": "https://nfs.faireconomy.media/ff_calendar_thisweek.json"}, {"name": "Невалиден линк", "url": "javascript:window.bad=true"}]}
                route.fulfill(status=200, content_type="application/json", body=json.dumps(reply))

            page.route("**/api/puls.php", assistant_fixture)
            page.locator('#puls-question').fill("Как се отнася към продажбата?")
            page.get_by_role("button", name="Попитай Пулс", exact=True).click()
            page.wait_for_function("!pulsPage(S.route.id).chat.busy && pulsPage(S.route.id).chat.messages.length === 2")
            assert page.locator('#main img[src="x"]').count() == 0
            assert page.locator('#main a[href^="javascript:"]').count() == 0
            assert not page.evaluate('!!window.bad')
            page.locator('#puls-question').fill("А след публикуването?")
            page.get_by_role("button", name="Попитай Пулс", exact=True).click()
            page.wait_for_function("!pulsPage(S.route.id).chat.busy && pulsPage(S.route.id).chat.messages.length === 4")
            assert counters["chat"] == 2
            page.locator('#puls-signal').select_option('two-orders~1')
            assert page.evaluate('pulsPage(S.route.id).chat.messages.length') == 0
            page.goto(base + "/#/news", wait_until="networkidle")
            page.locator('[data-puls-overview]').click()
            page.wait_for_function('!!PULS.overview.status?.overview && !PULS.overview.generating')
            assert 'Дневен обзор за проверка.' in page.locator('#main').inner_text()
            assert 'При дневна търговия' in page.locator('#main').inner_text()
            assert 'При суинг търговия' in page.locator('#main').inner_text()
            source_text = page.locator('.puls-overview .puls-sources').inner_text()
            for source in overview_response["sources"]:
                assert source["name"] in source_text
                assert page.evaluate('(t) => pulsTime(t)', source["updated"]) in source_text, "Each source retains its own timestamp"
            assert page.evaluate('(t) => pulsTime(t)', overview_response["generated_at"]) in source_text
            page.locator('[data-puls-overview]').click()
            page.wait_for_function('!PULS.overview.loading && !PULS.overview.generating')
            assert counters["overview"] == 1, "Rerenders and refresh checks reuse the daily overview"
            page.set_viewport_size({"width": 390, "height": 844})
            assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), "News layout overflows on mobile"
            page.screenshot(path="/tmp/tradepulse24-news-mobile.png", full_page=True)
            print("OK: explicit news questions, follow-ups, OCO direction choice, private payload, escaped replies, source links and shared daily overview")
            assert not errors, errors
            page.goto(base + "/#/risk", wait_until="networkidle")
            page.set_viewport_size({"width": 390, "height": 844})
            assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), "Mobile layout overflows"
            page.screenshot(path="/tmp/tradepulse24-risk-mobile.png", full_page=True)
            page.evaluate("""() => {
              const id='lib_ema_20_50_200-D1', entry=stratById(id);
              entry.stats={...entry.stats,end:Date.now()/1000};
              S.settings.style='swing'; S.settings.smartPairs=true; S.settings.followed=[id];
              S.data.signals=['EURUSD','USDJPY','XAUUSD'].map(pair=>({id:'pair-demo-'+pair,strategy:id,strategy_name:entry.name,pair,pair_name:FX.PAIRS[pair].name,tf:'D1',tf_label:'1 ден',style:'swing',status:'pending',signal_time:Date.now()/1000-600,valid_until:Date.now()/1000+3600,orders:[{type:'stop',dir:1,entry:100,stop:99,targets:[{w:1,level:null}]}]}));
              location.hash='#/signals'; render();
            }""")
            assert page.evaluate('mySignals().map(s=>s.pair)') == ['USDJPY','XAUUSD']
            assert '1 текущи модела са скрити' in page.locator('#main').inner_text()
            assert 'Непълна архивна проверка' in page.locator('#main').inner_text()
            page.evaluate("S.watch.add(S.data.signals[0]); render();")
            assert page.evaluate('mySignals().length') == 3, "Followed signal remains available after exclusion by instrument"
            page.evaluate("S.watch.ingest([{...S.data.signals[0],status:'cancelled',reason:'expired',exit_time:Date.now()/1000}]);")
            assert page.evaluate("S.watch.get('pair-demo-EURUSD').snapshot.status") == 'cancelled'
            page.evaluate("location.hash='#/settings'")
            page.locator('[name="smartPairs"]').uncheck()
            page.locator('#set-balance').fill('2000')
            page.locator('#settings-form button[type="submit"]').click()
            page.wait_for_function('!S.settings.smartPairs')
            assert not page.evaluate("JSON.parse(localStorage.getItem(STORE_KEY)).smartPairs")
            page.evaluate("location.hash='#/strategy/lib_ema_20_50_200-D1';render();")
            assert page.locator('.pair-review-table').count() == 1
            assert "Непълна архивна проверка" in page.locator('.pair-review-table').inner_text()
            assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), "Pair review overflows mobile viewport"
            print("OK: user's instrument table, default selection, explanatory labels, followed-signal updates, settings persistence and mobile pair table")
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
            print("OK: journal persistence, style selection, portfolio totals, news explanations, retired endpoint protection, optional assistant and mobile layout")
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
