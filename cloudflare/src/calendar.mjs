// JB-News (MQL5) е основен; ForexFactory е резервен. Тук няма заявки от посетители.
export const JB_CALENDAR = "https://www.jblanked.com/news/api/mql5/calendar/week/";
export const FF_CALENDAR = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";
const encoder = new TextEncoder();
const issue = (code) => Object.assign(new Error(code), { code });
const textValue = (value) => value == null || /^(?:n\/a|none|null|nan|)$/i.test(String(value).trim()) || typeof value === "number" && (!Number.isFinite(value) || Math.abs(value) >= 1e15) ? null : String(value).slice(0, 100);

export function calendarTime(value, zone) {
  const input = String(value || "").trim().replace(/^(\d{4}-\d\d-\d\d) /, "$1T");
  if (/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?(?:Z|[+-]\d\d:\d\d)$/i.test(input)) {
    const parts = input.match(/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)(?::(\d\d))?/i).slice(1).map((v) => Number(v || 0));
    const [year, month, day, hour, minute, second] = parts, calendar = new Date(Date.UTC(year, month - 1, day));
    if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() + 1 !== month || calendar.getUTCDate() !== day || hour > 23 || minute > 59 || second > 59) throw issue("invalid_date");
    const result = Date.parse(input) / 1000;
    if (!Number.isFinite(result)) throw issue("invalid_date");
    return Math.floor(result);
  }
  const part = /^(\d{4})[.-](\d\d)[.-](\d\d)[ T](\d\d):(\d\d)(?::(\d\d))?$/.exec(input);
  if (!part) throw issue("invalid_date");
  const [y, m, d, h, min, sec] = part.slice(1).map((s) => Number(s || 0));
  const wall = Date.UTC(y, m - 1, d, h, min, sec);
  const check = new Date(wall);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() + 1 !== m || check.getUTCDate() !== d || h > 23 || min > 59 || sec > 59) throw issue("invalid_date");
  // Час без зона не става UTC по предположение. Първо се потвърждава зоната на източника.
  if (!zone) throw issue("timezone_required");
  let formatter;
  try { formatter = new Intl.DateTimeFormat("en-GB", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }); }
  catch (_) { throw issue("timezone_invalid"); }
  const project = (t) => {
    const p = Object.fromEntries(formatter.formatToParts(new Date(t)).map((v) => [v.type, v.value]));
    return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  };
  let guess = wall;
  for (let i = 0; i < 5; i++) {
    const correction = wall - project(guess);
    if (!correction) {
      if (project(guess - 3600000) === wall || project(guess + 3600000) === wall) throw issue("ambiguous_date");
      return guess / 1000;
    }
    guess += correction;
  }
  throw issue("invalid_date");
}

export async function parseCalendar(data, source, now, zone) {
  if (!Array.isArray(data) || !data.length || data.length > 5000) throw issue("invalid_calendar");
  const events = new Map();
  for (const row of data) {
    if (!row || typeof row !== "object") throw issue("invalid_calendar");
    const title = String(source === "jbnews" ? row.Name ?? "" : row.title ?? "").trim().slice(0, 300);
    const currency = String(source === "jbnews" ? row.Currency ?? "" : row.country ?? "").trim().toUpperCase();
    if (!title || !/^[A-Z]{3}$/.test(currency)) throw issue("invalid_calendar");
    const time = calendarTime(source === "jbnews" ? row.Date : row.date, source === "jbnews" ? zone : null);
    if (time < now - 14 * 86400 || time > now + 14 * 86400) throw issue("wrong_calendar_week");
    const impactRaw = String(source === "jbnews" ? row.Impact ?? "" : row.impact ?? "").trim().toLowerCase();
    const impact = ({ high: "high", medium: "medium", moderate: "medium", low: "low", holiday: "holiday", none: "low", "0": "low", "1": "low", "2": "medium", "3": "high" })[impactRaw];
    if (!impact) throw issue("unknown_impact");
    const digest = await crypto.subtle.digest("SHA-1", encoder.encode(title + "|" + currency + "|" + time));
    const id = [...new Uint8Array(digest)].map((v) => v.toString(16).padStart(2, "0")).join("").slice(0, 12);
    events.set(id, { id, title, currency, time, impact,
      source: source === "jbnews" ? "MQL5 · чрез JB-News" : "ForexFactory — седмичен календар",
      forecast: textValue(source === "jbnews" ? row.Forecast : row.forecast),
      previous: textValue(source === "jbnews" ? row.Previous : row.previous),
      actual: time > now ? null : textValue(source === "jbnews" ? row.Actual : row.actual) });
  }
  return [...events.values()].sort((a, b) => a.time - b.time);
}

