import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { FeedService, PAIRS, TFS, SEED_BASE, aggregate, appendDays, mergeBars, parseTiingo, parseTwelve, due, nextPrice, blockedUntil } from "../src/feed.mjs";
import worker from "../src/worker.mjs";

const NOW = Date.UTC(2026, 9, 30, 10) / 1000;
const bar = (t, close = 1.1) => [t, 1.1, Math.max(1.2, close), 1, close];
class KV {
  values = new Map(); writes = [];
  async get(key, type) { const raw = this.values.get(key)?.value; return raw == null ? null : type === "json" ? JSON.parse(raw) : raw; }
  async getWithMetadata(key) { return this.values.get(key) || { value: null, metadata: null }; }
  async put(key, value, options = {}) { this.values.set(key, { value, metadata: options.metadata }); this.writes.push(key); }
}
class Storage {
  values = new Map();
  async get(key) { return structuredClone(this.values.get(key)); }
  async put(key, value) { this.values.set(key, structuredClone(value)); }
}

function fixture(mode = "primary") {
  const kv = new KV(), storage = new Storage(), calls = [], clock = { value: NOW };
  const env = { FEED: kv, TIINGO_API_KEY: "test-tiingo-only", TWELVEDATA_API_KEY: mode === "primary" || mode === "old" ? "" : "test-twelve-only", ALLOWED_ORIGINS: "https://site.example" };
  const seed = { M15: Array.from({ length: 4 }, (_, i) => bar(NOW - 7200 + i * 900)), H1: [bar(NOW - 7200)], D1: [bar(Math.floor(NOW / 86400) * 86400 - 86400)] };
  const fetcher = async (url, options = {}) => {
    calls.push({ url, options, at: clock.value });
    if (url.startsWith(SEED_BASE)) return Response.json({ bars: seed[url.match(/_(M15|H1|D1)\.json$/)[1]] });
    if (url.startsWith("https://nfs.faireconomy.media/")) return Response.json([{ title: "Test news", country: "USD", date: new Date((NOW + 3600) * 1000).toISOString(), impact: "High", actual: "9", previous: "0" }]);
    if (url.startsWith("https://api.tiingo.com/")) {
      if (mode === "backup") return Response.json({ detail: "hour allocation limit" }, { status: 429 });
      if (mode === "failure") return Response.json({}, { status: 503 });
      const rows = mode === "old" ? seed.M15 : Array.from({ length: 6 }, (_, i) => bar(NOW - 4500 + i * 900, 1.11));
      return Response.json(rows.map(([t, o, h, l, c]) => ({ date: new Date(t * 1000).toISOString(), open: o, high: h, low: l, close: c })));
    }
    if (url.startsWith("https://api.twelvedata.com/")) {
      const daily = new URL(url).searchParams.get("interval") === "1day";
      const rows = daily ? seed.D1 : Array.from({ length: 6 }, (_, i) => bar(NOW - 4500 + i * 900, 1.12));
      return Response.json({ values: rows.map(([t, o, h, l, c]) => ({ datetime: new Date(t * 1000).toISOString().slice(0, 19).replace("T", " "), open: String(o), high: String(h), low: String(l), close: String(c) })) });
    }
    throw new Error("Unexpected network access");
  };
  const deps = { fetch: fetcher, now: () => clock.value, sleep: async (ms) => { clock.value += Math.ceil(ms / 1000); } };
  const service = new FeedService(env, storage, deps);
  return { service, env, kv, storage, calls, clock, seed, deps };
}

test("Seed запазва всичките 24 предоставени истории и повторното включване не ги подменя", async () => {
  const f = fixture();
  f.service.fetch = async (url) => {
    assert.ok(url.startsWith(SEED_BASE));
    return Response.json(JSON.parse(await readFile(new URL("../../data/prices/" + url.split("/").at(-1), import.meta.url), "utf8")));
  };
  assert.equal((await f.service.seed()).imported, 8);
  for (const pair of PAIRS) {
    const history = await f.kv.get("history/" + pair, "json");
    for (const tf of Object.keys(TFS)) {
      const original = JSON.parse(await readFile(new URL(`../../data/prices/${pair}_${tf}.json`, import.meta.url), "utf8"));
      assert.deepEqual(history.prices[tf], original.bars);
    }
  }
  const writes = f.kv.writes.length;
  assert.equal((await f.service.seed()).imported, 0);
  assert.equal(f.kv.writes.length, writes + 1, "Only the public snapshot can be republished");
  assert.equal((await f.kv.get("snapshot", "json")).meta.prices_updated, 0, "Historical prices are not live quotes");
});

