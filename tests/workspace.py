"""Графики, подредба и мобилен преглед в изолиран браузър, без външни услуги."""
import json
import os
from pathlib import Path
import tempfile
import threading
import time
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
PAIRS = ["EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "USDCHF", "USDCAD", "NZDUSD", "XAUUSD"]
prices = {pair: {tf: json.loads((ROOT / f"data/prices/{pair}_{tf}.json").read_text())["bars"][-size:]
                 for tf, size in [("M15", 1300), ("H1", 1700), ("D1", 420)]} for pair in PAIRS}
quotes = {pair: {"price": rows["M15"][-1][4], "time": rows["M15"][-1][0] + 900} for pair, rows in prices.items()}
meta = {"prices_updated": max(q["time"] for q in quotes.values()), "quotes": quotes, "launch": 0, "refresh_minutes": 20, "errors": []}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, *args):
        pass

    def do_GET(self):
        path = urlsplit(self.path).path
        fixture = {"/api/state.php": {"release": "5.2.1", "costs": {"pairs": {}}}, "/data/meta.json": meta,
                   "/data/recent.json": {"prices": prices}, "/data/news.json": {"events": [], "updated": meta["prices_updated"]}}.get(path)
        if fixture is not None:
            body = json.dumps(fixture).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(body)
        elif path.startswith("/api/"):
            self.send_error(403)
        else:
            super().do_GET()

    def do_POST(self):
        self.send_error(403)


