import { test } from "node:test";
import assert from "node:assert/strict";
function container() {
  return {
    style: {},
    dataset: {},
    appendChild() {},
    remove() {},
    ownerDocument: { createElement: () => container() },
  };
}
function engine(name, { wait, fail } = {}) {
  return {
    name,
    removed: 0,
    dead: false,
    async init(c, o) {
      this.o = o;
      if (wait) await wait;
      if (fail) throw Error("injected");
    },
    destroy() {
      this.dead = true;
    },
    getView() {
      return { center: [37, 127], zoom: 10 };
    },
    setView() {},
    addMarker(el, p, o) {
      return { location: p, clusterData: o.clusterData, remove: () => this.removed++ };
    },
    addCircle(p, o) {
      return {
        update: (p, o) => {
          this.radius = o.radius;
        },
        remove: () => this.removed++,
      };
    },
    addPath() {
      return { update() {}, remove: () => this.removed++ };
    },
    setClustering() {},
    setMapStyle() {},
    setZoomControlPosition() {},
    setScaleRuler() {},
    refreshClusters() {},
  };
}
test("router preserves logical overlay handles across official switch and native safe recovery", async () => {
  const mod = await import("../config/www/ha-map-router.mjs").catch(() => ({}));
  assert.equal(typeof mod.MapRouter, "function", "router missing");
  const native = engine("native"),
    naver = engine("naver");
  const r = new mod.MapRouter({
    nativeFactory: async () => native,
    providerFactory: () => naver,
    provider: "native",
  });
  await r.init(container(), { center: [37, 127], zoom: 10, events: {} });
  const dom = {},
    h = r.addMarker(dom, [37, 127], { size: [20, 20] }),
    circle = r.addCircle([37, 127], { radius: 100, color: "red" });
  await r.select("naver");
  circle.update([37, 127], { radius: 150, color: "blue" });
  assert.equal(naver.radius, 150);
  assert.equal(r.diagnostics().provider, "naver");
  await r.recover();
  assert.equal(r.diagnostics().provider, "native");
  assert.equal(r.diagnostics().safeMode, true);
  h.remove();
  h.remove();
  circle.remove();
  assert.equal(r.diagnostics().records, 0);
  r.destroy();
});
test("router SDK failure returns fresh native and late init cannot commit", async () => {
  const { MapRouter } = await import("../config/www/ha-map-router.mjs");
  let nativeCount = 0,
    release;
  const wait = new Promise((r) => (release = r)),
    late = engine("naver", { wait });
  const r = new MapRouter({
    nativeFactory: async () => {
      nativeCount++;
      return engine("native");
    },
    providerFactory: () => late,
    timeout: 10,
  });
  await r.init(container(), { center: [37, 127], zoom: 10 });
  const p = r.select("naver");
  await p;
  assert.equal(r.diagnostics().provider, "native");
  assert.equal(r.diagnostics().safeMode, true);
  release();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(late.dead, true);
  assert.equal(nativeCount, 1, "healthy native should remain");
  r.destroy();
});
test("grouping toggle keeps the provider map and replays the clustering setting on switch", async () => {
  const { MapRouter } = await import("../config/www/ha-map-router.mjs");
  const made = [];
  const r = new MapRouter({
    nativeFactory: async () => engine("native"),
    providerFactory: (name) => {
      const e = engine(name);
      e.clusterCalls = [];
      e.setClustering = (o) => e.clusterCalls.push(o);
      made.push(e);
      return e;
    },
  });
  await r.init(container(), { center: [37, 127], zoom: 10 });
  assert.equal(await r.select("google"), true);
  const options = { radius: 40 };
  r.setClustering(options);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(r.diagnostics().provider, "google");
  assert.equal(r.diagnostics().safeMode, false);
  assert.equal(r.diagnostics().clustering, true);
  assert.deepEqual(made[0].clusterCalls, [null, options]);
  r.setClustering(null);
  assert.equal(r.diagnostics().clustering, false);
  r.setClustering(options);
  assert.equal(await r.select("naver"), true);
  assert.equal(r.diagnostics().provider, "naver");
  assert.deepEqual(made[1].clusterCalls, [options], "setting survives an engine switch");
  r.destroy();
});
test("router pending mutations replay latest circle and removed records stay removed", async () => {
  const { MapRouter } = await import("../config/www/ha-map-router.mjs");
  let release;
  const wait = new Promise((r) => (release = r)),
    candidate = engine("google", { wait });
  const r = new MapRouter({
    nativeFactory: async () => engine("native"),
    providerFactory: () => candidate,
  });
  await r.init(container(), { center: [37, 127], zoom: 10 });
  const h = r.addMarker({}, [37, 127], {}),
    c = r.addCircle([37, 127], { radius: 100 });
  const p = r.select("google");
  c.update([38, 128], { radius: 777 });
  h.remove();
  release();
  await p;
  assert.equal(r.diagnostics().records, 1);
  c.update([38, 128], { radius: 888 });
  assert.equal(candidate.radius, 888);
  r.destroy();
});
test("router camera changed during pending SDK startup is not reset on commit", async () => {
  const { MapRouter } = await import("../config/www/ha-map-router.mjs");
  let release;
  const wait = new Promise((r) => (release = r)),
    native = engine("native"),
    candidate = engine("google", { wait });
  native.setView = (center, zoom) => {
    native.view = { center, zoom };
  };
  native.getView = () => native.view || { center: [37, 127], zoom: 10 };
  candidate.setView = (center, zoom) => {
    candidate.view = { center, zoom };
  };
  candidate.getView = () => candidate.view;
  const r = new MapRouter({ nativeFactory: async () => native, providerFactory: () => candidate });
  await r.init(container(), { center: [37, 127], zoom: 10 });
  const p = r.select("google");
  r.setView([35, 129], 14);
  release();
  await p;
  assert.deepEqual(r.getView(), { center: [35, 129], zoom: 14 });
  r.destroy();
});
test("pending candidate is invisible until commit and destroy cancels late factory", async () => {
  const { MapRouter } = await import("../config/www/ha-map-router.mjs");
  let release;
  const late = engine("google"),
    factory = new Promise((r) => (release = r));
  const r = new MapRouter({
    nativeFactory: async () => engine("native"),
    providerFactory: () => factory,
  });
  await r.init(container(), { center: [37, 127], zoom: 10 });
  const p = r.select("google");
  assert.equal([...r.pending][0].stage.style.visibility, "hidden");
  r.destroy();
  release(late);
  assert.equal(await p, false);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(late.dead, true);
  assert.equal(r.diagnostics().provider, "none");
});
test("SDK fatal recovers fresh original even if native factory is already Leaflet; HA token never passed", async () => {
  const { MapRouter } = await import("../config/www/ha-map-router.mjs");
  let count = 0,
    fail;
  const candidate = engine("google");
  const r = new MapRouter({
    nativeFactory: async () => {
      count++;
      return engine("leaflet");
    },
    providerFactory: (name, onFailure) => {
      fail = onFailure;
      return candidate;
    },
    provider: "google",
  });
  await r.init(container(), {
    center: [37, 127],
    zoom: 10,
    token: "UNIT_HA_TOKEN_NOT_A_REAL_SECRET",
    rasterOnly: true,
  });
  assert.equal(candidate.o.token, undefined);
  assert.equal(candidate.o.rasterOnly, undefined);
  assert.equal(r.diagnostics().provider, "google");
  fail();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(r.diagnostics().provider, "native");
  assert.equal(r.current.engine.name, "leaflet");
  assert.equal(count, 2);
  assert.equal(r.diagnostics().safeMode, true);
  r.destroy();
});
