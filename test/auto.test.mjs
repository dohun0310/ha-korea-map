// Auto provider selection: Korea boundary => NAVER, overseas => Google.
// Engines below are unit fakes, NOT live SDKs. Boundary is the real generated file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const boundaryFC = JSON.parse(
  readFileSync(new URL("../config/www/ha-map-korea-boundary.geojson", import.meta.url)),
);
const geometry = boundaryFC.features[0].geometry;
const SEOUL = [37.5665, 126.978],
  TOKYO = [35.6762, 139.6503],
  BUSAN = [35.1796, 129.0756],
  DOKDO = [37.2414, 131.8689],
  TSUSHIMA = [34.4, 129.3],
  MARADO = [33.1167, 126.2667],
  FUKUOKA = [33.5904, 130.4017];
const flush = () => new Promise((r) => setImmediate(r));
function clock() {
  let t = 0,
    id = 0;
  const q = new Map();
  return {
    now: () => t,
    setTimeout(fn, ms) {
      const i = ++id;
      q.set(i, { at: t + ms, fn });
      return i;
    },
    clearTimeout(i) {
      q.delete(i);
    },
    setInterval() {
      return 0;
    },
    clearInterval() {},
    pending: () => q.size,
    async advance(ms) {
      const end = t + ms;
      for (;;) {
        await flush();
        let next = null;
        for (const [i, x] of q) if (x.at <= end && (!next || x.at < next[1].at)) next = [i, x];
        if (!next) break;
        q.delete(next[0]);
        t = next[1].at;
        next[1].fn();
      }
      t = end;
      await flush();
      await flush();
    },
  };
}
function container() {
  return {
    style: {},
    dataset: {},
    appendChild() {},
    remove() {},
    ownerDocument: { createElement: () => container() },
  };
}
function engine(name, log, { fail } = {}) {
  const e = {
    name,
    dead: false,
    view: null,
    markers: 0,
    async init(c, o) {
      this.o = o;
      this.view = { center: o.center, zoom: o.zoom };
      log.push("init:" + name);
      if (fail) throw Error("injected");
    },
    destroy() {
      this.dead = true;
      log.push("destroy:" + name);
    },
    getView() {
      return this.view && { center: [...this.view.center], zoom: this.view.zoom };
    },
    setView(c, z) {
      this.view = { center: c, zoom: z ?? this.view.zoom };
    },
    panTo(c) {
      this.view = { ...this.view, center: c };
    },
    setZoom(z) {
      this.view = { ...this.view, zoom: z };
    },
    fitBounds(points) {
      const lat = points.reduce((s, p) => s + p[0], 0) / points.length,
        lon = points.reduce((s, p) => s + p[1], 0) / points.length;
      this.view = { center: [lat, lon], zoom: 5 };
      this.fitted = points;
    },
    addMarker(el, p, o) {
      this.markers++;
      return { location: p, remove: () => this.markers-- };
    },
    addCircle() {
      return { update() {}, remove() {} };
    },
    addPath() {
      return { update() {}, remove() {} };
    },
    setClustering() {},
    setMapStyle() {},
    setZoomControlPosition() {},
    setScaleRuler() {},
    refreshClusters() {},
  };
  return e;
}
async function setup({
  center = SEOUL,
  boundary = Promise.resolve(geometry),
  fail = {},
  minInterval = 2000,
} = {}) {
  const auto = await import("../config/www/ha-map-auto.mjs").catch(() => ({}));
  assert.equal(typeof auto.AutoSwitch, "function", "auto switch module missing");
  const { MapRouter } = await import("../config/www/ha-map-router.mjs");
  const c = clock(),
    log = [],
    made = { native: 0, naver: 0, google: 0 };
  const r = new MapRouter({
    provider: "auto",
    nativeFactory: async () => {
      made.native++;
      return engine("native", log);
    },
    providerFactory: (name) => {
      made[name]++;
      return engine(name, log, { fail: fail[name] });
    },
  });
  const sw = new auto.AutoSwitch(r, { boundary, timers: c, poll: 0, minInterval });
  await r.init(container(), { center, zoom: 10, events: {} });
  return { r, sw, c, log, made, auto };
}
test("boundary point test: Seoul/Busan/Dokdo/Marado in, Tokyo/Tsushima/Fukuoka out; fit classification", async () => {
  const { pointInGeometry, classifyPoints } = await import("../config/www/ha-map-auto.mjs").catch(
    () => ({}),
  );
  assert.equal(typeof pointInGeometry, "function");
  for (const p of [SEOUL, BUSAN, DOKDO, MARADO])
    assert.equal(pointInGeometry(geometry, p), true, String(p));
  for (const p of [TOKYO, TSUSHIMA, FUKUOKA])
    assert.equal(pointInGeometry(geometry, p), false, String(p));
  assert.equal(classifyPoints(geometry, [SEOUL, BUSAN]), "korea");
  assert.equal(classifyPoints(geometry, [TOKYO, FUKUOKA]), "overseas");
  assert.equal(classifyPoints(geometry, [SEOUL, TOKYO]), "mixed");
  assert.equal(classifyPoints(geometry, []), null);
});
test("auto starts on NAVER in Korea, switches to Google after debounce when camera moves to Tokyo, preserving view and overlays", async () => {
  const { r, c, made } = await setup();
  assert.equal(r.diagnostics().provider, "naver");
  assert.equal(r.diagnostics().auto, true);
  assert.equal(r.diagnostics().decision, "korea");
  const m = r.addMarker({}, SEOUL, {});
  r.setView(TOKYO, 12);
  await c.advance(599);
  assert.equal(r.diagnostics().provider, "naver", "must debounce 600ms");
  await c.advance(10);
  assert.equal(r.diagnostics().provider, "google");
  assert.equal(r.diagnostics().decision, "overseas");
  assert.deepEqual(r.getView(), { center: TOKYO, zoom: 12 });
  assert.equal(r.current.engine.markers, 1);
  assert.equal(made.google, 1);
  m.remove();
  r.destroy();
});
test("NAVER clamps to its Korea maxBounds: a programmatic setView/panTo overseas still switches to Google and lands on the requested view", async () => {
  // Real NAVER Maps v3 ignores setCenter outside ~lat 32.1-38.6 / lng 124.3-131.97 (observed in lab).
  const { r, c } = await setup();
  const clamp = (e) => {
    const set = e.setView.bind(e),
      pan = e.panTo.bind(e),
      ok = (p) => p[0] >= 32.1 && p[0] <= 38.62 && p[1] >= 124.26 && p[1] <= 131.97;
    e.setView = (p, z) => {
      if (ok(p)) set(p, z);
    };
    e.panTo = (p) => {
      if (ok(p)) pan(p);
    };
  };
  clamp(r.current.engine);
  assert.equal(r.diagnostics().provider, "naver");
  r.setView(TOKYO, 12);
  await c.advance(650);
  assert.equal(r.diagnostics().provider, "google");
  assert.equal(r.diagnostics().decisionReason, "center-outside-korea");
  assert.deepEqual(r.getView(), { center: TOKYO, zoom: 12 });
  await c.advance(3000);
  r.panTo(SEOUL);
  await c.advance(650);
  assert.equal(r.diagnostics().provider, "naver");
  clamp(r.current.engine);
  await c.advance(3000);
  r.panTo(TOKYO);
  await c.advance(650);
  assert.equal(r.diagnostics().provider, "google");
  assert.deepEqual(r.getView().center, TOKYO);
  r.destroy();
});
test("rapid camera changes within debounce produce one switch and min interval defers a quick return", async () => {
  const { r, c, made } = await setup({ minInterval: 3000 });
  r.setView(TOKYO);
  await c.advance(200);
  r.setView(SEOUL);
  await c.advance(200);
  r.setView(TOKYO);
  await c.advance(650);
  assert.equal(r.diagnostics().provider, "google");
  assert.equal(made.google, 1);
  r.setView(SEOUL);
  await c.advance(700);
  assert.equal(r.diagnostics().provider, "google", "min switching interval");
  await c.advance(3000);
  assert.equal(r.diagnostics().provider, "naver");
  assert.equal(made.naver, 2);
  r.destroy();
});
test("fitBounds with mixed Korea/overseas targets selects Google even when the fit center is in Korea; user move resumes center rule", async () => {
  const { r, c } = await setup();
  const mixed = [SEOUL, [37.4, 126.9], [37.6, 127.1], TOKYO];
  r.fitBounds(mixed, {});
  await c.advance(700);
  assert.equal(r.diagnostics().provider, "google");
  assert.equal(r.diagnostics().decision, "mixed");
  assert.equal(r.diagnostics().decisionReason, "fit-mixed");
  assert.deepEqual(r.current.engine.fitted, mixed, "fit re-applied after switch");
  await c.advance(1500);
  r.current.engine.view.center = [...SEOUL];
  r.current.engine.o.events.moveStart();
  await c.advance(700);
  assert.equal(r.diagnostics().provider, "naver");
  assert.equal(r.diagnostics().decisionReason, "center-in-korea");
  r.destroy();
});
test("decisions during an in-flight switch are not re-entered", async () => {
  const auto = await import("../config/www/ha-map-auto.mjs");
  const { MapRouter } = await import("../config/www/ha-map-router.mjs");
  const c = clock();
  let release,
    inflight = 0,
    max = 0;
  const wait = new Promise((x) => (release = x));
  const r = new MapRouter({
    provider: "auto",
    nativeFactory: async () => engine("native", []),
    providerFactory: (name) => {
      const e = engine(name, []);
      const init = e.init.bind(e);
      e.init = async (...a) => {
        inflight++;
        max = Math.max(max, inflight);
        await init(...a);
        if (name === "google") await wait;
        inflight--;
      };
      return e;
    },
  });
  new auto.AutoSwitch(r, {
    boundary: Promise.resolve(geometry),
    timers: c,
    poll: 0,
    minInterval: 0,
  });
  await r.init(container(), { center: SEOUL, zoom: 10, events: {} });
  r.setView(TOKYO);
  await c.advance(650);
  assert.equal(r.pending.size, 1);
  r.setView([35.7, 139.7]);
  await c.advance(650);
  r.setView([35.6, 139.6]);
  await c.advance(650);
  assert.equal(r.pending.size, 1, "no second concurrent transition");
  release();
  await c.advance(10);
  assert.equal(r.diagnostics().provider, "google");
  assert.equal(max, 1);
  r.destroy();
});
test("manual provider choice disables auto; choosing auto re-enables it", async () => {
  const { r, c } = await setup();
  await r.choose("naver");
  assert.equal(r.diagnostics().auto, false);
  r.setView(TOKYO);
  await c.advance(5000);
  assert.equal(r.diagnostics().provider, "naver");
  await r.choose("auto");
  assert.equal(r.diagnostics().auto, true);
  assert.equal(r.diagnostics().provider, "google");
  await r.choose("native");
  assert.equal(r.diagnostics().provider, "native");
  assert.equal(r.diagnostics().auto, false);
  assert.equal(r.diagnostics().safeMode, false);
  r.destroy();
});
test("boundary load failure disables auto and keeps current map without SDK fetch", async () => {
  const { r, c, made } = await setup({ boundary: Promise.reject(Error("404")) });
  assert.equal(r.diagnostics().provider, "native");
  assert.equal(r.diagnostics().auto, false);
  assert.equal(r.diagnostics().autoState, "boundary-unavailable");
  r.setView(TOKYO);
  await c.advance(5000);
  assert.equal(made.naver + made.google, 0);
  assert.equal(await r.choose("auto"), false);
  r.destroy();
});
test("late boundary after destroy never constructs an SDK engine", async () => {
  const auto = await import("../config/www/ha-map-auto.mjs");
  const { MapRouter } = await import("../config/www/ha-map-router.mjs");
  let release;
  const late = new Promise((x) => (release = x)),
    c = clock();
  let made = 0;
  const r = new MapRouter({
    provider: "auto",
    nativeFactory: async () => engine("native", []),
    providerFactory: (n) => {
      made++;
      return engine(n, []);
    },
  });
  new auto.AutoSwitch(r, { boundary: late, timers: c, poll: 0 });
  const p = r.init(container(), { center: SEOUL, zoom: 10, events: {} });
  await flush();
  r.destroy();
  release(geometry);
  await p;
  await c.advance(5000);
  assert.equal(made, 0);
  assert.equal(c.pending(), 0);
});
test("SDK failure in auto falls back to native safe mode and stops auto retries until resumed", async () => {
  const { r, c, made } = await setup({ fail: { naver: true } });
  assert.equal(r.diagnostics().provider, "native");
  assert.equal(r.diagnostics().safeMode, true);
  assert.equal(r.diagnostics().auto, false);
  assert.equal(r.diagnostics().autoDisabledReason, "safe-mode");
  r.setView(BUSAN);
  await c.advance(5000);
  assert.equal(made.naver, 1, "no retry loop");
  r.setView(TOKYO);
  await c.advance(5000);
  assert.equal(made.google, 0, "location change alone does not resume auto");
  await r.resume();
  assert.equal(r.diagnostics().auto, true);
  assert.equal(r.diagnostics().provider, "google");
  r.destroy();
});
test("diagnostics expose auto decision and reason but no coordinates or keys", async () => {
  const { r } = await setup();
  const d = r.diagnostics();
  assert.deepEqual(
    [d.auto, d.decision, d.decisionReason, d.autoState],
    [true, "korea", "center-in-korea", "ready"],
  );
  const text = JSON.stringify(d);
  assert.doesNotMatch(text, /37\.5|126\.9|key/i);
  r.destroy();
});
test("loadBoundary rejects malformed nested polygon coordinates before auto starts", async () => {
  const { loadBoundary } = await import("../config/www/ha-map-auto.mjs");
  const invalid = [
    { type: "Polygon", coordinates: [[]] },
    { type: "MultiPolygon", coordinates: [[]] },
    { type: "Polygon", coordinates: [[[0, 0], [1, 1], [2, 2], [null, 0]]] },
    { type: "Polygon", coordinates: [[[0, 0], [1, 1], [2, 2], [181, 0]]] },
  ];
  for (const [i, geometry] of invalid.entries()) {
    await assert.rejects(loadBoundary(`/invalid-nested-${i}.geojson`, {
      fetch: async () => ({ ok: true, json: async () => geometry }),
    }), /boundary-invalid/);
  }
});

test("loadBoundary validates GeoJSON and caches per URL", async () => {
  const { loadBoundary } = await import("../config/www/ha-map-auto.mjs");
  let calls = 0;
  const fetch = async (url) => {
    calls++;
    return { ok: url.includes("good"), json: async () => boundaryFC };
  };
  const g = await loadBoundary("/good.geojson", { fetch });
  assert.equal(g.type, "MultiPolygon");
  await loadBoundary("/good.geojson", { fetch });
  assert.equal(calls, 1);
  await assert.rejects(loadBoundary("/bad.geojson", { fetch }));
  await assert.rejects(
    loadBoundary("/good2.geojson", {
      fetch: async () => ({
        ok: true,
        json: async () => ({ type: "FeatureCollection", features: [] }),
      }),
    }),
  );
});