test("Незавършените свещи и непълните часове не влизат в общите данни", () => {
  const rows = Array.from({ length: 5 }, (_, i) => bar(NOW - 3600 + i * 900));
  assert.equal(mergeBars([], rows, 900, NOW).length, 4);
  assert.equal(aggregate(rows.slice(1), 900, 3600, NOW).length, 0);
  assert.equal(aggregate(rows, 900, 3600, NOW).length, 1);
  const data = parseTiingo(rows.map(([t, o, h, l, c]) => ({ date: new Date(t * 1000).toISOString(), open: o, high: h, low: l, close: c })), NOW);
  assert.equal(data.bars.length, 4); assert.equal(data.quote.time, NOW);
  const daily = parseTwelve({ values: [{ datetime: "2026-10-30 00:00:00", open: "1", high: "2", low: "1", close: "1.5" }] }, 86400, NOW);
  assert.equal(daily.bars.length, 0);
});

test("Един централен цикъл, без API заявки от 100 посетители", async () => {
  const f = fixture(); await f.service.seed(); f.calls.length = 0;
  const jobs = await Promise.all(Array.from({ length: 10 }, () => f.service.tick()));
  assert.equal(jobs.filter((j) => j.busy).length, 9);
  assert.equal(f.calls.filter((c) => c.url.includes("api.tiingo.com")).length, 8);
  const snap = await f.kv.get("snapshot", "json");
  assert.equal(snap.meta.prices_updated, NOW);
  assert.equal(snap.news.events[0].actual, null);
  assert.equal(snap.recent.prices.EURUSD.H1.at(-1)[0], NOW - 3600);
  const raw = JSON.stringify(snap);
  for (const privateText of ["test-tiingo-only", "Tiingo", "tiingo", "twelve", "providers", "blocked", "Authorization"]) assert.ok(!raw.includes(privateText), privateText);
  const before = f.calls.length;
  f.env.COORDINATOR = { get() { throw new Error("GET must not start a coordinator"); }, idFromName() { throw new Error("GET must not start a coordinator"); } };
  for (let i = 0; i < 100; i++) {
    const response = await worker.fetch(new Request("https://feed.example/snapshot", { headers: { Origin: "https://site.example" } }), f.env, { waitUntil() {} });
    assert.equal(response.status, 200); assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://site.example");
    assert.equal((await response.json()).meta.prices_updated, NOW);
  }
  assert.equal(f.calls.length, before);
  const restarted = new FeedService(f.env, f.storage, f.deps);
  await restarted.tick(); assert.equal(f.calls.length, before, "Restart does not reset the schedule");
});

test("Twelve Data е резервен, с обща пауза, траен бюджет и без повтаряне на ограничен Tiingo", async () => {
  const f = fixture("backup"); await f.service.seed(); f.calls.length = 0;
  await f.service.tick();
  assert.equal(f.calls.filter((c) => c.url.includes("api.tiingo.com")).length, 1);
  const backup = f.calls.filter((c) => c.url.includes("api.twelvedata.com"));
  assert.equal(backup.length, 16);
  assert.ok(backup.slice(1).every((c, i) => c.at - backup[i].at >= 10));
  assert.ok(backup.every((c) => !c.url.includes("test-twelve-only") && c.options.headers.Authorization === "apikey test-twelve-only"));
  assert.equal((await f.kv.get("snapshot", "json")).meta.quotes.EURUSD.price, 1.12);
  const state = await f.storage.get("state"); assert.equal(state.providers.twelve.daily, 16);
  assert.ok(state.providers.tiingo.blocked > NOW);
  const f2 = new FeedService(f.env, f.storage, f.deps); await f2.ready;
  f2.state.providers.twelve.daily = 750;
  const before = f.calls.length;
  assert.equal(await f2.request("twelve", "https://api.twelvedata.com/time_series"), null);
  assert.equal(f.calls.length, before, "The provider budget is enforced before sending");
});

