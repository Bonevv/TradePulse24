import { FeedService, PAIRS } from "./feed.mjs";
import { ADMIN_HTML } from "./admin.mjs";

const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
const coordinator = (env, action) => env.COORDINATOR.get(env.COORDINATOR.idFromName("main-feed-v1"))
  .fetch(new Request("https://feed.internal/" + action, { method: "POST" }));

async function authorized(request, env) {
  const wanted = String(env.FEED_ADMIN_TOKEN || ""), given = request.headers.get("Authorization") || "";
  if (wanted.length < 24 || given.length > 1024 || !given.startsWith("Bearer ")) return false;
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([wanted, given.slice(7)].map(async (value) => new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)))));
  let diff = 0; for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export class FeedCoordinator {
  constructor(ctx, env) { this.feed = new FeedService(env, ctx.storage); }
  async fetch(request) {
    try {
      if (request.method !== "POST") return json({ ok: false }, 405);
      const action = new URL(request.url).pathname;
      if (action === "/tick") return json(await this.feed.tick());
      if (action === "/seed") return json(await this.feed.seed());
      if (action === "/status") return json(await this.feed.status());
      return json({ ok: false }, 404);
    } catch (_) { return json({ ok: false, error: "Задачата не завърши. Провери настройките и повтори след проверка на състоянието." }, 503); }
  }
}

export default {
  async scheduled(_event, env, ctx) {
    // Само един и същ Durable Object може да извиква доставчиците.
    ctx.waitUntil(coordinator(env, "tick").then((response) => { if (!response.ok) console.warn("Обновяването не е потвърдено."); }));
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url), path = url.pathname;
    try {
      if (path === "/admin" && request.method === "GET") return new Response(ADMIN_HTML, { headers: {
        "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
        "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'",
      } });
      if (path.startsWith("/admin/")) {
        if (request.method !== "POST") return json({ ok: false }, 405);
        if (!await authorized(request, env)) return json({ ok: false, error: "Нужен е административен достъп." }, 401);
        const action = ({ "/admin/status": "status", "/admin/seed": "seed", "/admin/refresh": "tick" })[path];
        return action ? await coordinator(env, action) : json({ ok: false }, 404);
      }
      const pair = /^\/history\/([A-Z]{6})$/.exec(path)?.[1];
      const key = path === "/snapshot" ? "snapshot" : PAIRS.includes(pair) ? "history/" + pair : null;
      if (!key) return json({ ok: false }, 404);
      const origin = request.headers.get("Origin"), allowed = new Set(String(env.ALLOWED_ORIGINS || "").split(/[\s,]+/).filter(Boolean));
      allowed.add(url.origin);
      if (origin && !allowed.has(origin)) return json({ ok: false }, 403);
      const cors = { "Vary": "Origin", "Access-Control-Expose-Headers": "ETag" };
      if (origin) cors["Access-Control-Allow-Origin"] = origin;
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...cors, "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS", "Access-Control-Allow-Headers": "If-None-Match, If-Modified-Since", "Access-Control-Max-Age": "600" } });
      if (!["GET", "HEAD"].includes(request.method)) return json({ ok: false }, 405);
      // Публичното четене никога не извиква координатора или доставчик.
      const cache = globalThis.caches?.default, cacheKey = new Request(url.origin + path);
      let response = cache ? await cache.match(cacheKey) : null;
      if (!response) {
        const record = await env.FEED.getWithMetadata(key, { type: "text", cacheTtl: 30 });
        if (!record.value) return new Response(JSON.stringify({ ok: false, error: "Данните още не са подготвени." }), { status: 503, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
        response = new Response(record.value, { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=30, s-maxage=30", "ETag": '"' + record.metadata.etag + '"' } });
        if (cache) ctx.waitUntil(cache.put(cacheKey, response.clone()));
      }
      const headers = new Headers(response.headers); for (const [name, value] of Object.entries(cors)) headers.set(name, value);
      if (request.headers.get("If-None-Match") === headers.get("ETag")) return new Response(null, { status: 304, headers });
      return new Response(request.method === "HEAD" ? null : response.body, { status: 200, headers });
    } catch (_) { return json({ ok: false, error: "Данните временно не са достъпни." }, 503); }
  },
};
