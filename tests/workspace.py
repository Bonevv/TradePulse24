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
        fixture = {"/api/state.php": {"release": "4.9", "costs": {"pairs": {}}}, "/data/meta.json": meta,
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
        page.goto(base + "/#/", wait_until="networkidle")
        page.wait_for_function("S.data?.ready && !!MC.chart", timeout=60000)
        assert page.evaluate("document.querySelector('#mc-panel').getBoundingClientRect().top + scrollY") < 650
        page.evaluate("S.settings.balance=2000; saveSettings(); render()")
        board = page.locator('[data-panel-board="home"]')
        keys = lambda: board.evaluate("node => [...node.children].map(n=>n.dataset.panelKey)")
        assert keys()[0] == "chart"
        page.locator('[data-panel-key="signals"] .panel-grip').first.drag_to(page.locator('[data-panel-key="chart"]'), target_position={"x": 30, "y": 10})
        assert keys().index("signals") < keys().index("chart"), keys()
        order = keys()
        page.reload(wait_until="networkidle")
        page.wait_for_function("S.data?.ready && !!MC.chart")
        assert keys() == order, "Mouse order survives reload"
        page.locator('[data-panel-key="signals"] [data-panel-move="down"]').first.click()
        assert keys()[0] == "chart"
        page.locator('[data-panel-key="signals"] .panel-grip').first.focus()
        page.keyboard.press("ArrowUp")
        assert keys()[0] == "signals"
        page.locator('[data-panel-reset]').click()
        assert keys()[0] == "chart"
        print("OK: mouse drag, keyboard and button moves, persistence and reset")

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
        assert "3 сигнала" in group.locator('summary').inner_text()
        group.locator('summary').click()
        assert group.locator('.sig-card').count() == 3
        group.locator('[data-model-focus]').first.click()
        assert page.evaluate("MC.state.sig.id") == "group-test-1"
        print("OK: one instrument group includes opposite directions and pending/open states")

        for route in ["help", "risk", "help"]:
            page.goto(base + "/#/" + route, wait_until="networkidle")
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
        assert page.evaluate("document.querySelector('#mc-panel').getBoundingClientRect().top + scrollY") < 650
        page.locator('[data-panel-key="chart"] [data-panel-move="down"]').first.click()
        assert keys()[0] != "chart"
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
        mobile.wait_for_function("S.data?.ready && !!MC.chart")
        mobile.locator('[data-panel-key="chart"] [data-panel-move="down"]').first.tap()
        assert mobile.locator('[data-panel-board="home"] > [data-panel-key]').first.get_attribute('data-panel-key') != 'chart'
        mobile.locator('[data-panel-reset]').tap()
        assert mobile.locator('[data-panel-board="home"] > [data-panel-key]').first.get_attribute('data-panel-key') == 'chart'
        touch.close()
        print("OK: touch controls move and reset panels in a mobile browser")
        browser.close()
finally:
    server.shutdown()
    server.server_close()
