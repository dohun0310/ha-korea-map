// Production entry: install paths (HACS /hacsfiles and manual /local), the key config outside
// the package folder, and a single start per page.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { bootstrap, packageUrls } from "../config/www/ha-korea-map.js";

const ORIGIN = "http://ha.test:8123";

test("HACS path: boundary resolves next to the module, config stays in /local outside the package", () => {
  const urls = packageUrls(`${ORIGIN}/hacsfiles/ha-korea-map/ha-korea-map.js?hacstag=12345`);
  assert.equal(
    urls.boundary,
    `${ORIGIN}/hacsfiles/ha-korea-map/ha-map-korea-boundary.geojson?v=auto-5`,
  );
  assert.equal(urls.config, `${ORIGIN}/local/ha-korea-map-config.mjs`);
});

test("manual path: /local/ha-korea-map/ keeps working", () => {
  const urls = packageUrls(`${ORIGIN}/local/ha-korea-map/ha-korea-map.js?v=auto-5`);
  assert.equal(
    urls.boundary,
    `${ORIGIN}/local/ha-korea-map/ha-map-korea-boundary.geojson?v=auto-5`,
  );
  assert.equal(urls.config, `${ORIGIN}/local/ha-korea-map-config.mjs`);
});

test("bootstrap fills in the packaged boundary and starts once per page", async () => {
  const scope = {};
  const starts = [];
  const start = async ({ config }) => {
    starts.push(config);
    return { installed: true };
  };
  const importConfig = async (url) => {
    assert.equal(url, `${ORIGIN}/local/ha-korea-map-config.mjs`);
    return { labConfig: { mode: "official", provider: "auto", providers: {} } };
  };
  const moduleUrl = `${ORIGIN}/hacsfiles/ha-korea-map/ha-korea-map.js?hacstag=1`;
  const first = bootstrap({ moduleUrl, scope, importConfig, start });
  const second = bootstrap({
    moduleUrl: `${ORIGIN}/local/ha-korea-map/ha-korea-map.js?v=auto-5`,
    scope,
    importConfig,
    start,
  });
  assert.equal(first, second);
  assert.deepEqual(await first, { installed: true });
  assert.equal(starts.length, 1);
  assert.equal(
    starts[0].boundary.url,
    `${ORIGIN}/hacsfiles/ha-korea-map/ha-map-korea-boundary.geojson?v=auto-5`,
  );
  assert.equal(scope.haMapExtension.installed, true);
});

test("an explicit boundary URL in the config is kept", async () => {
  let seen;
  await bootstrap({
    moduleUrl: `${ORIGIN}/local/ha-korea-map/ha-korea-map.js`,
    scope: {},
    importConfig: async () => ({ labConfig: { boundary: { url: "/local/custom.geojson" } } }),
    start: async ({ config }) => {
      seen = config.boundary.url;
      return { installed: true };
    },
  });
  assert.equal(seen, "/local/custom.geojson");
});

test("a missing config file leaves HA's map untouched instead of throwing", async () => {
  let started = false;
  const ctl = await bootstrap({
    moduleUrl: `${ORIGIN}/hacsfiles/ha-korea-map/ha-korea-map.js`,
    scope: {},
    importConfig: async () => {
      throw new TypeError("Failed to fetch dynamically imported module");
    },
    start: async () => {
      started = true;
    },
  });
  assert.equal(ctl.installed, false);
  assert.equal(ctl.reason, "config-unavailable");
  assert.equal(started, false);
  assert.doesNotThrow(() => ctl.uninstall());
});

test("dist is flat for HACS and every relative import resolves to a shipped file", () => {
  const dist = new URL("../dist/", import.meta.url);
  const names = readdirSync(dist);
  for (const required of [
    "ha-korea-map.js",
    "ha-map-extension.mjs",
    "ha-map-router.mjs",
    "ha-map-sdk.mjs",
    "ha-map-cluster.mjs",
    "ha-map-auto.mjs",
    "ha-map-korea-boundary.geojson",
  ])
    assert.ok(names.includes(required), required);
  for (const name of names.filter((n) => /\.m?js$/.test(n))) {
    const text = readFileSync(new URL(name, dist), "utf8");
    for (const [, spec] of text.matchAll(/(?:import|from)\s*\(?\s*"([^"]+)"/g)) {
      assert.ok(spec.startsWith("./"), `${name} imports ${spec} relatively`);
      const file = spec.slice(2).split("?")[0];
      assert.ok(existsSync(new URL(file, dist)), `${name} -> ${file}`);
    }
  }
});
