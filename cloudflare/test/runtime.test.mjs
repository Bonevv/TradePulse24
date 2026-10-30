import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

test("Cloudflare runtime: KV, SQLite coordinator, admin auth and conditional CORS reads", async () => {
  let outbound = 0;
  const token = "local-cloudflare-test-token-only";
  const mf = new Miniflare(convertV4MiniflareOptions({
    workers: [{ name: "feed",
    modules: ["worker.mjs", "feed.mjs", "admin.mjs"].map((file) => ({ type: "ESModule", path: fileURLToPath(new URL("../src/" + file, import.meta.url)) })),
    compatibilityDate: "2026-10-01", kvNamespaces: ["FEED"],
    durableObjects: { COORDINATOR: { className: "FeedCoordinator", useSQLite: true } },
    bindings: { ALLOWED_ORIGINS: "https://site.example", FEED_ADMIN_TOKEN: token },
    outboundService() { outbound++; return new Response("Unexpected network", { status: 500 }); },
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
  } finally { await mf.dispose(); }
});
