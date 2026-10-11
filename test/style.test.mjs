// Dark/light map style on provider maps. SDK objects are unit fakes, NOT live SDKs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SDKEngine, isDarkStyle, sdkURL, TILE_DARK_FILTER } from "../config/www/ha-map-sdk.mjs";
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

test("naver: dark mode filters only the tile layer, never overlays, logo or attribution", async () => {
  let restyles = 0;
  const { engine, map } = await makeEngine(SDKEngine, "naver", {
    options: { mapStyle: DARK },
    config: { onRestyle: () => restyles++ },
  });
  assert.equal(map.tilePane.style.filter, TILE_DARK_FILTER);
  for (const pane of Object.values(map.panes)) assert.equal(pane.style.filter, undefined);
  assert.equal(map.controls.style.filter, undefined);
  assert.equal(map.el.style.filter, undefined);
  engine.setMapStyle(LIGHT);
  assert.equal(map.tilePane.style.filter, "");
  engine.setMapStyle(DARK);
  assert.equal(map.tilePane.style.filter, TILE_DARK_FILTER);
  assert.equal(restyles, 0, "the filter changes at runtime without a rebuild");
  engine.destroy();
});

test("naver: a sibling holding a link or text is never filtered", async () => {
  const { engine, map, doc } = await makeEngine(SDKEngine, "naver", {
    options: { mapStyle: LIGHT },
  });
  const link = doc.createElement("div");
  link.append(doc.createElement("a"));
  const text = doc.createElement("div");
  text.textContent = "© NAVER Corp.";
  map.paneParent.append(link, text);
  engine.setMapStyle(DARK);
  assert.equal(link.style.filter, undefined);
  assert.equal(text.style.filter, undefined);
  assert.equal(map.tilePane.style.filter, TILE_DARK_FILTER);
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
