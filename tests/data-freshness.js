"use strict";
const assert = require("node:assert/strict");
const { loadFX, prices } = require("./helpers"), { FX } = loadFX();
const at = (text) => Date.parse(text) / 1000;
const hour = at("2026-10-28T08:00:00Z");
const bars = Array.from({ length: 4 }, (_, i) => [hour + i * 3600, 1, 1.2, .9, 1.1]);
assert.equal(FX.dropOpenH4(FX.toH4(bars.slice(0, 3)), bars.slice(0, 3)).length, 0, "The newest H4 waits for its last hour");
assert.equal(FX.dropOpenH4(FX.toH4(bars), bars).length, 1, "An H4 with its final hour is available");
assert.ok(FX.marketStatus(at("2026-11-06T21:30:00Z")).open, "Winter Friday remains open until 22:00 UTC");
assert.ok(!FX.marketStatus(at("2026-11-08T21:30:00Z")).open, "Winter Sunday opens at 22:00 UTC");

// D1 спира по-рано от M15 в тази история. Поръчката е изпълнена и затворена в M15
// преди крайния си срок. Минаването на срока не трябва да изтрие това изпълнение.
const data = prices(["USDJPY"]), strat = FX.CODED.find((s) => s.key === "fake2b");
const id = "fake2b-D1-USDJPY-1792713600";
for (const now of [at("2026-10-28T18:39:42Z"), at("2026-11-03T12:00:00Z")]) {
  const engine = new FX.Engine(data).build(now), result = engine.trades(strat, "D1");
  const trade = result.trades.find((row) => row.id === id);
  assert.equal(trade.status, "closed", "An elapsed deadline cannot overwrite an earlier fill and exit");
  assert.equal(trade.fill_time, 1792958400);
  assert.equal(trade.r, -.032);
}

// Без по-малки свещи няма доказан вход: след срока моделът се отменя.
const engine = new FX.Engine({}).build(at("2026-11-03T12:00:00Z"));
const pending = { status: "pending", valid_until: 100, pair: "USDJPY" };
engine.catchUp(pending, { pair: "USDJPY" }, strat);
assert.equal(pending.status, "cancelled");
assert.equal(pending.exit_time, 100);
console.log("OK: incomplete H4, winter market hours and preserved fills when quotes are stale past an order deadline");
