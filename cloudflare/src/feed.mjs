import { fetchCalendar, newsInterval, newsMode } from "./calendar.mjs";
// Общите данни са отделени от HTTP посетителите. Само координаторът тегли от доставчици.
export const PAIRS = ["EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "USDCHF", "USDCAD", "NZDUSD", "XAUUSD"];
export const TFS = { M15: 900, H1: 3600, D1: 86400 };
export const SCHEMA = "tradepulse-feed-v1";
export const SEED_BASE = "https://raw.githubusercontent.com/Bonevv/TradePulse24/4ad92b8748d70ab6d60a0ce5d0123165a6233bf3/data/prices";
const encoder = new TextEncoder();
const ny = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "2-digit", hourCycle: "h23" });
const sofia = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Sofia", hour: "2-digit", hourCycle: "h23" });
const clamp = (value, fallback, min, max) => Math.max(min, Math.min(max, Number(value) || fallback));

export function marketOpen(now) {
  const p = Object.fromEntries(ny.formatToParts(new Date(now * 1000)).map((p) => [p.type, p.value]));
  const h = Number(p.hour);
  return p.weekday !== "Sat" && !(p.weekday === "Sun" && h < 17) && !(p.weekday === "Fri" && h >= 17);
}

export function due(now, last, env = {}) {
  const day = clamp(env.REFRESH_MINUTES, 15, 15, 60), night = clamp(env.NIGHT_REFRESH_MINUTES, 180, day, 360);
  if (!marketOpen(now)) return { due: !last || marketOpen(last), minutes: night };
  const hour = Number(sofia.format(new Date(now * 1000))), minutes = hour >= 7 && hour < 22 ? day : night;
  return { due: now - last >= minutes * 60 - 90, minutes };
}

export function nextPrice(last, env = {}) {
  for (let t = last + 300; t <= last + 4 * 86400; t += 300) if (due(t, last, env).due) return t;
  return last + 4 * 86400;
}

function validBar(row, seconds, now) {
  return Array.isArray(row) && row.length === 5 && row.every(Number.isFinite) && Number.isInteger(row[0])
    && row[0] > 0 && row[0] % seconds === 0 && row[0] + seconds <= now
    && row.slice(1).every((v) => v > 0) && row[2] >= Math.max(row[1], row[3], row[4])
    && row[3] <= Math.min(row[1], row[2], row[4]);
}

export function mergeBars(old, added, seconds, now) {
  const rows = new Map();
  for (const row of [...old, ...added]) if (validBar(row, seconds, now)) rows.set(row[0], row.slice());
  return [...rows.values()].sort((a, b) => a[0] - b[0]);
}