test("Стар отговор от доставчика не става прясна котировка", async () => {
  const f = fixture("old"); await f.service.seed(); await f.service.tick();
  const snap = await f.kv.get("snapshot", "json");
  assert.equal(snap.meta.prices_updated, NOW - 4500);
  assert.equal(snap.meta.quotes.EURUSD.time, NOW - 4500);
  assert.equal(snap.meta.price_attempt, NOW);
});

test("Изчакване през полунощ сменя броячите преди следващата резервна заявка", async () => {
  const f = fixture("backup"); await f.service.ready;
  f.clock.value = Date.UTC(2026, 9, 30, 23, 59, 58) / 1000;
  await f.service.request("twelve", "https://api.twelvedata.com/time_series");
  const firstDay = f.service.state.providers.twelve.day;
  await f.service.request("twelve", "https://api.twelvedata.com/time_series");
  assert.equal(f.service.state.providers.twelve.day, firstDay + 1);
  assert.equal(f.service.state.providers.twelve.daily, 1);
  assert.equal(f.service.state.providers.twelve.hourly, 1);
});

test("Реалните пазарни часове и софийският график се запазват", () => {
  assert.equal(due(Date.parse("2026-10-30T21:30:00Z") / 1000, NOW).due, true, "One final pull after market close");
  assert.equal(due(Date.parse("2026-10-30T22:30:00Z") / 1000, Date.parse("2026-10-30T21:30:00Z") / 1000).due, false);
  assert.equal(due(NOW + 600, NOW).due, false);
  assert.equal(due(NOW + 900, NOW).due, true);
  const night = Date.parse("2026-10-28T22:00:00Z") / 1000;
  assert.equal(due(night + 3600, night).due, false);
  assert.equal(nextPrice(night), night + 10800);
  assert.equal(blockedUntil("twelve", "daily limit", NOW), Math.floor(NOW / 86400) * 86400 + 86460);
  const friday = Date.parse("2026-10-30T00:00:00Z") / 1000;
  const hours = Array.from({ length: 21 }, (_, i) => bar(friday + i * 3600));
  assert.equal(appendDays(hours, "EURUSD", friday + 86400, 0).length, 1);
  assert.equal(appendDays(hours.slice(1), "EURUSD", friday + 86400, 0).length, 0);
  assert.equal(appendDays(hours, "EURUSD", friday + 86400, friday).length, 0, "Existing daily history is not derived again");
});

test("CORS, условни заявки, липсващ кеш и защита на административните действия", async () => {
  const f = fixture(); const ctx = { waitUntil() {} };
  let response = await worker.fetch(new Request("https://feed.example/snapshot"), f.env, ctx);
  assert.equal(response.status, 503); assert.equal(f.calls.length, 0);
  response = await worker.fetch(new Request("https://feed.example/admin/refresh", { method: "POST" }), f.env, ctx);
  assert.equal(response.status, 401); assert.equal(f.calls.length, 0);
  response = await worker.fetch(new Request("https://feed.example/snapshot", { headers: { Origin: "https://other.example" } }), f.env, ctx);
  assert.equal(response.status, 403);
  response = await worker.fetch(new Request("https://feed.example/snapshot", { method: "OPTIONS", headers: { Origin: "https://site.example", "Access-Control-Request-Headers": "If-None-Match" } }), f.env, ctx);
  assert.equal(response.status, 204); assert.match(response.headers.get("Access-Control-Allow-Headers"), /If-None-Match/);
  await f.service.seed();
  response = await worker.fetch(new Request("https://feed.example/snapshot"), f.env, ctx);
  const etag = response.headers.get("ETag");
  response = await worker.fetch(new Request("https://feed.example/snapshot", { headers: { "If-None-Match": etag } }), f.env, ctx);
  assert.equal(response.status, 304);
});
