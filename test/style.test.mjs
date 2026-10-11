// Dark/light map style on provider maps. SDK objects are unit fakes, NOT live SDKs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SDKEngine, isDarkStyle, sdkURL } from "../config/www/ha-map-sdk.mjs";
import { MapRouter } from "../config/www/ha-map-router.mjs";
import { makeEngine } from "./fixtures.mjs";

const DARK = { palette: "colorful-dark" };
const LIGHT = { palette: "colorful" };

test("HA's resolved map style is dark exactly when its palette is a -dark palette", () => {
  assert.equal(isDarkStyle(DARK), true);
  assert.equal(isDarkStyle({ palette: "gray-dark", options: {} }), true);
  assert.equal(isDarkStyle(LIGHT), false);
  assert.equal(isDarkStyle(undefined), false);
  assert.equal(isDarkStyle({}), false);
});

test("google: official colorScheme follows HA's style at creation", async () => {
  for (const [style, scheme] of [
    [DARK, "DARK"],
    [LIGHT, "LIGHT"],
  ]) {
    const { engine, map } = await makeEngine(SDKEngine, "google", { options: { mapStyle: style } });
    assert.equal(map.o.colorScheme, scheme);
    engine.destroy();
  }
});

test("google: a theme change asks for a rebuild once, because colorScheme is creation-only", async () => {
  let restyles = 0;
  const { engine } = await makeEngine(SDKEngine, "google", {
    options: { mapStyle: LIGHT },
    config: { onRestyle: () => restyles++ },
  });
  engine.setMapStyle(LIGHT);
  assert.equal(restyles, 0);
  engine.setMapStyle(DARK);
  engine.setMapStyle(DARK);
  assert.equal(restyles, 1);
  engine.setMapStyle(LIGHT);
  assert.equal(restyles, 1, "back to the drawn scheme needs no rebuild");
  engine.destroy();
});

test("naver: absent style IDs keep the default map untouched in both modes", async () => {
  let restyles = 0;
  const { engine, map } = await makeEngine(SDKEngine, "naver", {
    options: { mapStyle: DARK },
    config: { onRestyle: () => restyles++ },
  });
  assert.equal(map.o.customStyleId, undefined);
  assert.equal(map.o.gl, undefined);
  engine.setMapStyle(LIGHT);
  engine.setMapStyle(DARK);
  for (const el of [map.tilePane, map.controls, map.el, ...Object.values(map.panes)])
    assert.equal(el.style.filter, undefined, "no CSS filter touches provider DOM");
  assert.equal(restyles, 0);
  engine.destroy();
});

test("naver: optional Style Editor ids use the GL submodule and rebuild on a theme change", async () => {
  let restyles = 0;
  const styleIds = { light: "unit-light-style", dark: "unit-dark-style" };
  const { engine, map } = await makeEngine(SDKEngine, "naver", {
    options: { mapStyle: DARK },
    config: { styleIds, onRestyle: () => restyles++ },
  });
  assert.equal(map.o.gl, true);
  assert.equal(map.o.customStyleId, "unit-dark-style");
  assert.equal(map.tilePane.style.filter, undefined, "no filter over an official style");
  engine.setMapStyle(LIGHT);
  assert.equal(restyles, 1);
  engine.destroy();
  const url = new URL(sdkURL("naver", "unit_public", "unitCallback", { submodules: "gl" }));
  assert.equal(url.searchParams.get("submodules"), "gl");
  assert.equal(url.searchParams.get("callback"), "unitCallback");
  assert.equal(new URL(sdkURL("naver", "unit_public", "x")).searchParams.has("submodules"), false);
});

