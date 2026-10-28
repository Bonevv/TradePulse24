"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const c = vm.createContext({ Date, Intl, Number, Set }); c.self = c;
vm.runInContext(fs.readFileSync(require("node:path").join(__dirname, "../assets/js/fx-calendar.js"), "utf8"), c);
const calendar = c.FX.calendar, now = Date.parse("2026-10-28T06:03:00Z") / 1000;
const events = [
  { id: "yesterday", time: now - 86400, impact: "high", currency: "USD", actual: "1" },
  { id: "elapsed", time: now - 60, impact: "high", currency: "USD", actual: null },
  { id: "zero", time: now - 120, impact: "medium", currency: "CAD", actual: 0 },
  { id: "future", time: now + 3600, impact: "high", currency: "USD", actual: "999" },
  { id: "tomorrow", time: now + 86400, impact: "medium", currency: "CAD" },
];
const options = { now, day: "today", levels: ["high", "medium"], currencies: null, showPast: false };
let view = calendar.view(events, options);
assert.equal(view.selected, "2026-10-28"); assert.deepEqual(Array.from(view.items, (e) => e.id), ["future"]);
assert.equal(view.past, 2); assert.equal(view.next.id, "future"); assert.equal(view.days.length, 7);
view = calendar.view(events, { ...options, showPast: true });
assert.deepEqual(Array.from(view.items, (e) => e.id), ["zero", "elapsed", "future"]);
assert.equal(calendar.resultKnown(events[1], now), false, "Elapsed time does not prove publication");
assert.equal(calendar.resultKnown(events[2], now), true, "Zero is a known result");
assert.equal(calendar.resultKnown(events[3], now), false, "Future actual is never shown as reported");
view = calendar.view(events, { ...options, day: "2026-10-29" });
assert.deepEqual(Array.from(view.items, (e) => e.id), ["tomorrow"]);
assert.match(calendar.label(view.selected, view.today), /Утре/);
assert.match(calendar.label(view.selected, view.today), /2026/);
assert.equal(calendar.view(events, { ...options, day: "2026-10-27" }).items.length, 0);
assert.equal(calendar.view(events, { ...options, currencies: ["CAD"] }).next.id, "tomorrow");
assert.equal(calendar.dayKey(Date.parse("2026-10-27T23:30:00Z") / 1000), "2026-10-28");
assert.equal(calendar.time(Date.parse("2026-07-01T06:00:00Z") / 1000), "09:00");
assert.equal(calendar.time(Date.parse("2026-10-28T06:00:00Z") / 1000), "08:00");
assert.equal(calendar.move("2026-10-25", 1), "2026-10-26", "Civil dates survive the DST transition");
assert.equal(calendar.view([], options).items.length, 0);
assert.equal(calendar.view(events, { ...options, now: now + 2 * 86400 }).selected, "2026-10-30", "Today follows midnight instead of freezing the initial date");
console.log("OK: selected civil date, past-event opt-in, unknown results, zero, future actual, filtered next event, Sofia midnight and DST");
