import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, copyFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

test("Публикуването изисква истинско KV ID и не добавя ключове в конфигурацията", () => {
  const folder = mkdtempSync(join(tmpdir(), "tp24-build-"));
  try {
    for (const file of ["configure.mjs", "wrangler.jsonc"]) copyFileSync(new URL("../" + file, import.meta.url), join(folder, file));
    const run = (id) => spawnSync(process.execPath, [join(folder, "configure.mjs")], { encoding: "utf8", env: { ...process.env, FEED_KV_ID: id } });
    assert.notEqual(run("").status, 0);
    assert.notEqual(run("not-a-namespace-id").status, 0);
    assert.equal(run("1234567890abcdef1234567890abcdef").status, 0);
    const config = JSON.parse(readFileSync(join(folder, "wrangler.deploy.json"), "utf8"));
    assert.equal(config.kv_namespaces[0].id, "1234567890abcdef1234567890abcdef");
    assert.equal(config.migrations[0].new_sqlite_classes[0], "FeedCoordinator");
    for (const name of ["TIINGO_API_KEY", "TWELVEDATA_API_KEY", "FEED_ADMIN_TOKEN"]) assert.equal(config.vars[name], undefined);
  } finally { rmSync(folder, { recursive: true, force: true }); }
});
