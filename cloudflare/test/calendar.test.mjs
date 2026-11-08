import test from "node:test";
import assert from "node:assert/strict";
import { calendarTime, parseCalendar, fetchCalendar, JB_CALENDAR, FF_CALENDAR } from "../src/calendar.mjs";
import { FeedService, PAIRS } from "../src/feed.mjs";

const NOW = Date.UTC(2026, 10, 8, 12) / 1000;
const jb = (extra = {}) => ({ Name: "Employment report", Currency: "USD", Date: "2026.11.09 15:30:00", Impact: "High", Actual: 0, Forecast: 2, Previous: 1, ...extra });
const ff = () => [{ title: "Backup event", country: "EUR", date: "2026-11-09T13:00:00Z", impact: "Medium", previous: "0" }];
const env = () => ({ JBLANKED_API_KEY: "local-news-key-only-not-a-real-key", JBLANKED_TIMEZONE: "Etc/GMT-3" });

test("Часовете без зона изискват конфигурация; UTC, София и преходите се проверяват", () => {
  assert.throws(() => calendarTime("2026.11.09 15:30:00"), { code: "timezone_required" });
  assert.equal(calendarTime("2026.11.09 15:30:00", "Etc/GMT-3"), Date.UTC(2026, 10, 9, 12, 30) / 1000);
  assert.equal(calendarTime("2026-11-09T15:30:00+03:00"), Date.UTC(2026, 10, 9, 12, 30) / 1000);
  assert.equal(calendarTime("2026-11-09 15:30:00+03:00"), Date.UTC(2026, 10, 9, 12, 30) / 1000);
  assert.equal(calendarTime("2026.11.09 15:30:00", "Europe/Sofia"), Date.UTC(2026, 10, 9, 13, 30) / 1000);
  assert.equal(calendarTime("2026.07.09 15:30:00", "Europe/Sofia"), Date.UTC(2026, 6, 9, 12, 30) / 1000);
  assert.throws(() => calendarTime("2026.10.25 03:30:00", "Europe/Sofia"), { code: "ambiguous_date" });
  assert.throws(() => calendarTime("2026.03.29 03:30:00", "Europe/Sofia"), { code: "invalid_date" });
  assert.throws(() => calendarTime("2026.02.30 03:30:00", "UTC"), { code: "invalid_date" });
  assert.throws(() => calendarTime("2026-02-30T03:30:00Z"), { code: "invalid_date" });
});

test("JB-News запазва нулев резултат, скрива бъдещ actual и дава стабилни ID", async () => {
  const future = await parseCalendar([jb(), jb()], "jbnews", NOW, "Etc/GMT-3");
  assert.equal(future.length, 1); assert.equal(future[0].actual, null);
  assert.equal(future[0].forecast, "2"); assert.equal(future[0].impact, "high");
  const past = await parseCalendar([jb({ Date: "2026.11.08 13:00:00", Impact: 3 })], "jbnews", NOW, "Etc/GMT-3");
  assert.equal(past[0].actual, "0");
  assert.deepEqual(await parseCalendar([jb(), jb()], "jbnews", NOW, "Etc/GMT-3"), future);
  await assert.rejects(parseCalendar([], "jbnews", NOW, "UTC"), { code: "invalid_calendar" });
  await assert.rejects(parseCalendar([jb({ Impact: "unknown" })], "jbnews", NOW, "UTC"), { code: "unknown_impact" });
  await assert.rejects(parseCalendar([jb({ Date: "2020.01.01 00:00:00" })], "jbnews", NOW, "UTC"), { code: "wrong_calendar_week" });
});

