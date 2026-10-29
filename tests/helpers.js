"use strict";
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const root = path.resolve(__dirname, "..");
function loadFX() {
  const storage = new Map(), localStorage = { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) };
  const context = vm.createContext({ console, Date, Intl, Math, Number, Array, Set, Map, localStorage }); context.self = context;
  for (const match of fs.readFileSync(path.join(root, "index.html"), "utf8").matchAll(/<script src="(assets\/js\/fx-[^"]+)" defer><\/script>/g)) {
    const file = match[1].split("?")[0]; vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context, { filename: file });
  }
  return { FX: context.FX, context, storage };
}
function prices(pairs) {
  return Object.fromEntries(pairs.map((pair) => [pair, Object.fromEntries(["M15", "H1", "D1"].map((tf) => [tf, JSON.parse(fs.readFileSync(path.join(root, `data/prices/${pair}_${tf}.json`), "utf8")).bars]))]));
}
module.exports = { loadFX, prices, root };