export function aggregate(rows, fromSeconds, toSeconds, now) {
  const groups = new Map(), expected = toSeconds / fromSeconds;
  for (const row of rows) {
    if (!validBar(row, fromSeconds, now)) continue;
    const t = Math.floor(row[0] / toSeconds) * toSeconds;
    if (!groups.has(t)) groups.set(t, new Map());
    groups.get(t).set(row[0], row);
  }
  const out = [];
  for (const [t, map] of groups) {
    const part = [...map.values()].sort((a, b) => a[0] - b[0]);
    if (part.length !== expected || t + toSeconds > now || part.some((row, i) => row[0] !== t + i * fromSeconds)) continue;
    out.push([t, part[0][1], Math.max(...part.map((r) => r[2])), Math.min(...part.map((r) => r[3])), part.at(-1)[4]]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

export function appendDays(hours, pair, now, after) {
  const groups = new Map();
  for (const row of hours) {
    const day = Math.floor(row[0] / 86400) * 86400;
    if (day <= after || day + 86400 > now || !validBar(row, 3600, now)) continue;
    if (!groups.has(day)) groups.set(day, new Map());
    groups.get(day).set(row[0], row);
  }
  const out = [];
  for (const [day, rows] of groups) {
    const expected = [];
    for (let t = day; t < day + 86400; t += 3600) {
      const hour = Number(Object.fromEntries(ny.formatToParts(new Date(t * 1000)).map((p) => [p.type, p.value])).hour);
      if (marketOpen(t) && !(pair === "XAUUSD" && hour === 17)) expected.push(t);
    }
    if (!expected.length || expected.some((t) => !rows.has(t))) continue;
    const part = [...rows.values()].sort((a, b) => a[0] - b[0]);
    out.push([day, part[0][1], Math.max(...part.map((r) => r[2])), Math.min(...part.map((r) => r[3])), part.at(-1)[4]]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

export function parseTiingo(body, now) {
  if (!Array.isArray(body)) throw new Error("provider_reply");
  let quote = null;
  const rows = [];
  for (const row of body) {
    const t = Date.parse(row?.date) / 1000, values = [row?.open, row?.high, row?.low, row?.close].map(Number);
    if (!Number.isInteger(t) || t <= 0 || t > now + 60 || !values.every((v) => Number.isFinite(v) && v > 0)) continue;
    if (!quote || t >= quote.time) quote = { price: values[3], time: t, fetched_at: now };
    rows.push([t, values[0], Math.max(...values), Math.min(...values), values[3]]);
  }
  return { bars: mergeBars([], rows, 900, now), quote };
}

export function parseTwelve(body, seconds, now) {
  if (!Array.isArray(body?.values)) throw new Error("provider_reply");
  let quote = null;
  const rows = [];
  for (const row of body.values) {
    const stamp = String(row.datetime || "").replace(" ", "T");
    const t = Date.parse(stamp + (/[Zz]|[+-]\d\d:\d\d$/.test(stamp) ? "" : "Z")) / 1000;
    const values = [row.open, row.high, row.low, row.close].map(Number);
    if (!Number.isInteger(t) || t <= 0 || t > now + 60 || !values.every((v) => Number.isFinite(v) && v > 0)) continue;
    if (!quote || t >= quote.time) quote = { price: values[3], time: t, fetched_at: now };
    rows.push([t, values[0], Math.max(...values), Math.min(...values), values[3]]);
  }
  return { bars: mergeBars([], rows, seconds, now), quote };
}

export function blockedUntil(source, message, now, retryAfter = 0) {
  if (retryAfter > 0) return now + Math.min(86400, Math.max(60, retryAfter));
  if (/daily|for the day/i.test(message)) return Math.floor(now / 86400) * 86400 + 86460;
  if (/hour/i.test(message)) return Math.floor(now / 3600) * 3600 + 3630;
  if (/minute/i.test(message)) return now + 70;
  return source === "tiingo" ? Math.floor(now / 3600) * 3600 + 3630 : now + 900;
}

export async function putJSON(kv, key, value) {
  const raw = JSON.stringify(value), bytes = encoder.encode(raw);
  if (bytes.length > 25 * 1024 * 1024) throw new Error("archive_size");
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  const etag = [...new Uint8Array(hash)].map((v) => v.toString(16).padStart(2, "0")).join("");
  await kv.put(key, raw, { metadata: { etag } });
}

const keyOf = (pair) => "history/" + pair;
const utc = (t) => new Date(t * 1000).toISOString().slice(0, 19);

export class FeedService {
  constructor(env, storage, deps = {}) {
    this.env = env; this.storage = storage; this.kv = env.FEED;
    // Runtime fetch изисква глобалния контекст; this.fetch(...) иначе дава Illegal invocation.
    this.fetch = deps.fetch || ((...args) => globalThis.fetch(...args)); this.now = deps.now || (() => Math.floor(Date.now() / 1000));
    this.sleep = deps.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.ready = storage.get("state").then((state) => { this.state = state || { version: 1, providers: {}, quotes: {}, d1: {}, attempt: 0, news_at: 0 }; });
    this.flight = null;
  }

  async save() { await this.storage.put("state", this.state); }

  exclusive(job) {
    if (this.flight) return Promise.resolve({ ok: false, busy: true });
    this.flight = (async () => { await this.ready; this.recentChanges = new Map(); this.pendingNews = null; return job(); })().finally(() => { this.flight = null; this.recentChanges = null; this.pendingNews = null; });
    return this.flight;
  }

  async history(pair) { return await this.kv.get(keyOf(pair), "json"); }

  async saveArchive(pair, archive) {
    await putJSON(this.kv, keyOf(pair), archive);
    this.recentChanges.set(pair, Object.fromEntries(Object.entries({ M15: 1300, H1: 1700, D1: 420 }).map(([tf, count]) => [tf, archive.prices[tf].slice(-count)])));
  }

  async seed() {
    return this.exclusive(async () => {
      let copied = 0;
      for (const pair of PAIRS) {
        if (await this.history(pair)) continue; // Повторното включване не връща архива назад.
        const prices = {};
        for (const [tf, seconds] of Object.entries(TFS)) {
          const reply = await this.fetch(`${SEED_BASE}/${pair}_${tf}.json`);
          if (!reply.ok) throw new Error("seed_unavailable");
          const file = await reply.json();
          if (!Array.isArray(file?.bars) || !file.bars.length) throw new Error("seed_invalid");
          prices[tf] = mergeBars([], file.bars, seconds, this.now());
          // При seed не приемаме скрито отрязана или неподредена история.
          if (prices[tf].length !== file.bars.length) throw new Error("seed_invalid");
        }
        await this.saveArchive(pair, { pair, prices }); copied++;
      }
      this.state.seeded = true; await this.save(); await this.publish();
      return { ok: true, imported: copied };
    });
  }

  async request(source, url) {
    let now = this.now();
    const key = source === "tiingo" ? this.env.TIINGO_API_KEY : this.env.TWELVEDATA_API_KEY;
    if (!key) return null;
    const p = this.state.providers[source] ||= {};
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(key)));
    const tag = [...digest.slice(0, 8)].map((v) => v.toString(16).padStart(2, "0")).join("");
    if (p.tag !== tag) { p.tag = tag; p.blocked = 0; p.problem = null; }
    if (now < (p.blocked || 0)) return null;
    const day = Math.floor(now / 86400), hour = Math.floor(now / 3600), minute = Math.floor(now / 60);
    if (p.day !== day) { p.day = day; p.daily = 0; }
    if (p.hour !== hour) { p.hour = hour; p.hourly = 0; }
    if (p.minute !== minute) { p.minute = minute; p.minutely = 0; }
    if (p.daily >= (source === "tiingo" ? 900 : 750) || source === "tiingo" && p.hourly >= 45) return null;
    if (source === "twelve") {
      const wait = Math.max(0, (p.next || 0) - now, p.minutely >= 6 ? (minute + 1) * 60 - now : 0);
      if (wait) await this.sleep(wait * 1000);
      now = this.now();
      if (p.day !== Math.floor(now / 86400)) { p.day = Math.floor(now / 86400); p.daily = 0; }
      if (p.hour !== Math.floor(now / 3600)) { p.hour = Math.floor(now / 3600); p.hourly = 0; }
      const m = Math.floor(now / 60);
      if (m !== p.minute) { p.minute = m; p.minutely = 0; }
      p.next = this.now() + 10;
    }
    p.daily++; p.hourly++; p.minutely++; await this.save(); // Броим и отказаните заявки.
    try {
      const response = await this.fetch(url, { headers: { Authorization: source === "tiingo" ? "Token " + key : "apikey " + key }, signal: AbortSignal.timeout(45000) });
      if (response.status === 401 || response.status === 403) { await response.body?.cancel(); p.blocked = this.now() + 3600; p.problem = "credentials"; await this.save(); return null; }
      const body = await response.json().catch(() => ({}));
      const message = String(body?.detail || body?.message || "");
      if (response.status === 429 || response.status === 402 || /allocation|limit|too many|credits/i.test(message)) {
        p.blocked = blockedUntil(source, message, this.now(), Number(response.headers.get("Retry-After")) || 0); p.problem = "limit";
        await this.save(); return null;
      }
      if (!response.ok || body?.status === "error" || body?.detail) {
        p.problem = "invalid_reply"; if (response.status >= 500) p.blocked = this.now() + 300;
        await this.save(); return null;
      }
      p.problem = null; return body;
    } catch (_) { p.problem = "unavailable"; p.blocked = this.now() + 300; await this.save(); return null; }
  }

  async candles(pair, from, to) {
    const tiingo = new URL(`https://api.tiingo.com/tiingo/fx/${pair.toLowerCase()}/prices`);
    tiingo.search = new URLSearchParams({ startDate: utc(from).slice(0, 10), endDate: utc(to + 86400).slice(0, 10), resampleFreq: "15min" });
    const primary = await this.request("tiingo", tiingo.href);
    if (primary) {
      try { const data = parseTiingo(primary, this.now()); if (data.quote) return data; } catch (_) { this.state.providers.tiingo.problem = "invalid_data"; }
    }
    const backup = await this.twelve(pair, "15min", 900, from, to);
    return backup;
  }

  async twelve(pair, interval, seconds, from, to) {
    const url = new URL("https://api.twelvedata.com/time_series");
    url.search = new URLSearchParams({ symbol: pair.slice(0, 3) + "/" + pair.slice(3), interval, timezone: "UTC", outputsize: "5000", start_date: utc(from), end_date: utc(to) });
    const body = await this.request("twelve", url.href);
    if (!body) return null;
    try { const data = parseTwelve(body, seconds, this.now()); return data.quote ? data : null; } catch (_) { this.state.providers.twelve.problem = "invalid_data"; return null; }
  }

  async tick() {
    return this.exclusive(async () => {
      if (!this.state.seeded) return { ok: false, needs_seed: true };
      const priceKeys = !!(this.env.TIINGO_API_KEY || this.env.TWELVEDATA_API_KEY);
      const now = this.now(), schedule = due(now, this.state.attempt, this.env);
      if (schedule.due && priceKeys) {
        this.state.attempt = now; await this.save(); // След прекъсване не повтаряме същия цикъл.
        for (const pair of PAIRS) {
          const archive = await this.history(pair);
          if (!archive?.prices?.M15?.length) { this.state.seeded = false; await this.save(); return { ok: false, needs_seed: true }; }
          const last = archive.prices.M15.at(-1)[0], end = Math.min(now, last + 30 * 86400);
          const data = await this.candles(pair, last, end);
          if (!data) continue;
          const prices = archive.prices;
          prices.M15 = mergeBars(prices.M15, data.bars, 900, this.now());
          prices.H1 = mergeBars(prices.H1, aggregate(prices.M15.slice(-data.bars.length - 8), 900, 3600, this.now()), 3600, this.now());
          if (this.env.TWELVEDATA_API_KEY && now - (this.state.d1[pair] || 0) >= 10800) {
            const days = await this.twelve(pair, "1day", 86400, prices.D1.at(-1)?.[0] || now - 30 * 86400, now);
            if (days) { prices.D1 = mergeBars(prices.D1, days.bars, 86400, this.now()); this.state.d1[pair] = now; }
            else prices.D1 = mergeBars(prices.D1, appendDays(prices.H1.slice(-800), pair, this.now(), prices.D1.at(-1)?.[0] || 0), 86400, this.now());
          } else if (!this.env.TWELVEDATA_API_KEY) {
            prices.D1 = mergeBars(prices.D1, appendDays(prices.H1.slice(-800), pair, this.now(), prices.D1.at(-1)?.[0] || 0), 86400, this.now());
          }
          await this.saveArchive(pair, archive);
          if (data.quote.time >= (this.state.quotes[pair]?.time || 0)) this.state.quotes[pair] = data.quote;
          await this.save();
        }
      }
      if (this.state.news_mode !== newsMode(this.env) || now - (this.state.news_attempt || this.state.news_at) >= newsInterval(this.env) - 60) await this.updateNews();
      await this.save();
      if (schedule.due && priceKeys || this.state.news_changed) await this.publish();
      this.state.news_changed = false; await this.save();
      return { ok: priceKeys, price_due: schedule.due && priceKeys, ...(!priceKeys ? { needs_keys: true } : {}) };
    });
  }

  async updateNews() {
    const previousAttempt = this.state.news_attempt || 0;
    this.state.news_attempt = this.now(); this.state.news_mode = newsMode(this.env); await this.save();
    const result = await fetchCalendar(this.env, this.state, { fetch: this.fetch, now: this.now, save: () => this.save() });
    if (result?.waiting) { this.state.news_attempt = previousAttempt; await this.save(); return; }
    if (!result) {
      const reused = this.state.news_provider === "forexfactory" && this.now() - this.state.news_at < 3600;
      if (this.state.news_problem !== !reused) this.state.news_changed = true;
      this.state.news_problem = !reused; return;
    }
    const old = await this.kv.get("calendar", "json") || { events: [] }, now = this.now();
    const firstNew = result.events[0].time, events = new Map(result.events.map((event) => [event.id, event]));
    for (const e of old.events) if (e.time >= now - 30 * 86400 && e.time < firstNew && !events.has(e.id)) events.set(e.id, e);
    const calendar = { events: [...events.values()].sort((a, b) => a.time - b.time), updated: result.updated };
    await putJSON(this.kv, "calendar", calendar); this.pendingNews = calendar;
    this.state.news_at = result.updated; this.state.news_provider = result.provider;
    this.state.news_changed = true; this.state.news_problem = false;
  }

  async refreshNews() {
    return this.exclusive(async () => {
      if (!this.state.seeded) return { ok: false, needs_seed: true };
      const jb = this.state.calendar_providers?.jbnews, ff = this.state.calendar_providers?.forexfactory;
      const modeChanged = this.state.news_mode !== newsMode(this.env);
      const primary = this.env.JBLANKED_API_KEY ? jb : ff;
      const pause = this.env.JBLANKED_API_KEY ? 300 : 3600;
      if (!modeChanged && primary?.attempt && this.now() - primary.attempt < pause)
        return { ok: !this.state.news_problem, calendar: this.calendarStatus() };
      await this.updateNews(); await this.save();
      await this.publish(); this.state.news_changed = false; await this.save();
      return { ok: !this.state.news_problem, calendar: this.calendarStatus() };
    });
  }

  calendarStatus() {
    return { jbnews_configured: !!this.env.JBLANKED_API_KEY, timezone: this.env.JBLANKED_TIMEZONE || null,
      last_attempt: this.state.news_attempt || 0, last_success: this.state.news_at || 0,
      source: this.state.news_provider || null, problem: !!this.state.news_problem,
      providers: this.state.calendar_providers || {},
      note: "При timezone_required провери часовата зона в документацията на доставчика и задай JBLANKED_TIMEZONE. Часове без зона не се приемат като UTC по предположение." };
  }

  async publish() {
    const now = this.now(), prices = {}, quotes = {};
    for (const pair of PAIRS) {
      if (this.recentChanges?.has(pair)) prices[pair] = this.recentChanges.get(pair);
      else {
        const archive = await this.history(pair);
        if (archive?.prices) prices[pair] = Object.fromEntries(Object.entries({ M15: 1300, H1: 1700, D1: 420 }).map(([tf, count]) => [tf, archive.prices[tf].slice(-count)]));
      }
      const q = this.state.quotes[pair]; if (q) quotes[pair] = { price: q.price, time: q.time, fetched_at: q.fetched_at };
    }
    const news = this.pendingNews || await this.kv.get("calendar", "json") || { events: [], updated: 0 };
    const errors = this.state.news_problem ? ["Календарът временно не може да се обнови."] : [];
    const meta = { quotes, updated: now, prices_updated: Math.min(now, Math.max(0, ...Object.values(quotes).map((q) => q.time))), price_attempt: this.state.attempt,
      next_price_at: nextPrice(this.state.attempt || now, this.env), refresh_minutes: clamp(this.env.REFRESH_MINUTES, 15, 15, 60), news_updated: news.updated, source_news: this.state.news_provider === "jbnews" ? "MQL5 · чрез JB-News" : "ForexFactory — седмичен календар", errors };
    await putJSON(this.kv, "snapshot", { schema: SCHEMA, meta, recent: { generated: now, prices }, news });
  }

  async status() {
    await this.ready;
    return { ok: true, calendar: this.calendarStatus(), seeded: !!this.state.seeded, busy: !!this.flight, last_attempt: this.state.attempt, next_attempt: nextPrice(this.state.attempt || this.now(), this.env),
      providers: Object.fromEntries(["tiingo", "twelve"].map((name) => [name, { configured: !!(name === "tiingo" ? this.env.TIINGO_API_KEY : this.env.TWELVEDATA_API_KEY), ...this.state.providers[name] }])) };
  }
}