test("Основен JB-News, резервен FF, трайни паузи и без ключ в URL/публичните данни", async () => {
  const config = env(), state = {}, calls = []; let clock = NOW, deny = false;
  const deps = { now: () => clock, save: async () => {}, fetch: async (url, opts) => {
    calls.push({ url, opts });
    if (url === JB_CALENDAR) return deny ? new Response("no", { status: 403 }) : Response.json([jb()]);
    assert.equal(url, FF_CALENDAR); return Response.json(ff());
  } };
  const first = await fetchCalendar(config, state, deps);
  assert.equal(first.provider, "jbnews"); assert.equal(calls.length, 1);
  assert.equal(calls[0].opts.headers.Authorization, "Api-Key " + config.JBLANKED_API_KEY);
  assert.ok(!calls[0].url.includes(config.JBLANKED_API_KEY));
  assert.ok(!JSON.stringify(first).includes(config.JBLANKED_API_KEY));
  assert.ok(!JSON.stringify(state).includes(config.JBLANKED_API_KEY));
  clock += 900; deny = true;
  const second = await fetchCalendar(config, state, deps);
  assert.equal(second.provider, "forexfactory");
  const before = calls.length;
  const restarted = JSON.parse(JSON.stringify(state));
  assert.deepEqual(await fetchCalendar(config, restarted, deps), { waiting: true });
  assert.equal(calls.length, before);
  assert.equal(restarted.calendar_providers.jbnews.problem, "access_denied");
});

test("Непотвърдена зона, HTML, изчерпана квота и отразен ключ не стават свеж календар", async () => {
  const config = env(); delete config.JBLANKED_TIMEZONE;
  const state = {};
  const deps = { now: () => NOW, save: async () => {}, fetch: async (url) => url === JB_CALENDAR ? Response.json([jb()]) : new Response("blocked", { status: 403 }) };
  assert.equal(await fetchCalendar(config, state, deps), null);
  assert.equal(state.calendar_providers.jbnews.problem, "timezone_required");
  assert.equal(state.calendar_providers.jbnews.samples[0].date, jb().Date);
  for (const mode of ["html", "limit", "echo"]) {
    const s = {}, e = env();
    const d = { ...deps, fetch: async (url) => url === FF_CALENDAR ? new Response("blocked", { status: 403 })
      : mode === "html" ? new Response("<html>challenge</html>")
      : mode === "limit" ? new Response("limit", { status: 429, headers: { "Retry-After": "600" } })
      : Response.json([jb({ Name: e.JBLANKED_API_KEY })]) };
    assert.equal(await fetchCalendar(e, s, d), null);
    assert.ok(!JSON.stringify(s).includes(e.JBLANKED_API_KEY));
    if (mode === "limit") assert.equal(s.calendar_providers.jbnews.blocked, NOW + 600);
  }
});

test("Общият пакет публикува новия календар атомарно, а при отказ пази истинския стар час", async () => {
  const entries = new Map(), storage = { get: async () => undefined, put: async () => {} };
  let staleCalendar = true, fail = false, clock = NOW, calls = 0;
  const kv = { get: async (key) => {
    if (key === "calendar" && staleCalendar) return { events: [], updated: NOW - 3600 };
    return entries.has(key) ? JSON.parse(entries.get(key)) : null;
  }, put: async (key, raw) => entries.set(key, raw) };
  const config = { ...env(), FEED: kv };
  const service = new FeedService(config, storage, { now: () => clock, fetch: async () => { calls++; return fail ? new Response("blocked", { status: 403 }) : Response.json([jb()]); } });
  await service.ready; service.state.seeded = true;
  for (const pair of PAIRS) entries.set("history/" + pair, JSON.stringify({ pair, prices: { M15: [], H1: [], D1: [] } }));
  assert.equal((await service.refreshNews()).ok, true);
  let snapshot = JSON.parse(entries.get("snapshot"));
  assert.equal(snapshot.news.updated, NOW); assert.equal(snapshot.news.events[0].title, jb().Name);
  assert.ok(!JSON.stringify(snapshot).includes(config.JBLANKED_API_KEY));
  assert.ok(!JSON.stringify(snapshot).includes("calendar_providers"));
  assert.equal(snapshot.meta.errors.length, 0);
  const previous = entries.get("calendar"); staleCalendar = false; fail = true; clock += 3601;
  assert.equal((await service.refreshNews()).ok, false);
  snapshot = JSON.parse(entries.get("snapshot"));
  assert.equal(entries.get("calendar"), previous); assert.equal(snapshot.news.updated, NOW);
  assert.equal(snapshot.meta.errors.length, 1);
  const after = calls; await service.refreshNews(); assert.equal(calls, after);
});