test("naver: light style and a missing mode each pass only their own official options", async () => {
  for (const [style, styleIds, expected] of [
    [LIGHT, { light: "unit-light-style", dark: "unit-dark-style" }, "unit-light-style"],
    [DARK, { light: "unit-light-style" }, undefined],
  ]) {
    const { engine, map } = await makeEngine(SDKEngine, "naver", {
      options: { mapStyle: style }, config: { styleIds },
    });
    assert.equal(map.o.customStyleId, expected);
    assert.equal(map.o.gl, expected ? true : undefined);
    assert.equal(map.tilePane.style.filter, undefined);
    engine.destroy();
  }
});

function stubEngine(name, log) {
  return {
    name,
    dead: false,
    async init(container, options) {
      this.options = options;
      log.push(`init:${name}:${options.mapStyle?.palette}`);
    },
    destroy() {
      this.dead = true;
      log.push(`destroy:${name}`);
    },
    getView: () => ({ center: [37, 127], zoom: 10 }),
    setView() {},
    addMarker() {
      log.push(`marker:${name}`);
      return { remove() {} };
    },
    setClustering() {},
    setMapStyle(style) {
      this.style = style;
    },
    setZoomControlPosition() {},
    setScaleRuler() {},
    refreshClusters() {},
  };
}

test("router does not commit a stale theme when light returns during a dark rebuild", async () => {
  let release;
  let entered;
  const waiting = new Promise((resolve) => { entered = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  let builds = 0;
  const r = new MapRouter({
    nativeFactory: async () => stubEngine("native", []),
    providerFactory: (name, onFailure, onRestyle) => {
      const engine = stubEngine(name, []);
      const init = engine.init;
      const build = ++builds;
      engine.init = async (container, options) => {
        await init.call(engine, container, options);
        if (build === 2) { entered(); await gate; }
      };
      engine.setMapStyle = (style) => {
        if (style.palette !== engine.options.mapStyle.palette) onRestyle();
      };
      return engine;
    },
  });
  await r.init(stubContainer(), { center: [37, 127], zoom: 10, mapStyle: LIGHT, events: {} });
  await r.select("google");
  r.setMapStyle(DARK);
  await waiting;
  r.setMapStyle(LIGHT);
  release();
  for (let i = 0; i < 30; i++) await Promise.resolve();
  assert.equal(r.current.engine.options.mapStyle.palette, LIGHT.palette);
  assert.equal(r.current.engine.dead, false);
  assert.equal(r.diagnostics().pending, 0);
  assert.equal(r.diagnostics().safeMode, false);
  r.destroy();
});

function stubContainer() {
  const el = {
    style: {},
    appendChild() {},
    remove() {},
    ownerDocument: { createElement: () => stubContainer() },
  };
  return el;
}

test("router rebuilds the same provider on a restyle request and replays overlays", async () => {
  const log = [];
  const restyle = { calls: [] };
  const r = new MapRouter({
    nativeFactory: async () => stubEngine("native", log),
    providerFactory: (name, onFailure, onRestyle) => {
      restyle[name] = onRestyle;
      restyle.calls.push(onRestyle);
      return stubEngine(name, log);
    },
  });
  await r.init(stubContainer(), {
    center: [37, 127],
    zoom: 10,
    mapStyle: LIGHT,
    token: "UNIT_HA_TOKEN",
    events: {},
  });
  await r.select("google");
  const first = r.current.engine;
  assert.equal(first.options.mapStyle, LIGHT, "SDK engines receive HA's style");
  assert.equal(first.options.token, undefined, "but never the HA tile token");
  r.addMarker({}, [37, 127], {});
  r.setMapStyle(DARK);
  await restyle.google();
  assert.equal(r.diagnostics().provider, "google");
  assert.notEqual(r.current.engine, first);
  assert.equal(first.dead, true);
  assert.equal(r.current.engine.options.mapStyle, DARK);
  assert.equal(r.current.engine.style, DARK);
  assert.equal(log.filter((x) => x === "marker:google").length, 2);
  // A late request from the replaced engine does nothing.
  const current = r.current.engine;
  await restyle.calls[0]();
  assert.equal(r.current.engine, current);
  r.destroy();
});