export function newsInterval(env) { return env.JBLANKED_API_KEY ? 900 : 3600; }
export function newsMode(env) { return (env.JBLANKED_API_KEY ? "jbnews:" : "ff:") + (env.JBLANKED_TIMEZONE || ""); }

/** Трайни паузи за всеки източник. Дори ръчната проверка не ги заобикаля. */
export async function fetchCalendar(env, state, deps) {
  const providers = state.calendar_providers ||= {}, now = deps.now();
  let attempted = false;
  const sources = env.JBLANKED_API_KEY ? ["jbnews", "forexfactory"] : ["forexfactory"];
  for (const source of sources) {
    const p = providers[source] ||= {};
    if (source === "jbnews") {
      const hash = await crypto.subtle.digest("SHA-256", encoder.encode(env.JBLANKED_API_KEY));
      const tag = [...new Uint8Array(hash).slice(0, 8)].map((v) => v.toString(16).padStart(2, "0")).join("");
      if (p.tag !== tag) { p.tag = tag; p.blocked = 0; p.problem = null; }
    }
    if ((p.blocked || 0) > now || p.attempt && now - p.attempt < (source === "jbnews" ? 300 : 3600)) continue;
    attempted = true; p.attempt = now; p.problem = null; await deps.save();
    try {
      const response = await deps.fetch(source === "jbnews" ? JB_CALENDAR : FF_CALENDAR, {
        headers: source === "jbnews" ? { Accept: "application/json", Authorization: "Api-Key " + env.JBLANKED_API_KEY } : { Accept: "application/json" },
        signal: AbortSignal.timeout(20000),
      });
      p.http = response.status;
      if (!response.ok) {
        const retry = Math.min(86400, Math.max(source === "jbnews" ? 300 : 3600, Number(response.headers.get("Retry-After")) || 0));
        p.blocked = now + (response.status === 401 || response.status === 403 ? 3600 : retry);
        await response.body?.cancel();
        throw issue(response.status === 401 || response.status === 403 ? "access_denied" : response.status === 429 ? "rate_limited" : "http_error");
      }
      const raw = await response.text();
      if (encoder.encode(raw).length > 4 * 1024 * 1024) throw issue("response_size");
      if (source === "jbnews" && raw.includes(env.JBLANKED_API_KEY)) throw issue("invalid_calendar");
      let data;
      try { data = JSON.parse(raw); } catch (_) { throw issue("invalid_json"); }
      if (source === "jbnews" && Array.isArray(data)) p.samples = data.slice(0, 5).map((r) => ({ title: String(r?.Name ?? "").slice(0, 150), currency: String(r?.Currency ?? "").slice(0, 3), date: String(r?.Date ?? "").slice(0, 40) }));
      const events = await parseCalendar(data, source === "jbnews" ? "jbnews" : "forexfactory", now, env.JBLANKED_TIMEZONE);
      p.success = now; p.problem = null; p.blocked = 0; await deps.save();
      return { events, updated: now, provider: source };
    } catch (error) {
      p.problem = ["timezone_required", "timezone_invalid", "invalid_date", "ambiguous_date", "wrong_calendar_week", "unknown_impact", "invalid_calendar", "access_denied", "rate_limited", "http_error", "response_size", "invalid_json"].includes(error.code) ? error.code : "unavailable";
      await deps.save();
    }
  }
  return attempted ? null : { waiting: true };
}
