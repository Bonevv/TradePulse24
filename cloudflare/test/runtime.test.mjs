import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { PAIRS, SEED_BASE } from "../src/feed.mjs";

test("Cloudflare runtime: KV, SQLite coordinator, admin auth and conditional CORS reads", async () => {
  let outbound = 0, allowSeed = false;
  const token = "local-cloudflare-test-token-only";
  const mf = new Miniflare(convertV4MiniflareOptions({
    workers: [{ name: "feed",
    modules: ["worker.mjs", "feed.mjs", "admin.mjs"].map((file) => ({ type: "ESModule", path: fileURLToPath(new URL("../src/" + file, import.meta.url)) })),
    compatibilityDate: "2026-10-01", kvNamespaces: ["FEED"],
    durableObjects: { COORDINATOR: { className: "FeedCoordinator", useSQLite: true } },
    bindings: { ALLOWED_ORIGINS: "https://site.example", FEED_ADMIN_TOKEN: token },
    async outboundService(request) {
      outbound++;
      if (!allowSeed || !request.url.startsWith(SEED_BASE + "/")) return new Response("Unexpected network", { status: 500 });
      const name = new URL(request.url).pathname.split("/").at(-1);
      if (!/^[A-Z]{6}_(M15|H1|D1)\.json$/.test(name)) return new Response("Unexpected file", { status: 404 });
      return new Response(await readFile(new URL("../../data/prices/" + name, import.meta.url)));
    },
    }],
  }));
  try {
    let response = await mf.dispatchFetch("https://feed.example/admin/status", { method: "POST", headers: { Authorization: "Bearer " + token } });
    assert.equal(response.status, 200);
    const status = await response.json(); assert.equal(status.seeded, false); assert.equal(status.providers.tiingo.configured, false);
    response = await mf.dispatchFetch("https://feed.example/admin/refresh", { method: "POST" });
    assert.equal(response.status, 401);
    response = await mf.dispatchFetch("https://feed.example/admin/refresh", { method: "POST", headers: { Authorization: "Bearer " + token } });
    assert.equal((await response.json()).needs_seed, true);
    const kv = await mf.getKVNamespace("FEED");
    await kv.put("snapshot", JSON.stringify({ schema: "tradepulse-feed-v1", meta: { updated: 123 } }), { metadata: { etag: "test-etag" } });
    response = await mf.dispatchFetch("https://feed.example/snapshot", { headers: { Origin: "https://site.example" } });
    assert.equal(response.status, 200); assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://site.example");
    assert.equal((await response.json()).meta.updated, 123);
    response = await mf.dispatchFetch("https://feed.example/snapshot", { headers: { Origin: "https://site.example", "If-None-Match": '"test-etag"' } });
    assert.equal(response.status, 304);
    assert.equal(outbound, 0, "Anonymous reads and unauthorized admin calls never reach a provider");
    // Мокнатият FeedService не улавя изискването на runtime fetch за глобален this.
    // Затова целият внос минава през workerd, само с локални исторически отговори.
    allowSeed = true;
    response = await mf.dispatchFetch("https://feed.example/admin/seed", { method: "POST", headers: { Authorization: "Bearer " + token } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, imported: 8 });
    assert.equal(outbound, 24);
    for (const pair of PAIRS) {
      const archive = JSON.parse(await kv.get("history/" + pair));
      for (const tf of ["M15", "H1", "D1"]) {
        const original = JSON.parse(await readFile(new URL(`../../data/prices/${pair}_${tf}.json`, import.meta.url), "utf8"));
        assert.deepEqual(archive.prices[tf], original.bars);
      }
    }
    const snapshot = JSON.parse(await kv.get("snapshot"));
    assert.deepEqual(snapshot.meta.quotes, {});
    assert.equal(snapshot.meta.prices_updated, 0);
    response = await mf.dispatchFetch("https://feed.example/admin/status", { method: "POST", headers: { Authorization: "Bearer " + token } });
    assert.equal((await response.json()).seeded, true);
  } finally { await mf.dispose(); }
});