server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{server.server_port}"
try:
    with tempfile.TemporaryDirectory(prefix="tp24-workspace-") as folder, sync_playwright() as playwright:
        shots = Path(os.environ.get("TP24_SCREENSHOTS", folder))
        shots.mkdir(parents=True, exist_ok=True)
        browser = playwright.chromium.launch(executable_path="/usr/bin/chromium", headless=True, args=["--no-sandbox"])
        page = browser.new_page(viewport={"width": 1440, "height": 1600})
        errors, external, requests = [], [], []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("request", lambda request: requests.append(request.url))

        def network(route):
            if urlsplit(route.request.url).hostname == "127.0.0.1":
                route.continue_()
            else:
                external.append(route.request.url)
                route.abort()

        page.route("**/*", network)

        def edit_mode(target=page):
            # Бутоните за местене се показват само след „Подреди панелите“.
            if target.locator('[data-panel-edit][aria-pressed="true"]').count() == 0:
                target.locator('[data-panel-edit]').first.click()

        signals_top = "document.querySelector('[data-panel-key=\"signals\"]').getBoundingClientRect().top + scrollY"
        page.goto(base + "/#/", wait_until="networkidle")
        page.wait_for_function("S.data?.ready && !!MC.chart", timeout=60000)
        assert page.evaluate(signals_top) < 650, "Signals come first on the home page"
        page.evaluate("S.settings.balance=2000; saveSettings(); render()")
        board = page.locator('[data-panel-board="home"]')
        keys = lambda: board.evaluate("node => [...node.children].map(n=>n.dataset.panelKey)")
        assert keys()[:3] == ["signals", "side", "chart"], keys()
        assert not page.locator('[data-panel-key="signals"] .panel-grip').first.is_visible(), "Move controls stay hidden until requested"
        edit_mode()
        page.locator('[data-panel-key="chart"] .panel-grip').first.drag_to(page.locator('[data-panel-key="signals"]'), target_position={"x": 30, "y": 10})
        assert keys().index("chart") < keys().index("signals"), keys()
        order = keys()
        page.reload(wait_until="networkidle")
        page.wait_for_function("S.data?.ready && !!MC.chart")
        assert keys() == order, "Mouse order survives reload"
        edit_mode()
        page.locator('[data-panel-key="chart"] [data-panel-move="down"]').first.click()
        assert keys()[0] == "signals"
        page.locator('[data-panel-key="chart"] .panel-grip').first.focus()
        page.keyboard.press("ArrowUp")
        assert keys()[0] == "chart"
        page.locator('[data-panel-reset]').click()
        assert keys()[0] == "signals"
        page.locator('[data-panel-edit]').first.click()
        assert not page.locator('[data-panel-reset]').is_visible(), "Done hides the layout controls again"
        print("OK: hidden move controls, mouse drag, keyboard and button moves, persistence and reset")

        original = page.evaluate("({entry:MC.state.entry.id,signal:MC.state.sig?.id,model:MC.state.entry.tf,levels:JSON.stringify(MC.state.levels)})")
        for tf in ["M15", "H4", "D1", "H1"]:
            page.locator(f'[data-mc-tf="{tf}"]').click()
            assert page.evaluate("MC.state.tf") == tf
            assert page.evaluate("MC.state.entry.id") == original["entry"]
            assert page.evaluate("JSON.stringify(MC.state.levels)") == original["levels"]
        before = page.evaluate("MC.state.series.n")
        engine_unchanged = page.evaluate("window.originalEngine=S.engine; true")
        page.locator('[data-mc-history]').click()
        page.wait_for_function("!MC.loading.size && MC.history.has(MC.state.pair)", timeout=60000)
        assert page.evaluate("MC.state.series.n") > before
        assert page.evaluate("S.engine===window.originalEngine"), "Loading chart history cannot replace the current signal engine"
        assert page.evaluate("JSON.stringify(MC.state.levels)") == original["levels"]
        print("OK: all four view periods keep the model; local history preserves current levels")

        signal = page.evaluate("S.data.signals.find(s=>s.tf==='H1' && s.status==='open')?.id || S.data.signals.find(s=>s.tf==='H1')?.id")
        assert signal
        page.goto(base + "/#/signal/" + signal, wait_until="networkidle")
        page.wait_for_function("!!MC.chart && !!MC.state.fixedSignal")
        snapshot = page.evaluate("JSON.stringify(MC.state.sig)")
        levels = page.evaluate("JSON.stringify(MC.state.levels)")
        for tf in ["M15", "H4", "D1", "H1"]:
            page.locator(f'[data-mc-tf="{tf}"]').click()
            assert page.evaluate("MC.state.tf") == tf
            assert page.evaluate("JSON.stringify(MC.state.sig)") == snapshot
            assert page.evaluate("JSON.stringify(MC.state.levels)") == levels
        assert page.locator('#sig-chart').count() == 0
        assert page.locator('[data-panel-board="page"] > [data-panel-key]').count() >= 5
        print("OK: signal page uses the shared chart and preserves its signal, targets and stop")

        page.goto(base + "/#/", wait_until="networkidle")
        page.evaluate("""() => {
          S.settings.smartPairs=false;S.settings.followed=['lib_ema_9_21-H1'];
          const s=S.data.signals.find(s=>s.tf==='H1');
          S.data.signals=[{...s,id:'group-test-1',pair:'XAUUSD',pair_name:'XAU/USD',strategy:'lib_ema_9_21-H1',style:'day',status:'open',dir:1}, {...s,id:'group-test-2',pair:'XAUUSD',pair_name:'XAU/USD',strategy:'lib_ema_9_21-H1',style:'day',status:'open',dir:-1}, {...s,id:'group-test-3',pair:'XAUUSD',pair_name:'XAU/USD',strategy:'lib_ema_9_21-H1',style:'day',status:'pending',orders:[{type:'stop',dir:1,entry:4000,stop:3990}]}];
          render();
        }""")
        group = page.locator('[data-signal-group="XAUUSD"]')
        assert group.count() == 1
        assert "3 сигнала" in group.locator('.signal-group-head').inner_text()
        assert group.locator(':scope > .sig-grid > .sig-card').count() == 2, "One visible card per direction"
        group.locator('.group-more > summary').click()
        assert group.locator('.sig-card').count() == 3
        group.locator('[data-model-focus]').first.click()
        assert page.evaluate("MC.state.sig.id") == "group-test-1"
        print("OK: one instrument group includes opposite directions and pending/open states")

        for route in ["help", "risk", "help"]:
            page.goto(base + "/#/" + route, wait_until="networkidle")
            edit_mode()
            auto_board = page.locator('[data-layout-storage]').filter(has=page.locator(':scope > [data-panel-key]')).last
            auto_keys = lambda: auto_board.evaluate("node => [...node.children].filter(n=>n.dataset.panelKey).map(n=>n.dataset.panelKey)")
            initial_order = auto_keys()
            assert len(initial_order) >= 2, route
            auto_board.locator(':scope > [data-panel-key] [data-panel-move="down"]').first.click()
            assert auto_keys() != initial_order, route
            page.locator('[data-panel-reset]').click()
            assert auto_keys() == initial_order, route
        print("OK: repeated visits retain move controls and reset on automatically arranged pages")

        for width in [320, 390, 768, 1024, 1440]:
            page.set_viewport_size({"width": width, "height": 900})
            for route in ["", "pair/XAUUSD", "signal/" + signal, "settings", "risk", "lab", "news", "help"]:
                page.goto(base + "/#/" + route, wait_until="networkidle")
                assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), (width, route)
                assert not errors, errors
        page.set_viewport_size({"width": 390, "height": 844})
        page.goto(base + "/#/", wait_until="networkidle")
        assert page.evaluate(signals_top) < 650
        edit_mode()
        page.locator('[data-panel-key="signals"] [data-panel-move="down"]').first.click()
        assert keys()[0] != "signals"
        page.locator('[data-panel-reset]').click()
        page.screenshot(path=str(shots / "mobile-home.png"), full_page=True)
        page.set_viewport_size({"width": 1440, "height": 1000})
        page.screenshot(path=str(shots / "desktop-home.png"), full_page=True)
        page.goto(base + "/#/lab", wait_until="networkidle")
        assert "Паролата е в api/config.php" not in page.locator('#main').inner_text()
        assert not external, external
        assert not errors, errors
        assert not any("twelvedata.com" in request for request in requests)
        print("OK: 320/390/768/1024/1440 layouts, mobile controls, no provider requests and no password-location hint")

        touch = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
        touch.route("**/*", network)
        mobile = touch.new_page()
        mobile.goto(base + "/#/", wait_until="networkidle")
        # „Автоматично“: на телефон е опростената графика и библиотеката на TradingView не се тегли.
        mobile.wait_for_function("S.data?.ready && !!document.querySelector('#mc-chart svg')")
        assert mobile.evaluate("typeof LightweightCharts === 'undefined' && !MC.chart"), "Phones get the simple chart without loading the library"
        # Без въведен баланс най-отгоре е сгънатият ред „Въведи баланс“; сигналите са първият панел след него.
        first_panel = lambda: mobile.evaluate("[...document.querySelector('[data-panel-board=\"home\"]').children].map(n=>n.dataset.panelKey).filter(k=>k!=='account')[0]")
        assert first_panel() == "signals"
        mobile.locator('[data-panel-edit]').first.tap()
        mobile.locator('[data-panel-key="signals"] [data-panel-move="down"]').first.tap()
        assert first_panel() != "signals"
        mobile.locator('[data-panel-reset]').tap()
        assert first_panel() == "signals"
        mobile.evaluate("S.settings.chartMode='interactive'; saveSettings(); render()")
        mobile.wait_for_function("!!MC.chart", timeout=60000)
        print("OK: phone shows the simple chart by default and the interactive one when chosen in settings")
        touch.close()
        print("OK: touch controls move and reset panels in a mobile browser")

        original_meta = json.loads(json.dumps(meta))
        visitor = browser.new_page(viewport={"width": 1440, "height": 1000})
        visitor.route("**/*", network)
        # Работен ден, за да се проверят и предупрежденията за стари цени.
        visitor.add_init_script("Date.now = () => Date.UTC(2026, 9, 30, 10)")
        stamp = 1793354400
        internal = "Временно ограничен: Twelve Data до 15:39 ч. Цените идват от Tiingo."
        try:
            for state in ["fresh", "stale", "missing"]:
                meta.clear()
                meta.update(json.loads(json.dumps(original_meta)))
                meta.update({"source_prices": "Tiingo + Twelve Data", "errors": [internal, "HTTP 403: провери tiingo_key в api/config.local.php"]})
                if state == "fresh":
                    meta.update({"prices_updated": stamp, "price_attempt": stamp, "next_price_at": stamp + 900})
                    for quote in meta["quotes"].values():
                        quote["time"] = stamp
                else:
                    meta["errors"].append("Календарът с новини не можа да се обнови: HTTP 500 /server/private/path")
                    if state == "missing":
                        meta.update({"quotes": {}, "prices_updated": 0})
                visitor.goto(base + "/#/", wait_until="networkidle")
                visitor.reload(wait_until="networkidle")
                visitor.wait_for_function("S.data?.ready")
                alert = visitor.locator('#alert-bar').inner_text()
                if state == "fresh":
                    assert visitor.evaluate("FX.PAIR_KEYS.every(quoteFresh)")
                    assert not visitor.locator('#alert-bar').is_visible(), alert
                elif state == "stale":
                    assert "Част от котировките временно не могат да се обновят" in alert, alert
                    assert "Някои котировки са остарели" in alert, alert
                else:
                    assert "Липсват текущи цени" in alert
                    assert visitor.evaluate("!S.engine && S.data.signals.length===0")
                for route in ["", "pair/XAUUSD", "help", "news"]:
                    visitor.goto(base + "/#/" + route, wait_until="networkidle")
                    # textContent включва и сгънатите пояснения до графиката.
                    text = visitor.locator('body').text_content()
                    for private in ["Twelve Data", "Tiingo", "15:39", "HTTP 403", "HTTP 500", "tiingo_key", "api/config.local.php", "/server/private/path"]:
                        assert private not in text, (state, route, private)
            cached = visitor.evaluate("pulsSources({sources:[{name:'Tiingo — налични котировки',url:'https://www.tiingo.com/',updated:1793354400}]})")
            assert "Пазарни котировки" in cached and "Tiingo" not in cached and "tiingo.com" not in cached
            assert "Groq" not in visitor.evaluate("pulsError({code:'provider_limit',message:'Groq HTTP 429, groq_key'})")
            print("OK: fresh fallback is silent; stale and missing data stay visible without provider names, limits, paths or raw errors, including cached assistant references")
        finally:
            visitor.close()
            meta.clear()
            meta.update(original_meta)
        browser.close()
finally:
    server.shutdown()
    server.server_close()
