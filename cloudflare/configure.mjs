import { readFileSync, writeFileSync } from "node:fs";

// ID на KV не е тайна. Ключовете за доставчиците се задават отделно като Secrets.
const config = JSON.parse(readFileSync(new URL("wrangler.jsonc", import.meta.url), "utf8"));
const id = String(process.env.FEED_KV_ID || config.kv_namespaces[0].id).trim();
if (!/^[a-f0-9]{32}$/i.test(id) || /^0+$/.test(id)) {
  throw new Error("Създай KV namespace и задай неговото ID в build променливата FEED_KV_ID. Виж docs/cloudflare.md.");
}
config.kv_namespaces[0].id = id;
writeFileSync(new URL("wrangler.deploy.json", import.meta.url), JSON.stringify(config, null, 2) + "\n");
