"""Общият фийд през друг origin, без Cloudflare акаунт или заявки към доставчици."""
from collections import Counter
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import threading
import time
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
PAIRS = ["EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "USDCHF", "USDCAD", "NZDUSD", "XAUUSD"]
archives = {pair: {"pair": pair, "prices": {tf: json.loads((ROOT / f"data/prices/{pair}_{tf}.json").read_text())["bars"]
            for tf in ["M15", "H1", "D1"]}} for pair in PAIRS}
stamp = int(time.time())
prices = {pair: {tf: rows[-count:] for tf, count in [("M15", 1300), ("H1", 1700), ("D1", 420)]
                for rows in [archive["prices"][tf]]} for pair, archive in archives.items()}
meta = {"launch": 123, "updated": stamp, "prices_updated": stamp - 900, "price_attempt": stamp,
        "next_price_at": stamp + 900, "quotes": {pair: {"price": rows["M15"][-1][4], "time": stamp - 900} for pair, rows in prices.items()}}
snapshot = {"schema": "tradepulse-feed-v1", "meta": {**meta, "launch": 999}, "recent": {"prices": prices}, "news": {"events": [], "updated": stamp}}
offline, calls, local_paths = False, Counter(), []
feed_url = ""


class Site(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, *args):
        pass

    def do_GET(self):
        path = urlsplit(self.path).path
        local_paths.append(path)
        data = {"/api/state.php": {"release": "5.3", "costs": {}, "feed_url": feed_url}, "/data/meta.json": meta,
                "/data/recent.json": {"prices": prices}, "/data/news.json": {"events": []}}.get(path)
        if data is not None:
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(data).encode())
        elif path.startswith("/api/"):
            self.send_error(403)
        else:
            super().do_GET()


class Feed(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", base)
        self.send_header("Access-Control-Expose-Headers", "ETag")
        super().end_headers()

    def do_OPTIONS(self):
        calls["preflight"] += 1
        self.send_response(204)
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "If-None-Match, If-Modified-Since")
        self.end_headers()

    def do_GET(self):
        path = urlsplit(self.path).path
        calls[path] += 1
        if offline:
            self.send_response(503)
            self.end_headers()
            return
        if self.headers.get("If-None-Match") == '"fixture"':
            calls["not_modified"] += 1
            self.send_response(304)
            self.end_headers()
            return
        data = snapshot if path == "/snapshot" else archives.get(path.removeprefix("/history/"))
        self.send_response(200 if data else 404)
        self.send_header("Content-Type", "application/json")
        self.send_header("ETag", '"fixture"')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())


site, feed = ThreadingHTTPServer(("127.0.0.1", 0), Site), ThreadingHTTPServer(("127.0.0.1", 0), Feed)
base, feed_url = f"http://127.0.0.1:{site.server_port}", f"http://127.0.0.1:{feed.server_port}"
for server in [site, feed]:
    threading.Thread(target=server.serve_forever, daemon=True).start()
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path="/usr/bin/chromium", headless=True, args=["--no-sandbox"])
        context = browser.new_context(viewport={"width": 1280, "height": 900})
        errors, external = [], []

        def network(route):
            if urlsplit(route.request.url).hostname == "127.0.0.1":
                route.continue_()
            else:
                external.append(route.request.url)
                route.abort()

        context.route("**/*", network)
        page = context.new_page()
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(base + "/#/", wait_until="networkidle")
        page.wait_for_function("S.data?.ready && !!S.engine", timeout=60000)
        assert page.evaluate("S.feedURL") == feed_url
        assert page.evaluate("S.meta.launch") == 123
        data = page.evaluate("Promise.all(['M15','H1','D1'].map(tf=>getPriceJSON('EURUSD',tf)))")
        assert calls["/history/EURUSD"] == 1
        assert [d["bars"] for d in data] == [archives["EURUSD"]["prices"][tf] for tf in ["M15", "H1", "D1"]]
        page.evaluate("loadChartHistory('EURUSD')")
        assert page.evaluate("MC.history.has('EURUSD') && !MC.historyErrors.has('EURUSD')")
        page.evaluate("labLoadHistory()")
        page.wait_for_function("!LAB.loading && LAB.loaded", timeout=60000)
        assert not page.evaluate("LAB.loadError")
        assert all(calls['/history/' + pair] == 1 for pair in PAIRS), calls
        page.evaluate("load()")
        assert calls["not_modified"] > 0, calls
        assert page.evaluate("S.meta.quotes.EURUSD.time") == stamp - 900
        print("OK: cross-origin snapshot, ETag/304, original launch, shared archives for chart and real Lab worker")

        offline = True
        page.evaluate("load()")
        assert page.evaluate("S.meta.quotes.EURUSD.time") == stamp - 900
        assert page.evaluate("S.meta.updated") == stamp
        assert page.evaluate("!!S.engine")
        fresh = context.new_page()
        fresh.on("pageerror", lambda error: errors.append(str(error)))
        fresh.goto(base + "/#/", wait_until="networkidle")
        fresh.wait_for_function("S.data?.ready")
        assert fresh.evaluate("!S.engine && S.data.signals.length===0")
        assert "Липсват текущи цени" in fresh.locator("body").inner_text()
        assert "/data/recent.json" not in local_paths and "/data/news.json" not in local_paths
        assert not any(path.startswith("/data/prices/") for path in local_paths)
        assert not external and not errors, (external, errors)
        print("OK: outage preserves actual quote times; fresh visitors cannot fall back to local price files or providers")
        browser.close()
finally:
    for server in [site, feed]:
        server.shutdown()
        server.server_close()
