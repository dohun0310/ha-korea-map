// Marker grouping on provider maps. SDK objects are unit fakes, NOT live SDKs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ClusterLayer, groupMarkers, staysTogether } from "../config/www/ha-map-cluster.mjs";
import { SDKEngine } from "../config/www/ha-map-sdk.mjs";
import { MapRouter } from "../config/www/ha-map-router.mjs";
import { makeEngine, fakeSDK } from "./fixtures.mjs";

// Manual timers so rebuild delays are deterministic and nothing is left running.
function timers() {
  let id = 0;
  const queue = new Map();
  return {
    setTimeout(fn, ms) {
      queue.set(++id, fn);
      return id;
    },
    clearTimeout(i) {
      queue.delete(i);
    },
    run() {
      const fns = [...queue.values()];
      queue.clear();
      fns.forEach((fn) => fn());
    },
    get size() {
      return queue.size;
    },
  };
}

const px = (points) => (location) => points[location.join()];

test("grouping: proximity within radius, keyed groups within groupRadius, wide keyed groups fall back", () => {
  const m = (id, key) => ({ location: [id, 0], handle: { id, key }, options: { cluster: true } });
  const a = m(1),
    b = m(2),
    c = m(3),
    far = m(4);
  const project = px({
    "1,0": { x: 0, y: 0 },
    "2,0": { x: 30, y: 0 },
    "3,0": { x: 60, y: 0 },
    "4,0": { x: 500, y: 0 },
  });
  const groups = groupMarkers([a, b, c, far], { radius: 40 }, project);
  assert.deepEqual(
    groups.map((g) => g.members.map((x) => x.handle.id)),
    [[1, 2, 3], [4]],
    "a chain of neighbours within the radius forms one group",
  );
  const z1 = m(1, "zone.home"),
    z2 = m(4, "zone.home");
  const keyed = groupMarkers(
    [z1, z2],
    { radius: 40, groupRadius: 600, groupKey: (h) => h.key },
    project,
  );
  assert.equal(keyed.length, 1);
  assert.equal(keyed[0].key, "zone.home");
  const wide = groupMarkers(
    [z1, z2],
    { radius: 40, groupRadius: 100, groupKey: (h) => h.key },
    project,
  );
  assert.equal(wide.length, 2);
  assert.equal(wide[0].key, undefined);
  const lone = groupMarkers([m(1, "zone.work")], { radius: 40, groupKey: (h) => h.key }, project);
  assert.equal(lone[0].key, "zone.work", "a lone zone occupant still forms a keyed group");
  assert.equal(
    staysTogether({ members: [a, b] }, { radius: 40 }, [
      { x: 0, y: 0 },
      { x: 39, y: 0 },
    ]),
    true,
  );
  assert.equal(
    staysTogether({ members: [a, b] }, { radius: 40 }, [
      { x: 0, y: 0 },
      { x: 41, y: 0 },
    ]),
    false,
  );
});

function element(doc) {
  return doc.createElement("div");
}

function iconBuilderLog(doc) {
  const calls = [];
  const builder = (members, location, key, expanded) => {
    const el = doc.createElement("div");
    calls.push({ ids: members.map((h) => h.clusterData?.id), key, expanded, el });
    return { element: el, size: [80, 50], anchor: [40, 62] };
  };
  return { calls, builder };
}

test("missing SDK projection never collapses distant markers into a fake origin group", () => {
  const t = timers();
  let ready = false;
  const shown = new Set();
  let icons = 0;
  const layer = new ClusterLayer({
    zoom: () => 12,
    maxZoom: () => 21,
    project: (p) => ready ? { x: p[0] * 1000, y: 0 } : undefined,
    show: (m) => shown.add(m), hide: (m) => shown.delete(m),
    place: () => ({ remove() {} }),
    setTimeout: t.setTimeout, clearTimeout: t.clearTimeout,
  });
  const markers = [0, 10].map((x) => ({
    location: [x, 0], options: { cluster: true }, handle: {}, element: {},
  }));
  markers.forEach((m) => layer.add(m));
  layer.setOptions({ radius: 40, iconBuilder: () => {
    icons++;
    return { element: {}, size: [20, 20] };
  } });
  assert.equal(icons, 0);
  assert.equal(shown.size, 2, "members stay available while the projection initializes");
  ready = true;
  layer.cameraChanged();
  t.run();
  assert.equal(layer.groups.length, 2, "idle retries at the same zoom when projection is ready");
  layer.destroy();
});

const near = [
  [37.5, 127.0],
  [37.5001, 127.0001],
  [37.5002, 127.0002],
];
const far = [36.0, 128.5];
// About a metre apart: still within the radius at the maximum zoom.
const tight = [
  [37.5, 127.0],
  [37.50001, 127.00001],
  [37.50002, 127.00002],
];

for (const provider of ["naver", "google"]) {
  test(`${provider}: overlapping keyed icons merge; keyboard activation and refresh remove listeners`, async () => {
    const t = timers();
    const { engine, map, doc } = await makeEngine(SDKEngine, provider, { config: { timers: t } });
    const els = near.slice(0, 2).map(() => element(doc));
    const handles = near.slice(0, 2).map((p, i) => engine.addMarker(els[i], p, {
      size: [48, 48], cluster: true, clusterData: { id: i, zone: `zone.${i}` },
      decoration: { radius: 10, color: "blue" },
    }));
    const { calls, builder } = iconBuilderLog(doc);
    const opts = { radius: 0, groupKey: (h) => h.clusterData.zone, iconBuilder: builder };
    engine.setClustering(opts);
    assert.deepEqual(calls.at(-1).ids, [0, 1]);
    assert.equal(calls.at(-1).key, undefined, "different pinned zones lose their pin when merged");
    const old = calls.at(-1).el;
    old.dispatch("keydown", { key: "Enter" });
    assert.ok(map.fit);
    handles[0].remove();
    engine.refreshClusters();
    assert.equal(els[1].parentNode.style.display, "", "last unkeyed member becomes visible");
    map.fit = undefined;
    old.dispatch("click");
    assert.equal(map.fit, undefined, "discarded icons no longer have activation listeners");
    engine.setClustering(null);
    assert.equal(els[1].parentNode.style.display, "");
    assert.ok(engine.items.size > 1, "visible marker has an accuracy circle");
    engine.setClustering(opts);
    assert.equal(engine.items.size, 1, "grouped marker releases its accuracy circle");
    engine.destroy();
    assert.equal(engine.items.size, 0);
    assert.equal(engine.clusters.options, null, "destroy releases HA's iconBuilder closure");
    assert.equal(engine.clusters.openAfter, undefined, "destroy releases activated members");
    assert.equal(t.size, 0);
  });

  test(`${provider}: groups nearby markers into HA's icon and hides, never destroys, the members`, async () => {
    const t = timers();
    const { engine, map, doc } = await makeEngine(SDKEngine, provider, { config: { timers: t } });
    const pane = provider === "naver" ? map.panes.overlayImage : map.panes.overlayMouseTarget;
    const els = [...near, far].map(() => element(doc));
    const handles = [...near, far].map((p, i) =>
      engine.addMarker(els[i], p, {
        size: [48, 48],
        cluster: true,
        title: `T${i}`,
        clusterData: { id: i },
      }),
    );
    for (const el of els)
      assert.notEqual(el.parentNode?.style.display, "", "waits for setClustering");
    const { calls, builder } = iconBuilderLog(doc);
    engine.setClustering({ radius: 40, iconBuilder: builder });
    assert.deepEqual(
      calls.map((c) => c.ids),
      [[0, 1, 2]],
    );
    assert.equal(calls[0].expanded, false);
    const icon = calls[0].el;
    assert.ok(pane.contains(icon), "icon placed on the marker pane");
    assert.equal(icon.style.width, "80px");
    assert.equal(icon.getAttribute("role"), "button");
    assert.equal(icon.getAttribute("aria-label"), "T0, T1, T2");
    for (const el of els.slice(0, 3))
      assert.ok(!el.parentNode || el.parentNode.style.display === "none", "member hidden");
    assert.equal(els[3].parentNode.style.display, "", "far marker shows on its own");
    assert.equal(engine.clusterMode(), "grouped");
    // Grouping off: icon removed, every original element visible again.
    engine.setClustering(null);
    assert.equal(pane.contains(icon), false);
    for (const el of els) assert.equal(el.parentNode.style.display, "");
    // Grouping on again: shown members are hidden in place, not destroyed or detached.
    engine.setClustering({ radius: 40, iconBuilder: builder });
    for (const el of els.slice(0, 3)) {
      assert.equal(el.parentNode.style.display, "none");
      assert.ok(pane.contains(el));
    }
    handles.forEach((h) => h.remove());
    engine.destroy();
    assert.equal(t.size, 0);
  });

  test(`${provider}: activating an icon fits its members and opens it at the maximum zoom`, async () => {
    const t = timers();
    const { engine, map, doc, fake } = await makeEngine(SDKEngine, provider, {
      config: { timers: t },
    });
    tight.forEach((p, i) =>
      engine.addMarker(element(doc), p, { size: [48, 48], cluster: true, clusterData: { id: i } }),
    );
    const { calls, builder } = iconBuilderLog(doc);
    engine.setClustering({ radius: 40, iconBuilder: builder });
    const ev = calls[0].el.dispatch("click");
    assert.equal(ev.stopped, true, "the click does not reach the map");
    assert.ok(map.fit, "fitBounds called on the SDK map");
    // The SDK settles at its maximum zoom; idle triggers a regroup there.
    map.zoom = 21;
    fake.Event.trigger(map, "idle");
    t.run();
    assert.equal(calls.at(-1).expanded, true);
    assert.equal(calls.at(-1).el.getAttribute("role"), "group");
    engine.destroy();
  });

  test(`${provider}: zooming in parts a group after the camera settles`, async () => {
    const t = timers();
    const { engine, map, doc, fake } = await makeEngine(SDKEngine, provider, {
      config: { timers: t },
    });
    near.forEach((p, i) =>
      engine.addMarker(element(doc), p, { size: [48, 48], cluster: true, clusterData: { id: i } }),
    );
    const { calls, builder } = iconBuilderLog(doc);
    engine.setClustering({ radius: 40, iconBuilder: builder });
    assert.equal(calls.length, 1);
    fake.Event.trigger(map, "idle");
    t.run();
    assert.equal(calls.length, 1, "idle at the same zoom does not rebuild icons");
    map.zoom = 20;
    fake.Event.trigger(map, "zoom_changed");
    fake.Event.trigger(map, "idle");
    t.run();
    assert.equal(calls.length, 1, "no new icon: the members are now apart");
    engine.destroy();
    assert.equal(t.size, 0, "destroy clears the pending rebuild");
  });

  test(`${provider}: caller marker listeners survive repeated grouping toggles`, async () => {
    const { engine, doc } = await makeEngine(SDKEngine, provider);
    let hits = 0;
    const el = element(doc);
    el.addEventListener("click", () => hits++);
    engine.addMarker(el, near[0], { cluster: true, size: [48, 48] });
    engine.addMarker(element(doc), near[1], { cluster: true, size: [48, 48] });
    const { builder } = iconBuilderLog(doc);
    for (let i = 0; i < 3; i++) {
      engine.setClustering({ radius: 40, iconBuilder: builder });
      engine.setClustering(null);
      el.dispatch("click");
    }
    assert.equal(hits, 3);
    engine.destroy();
    el.dispatch("click");
    assert.equal(hits, 4, "engine teardown never removes caller listeners");
  });
}

test("router keeps the provider and its groups when grouping is toggled and engines switch", async () => {
  const t = timers();
  const sdk = { naver: fakeSDK("naver"), google: fakeSDK("google") };
  const doc = (await import("./fixtures.mjs")).fakeDocument();
  const r = new MapRouter({
    nativeFactory: async () => ({
      init: async () => {},
      destroy() {},
      getView: () => ({ center: [37.5, 127], zoom: 12 }),
      addMarker: () => ({ remove() {} }),
      setClustering() {},
      setMapStyle() {},
      setZoomControlPosition() {},
      setScaleRuler() {},
      refreshClusters() {},
    }),
    providerFactory: (name) =>
      new SDKEngine(name, {
        key: "unit-public-key",
        optIn: true,
        loader: async () => sdk[name].sdk,
        timers: t,
        timeout: 50,
      }),
  });
  await r.init(doc.createElement("div"), { center: [37.5, 127], zoom: 12, events: {} });
  assert.equal(await r.select("naver"), true);
  near.forEach((p, i) =>
    r.addMarker(element(doc), p, { size: [48, 48], cluster: true, clusterData: { id: i } }),
  );
  const { calls, builder } = iconBuilderLog(doc);
  r.setClustering({ radius: 40, iconBuilder: builder });
  assert.equal(calls.length, 1);
  assert.equal(r.diagnostics().clusterRendering, "grouped");
  r.setClustering(null);
  r.setClustering({ radius: 40, iconBuilder: builder });
  assert.equal(r.diagnostics().provider, "naver");
  assert.equal(r.diagnostics().safeMode, false);
  assert.equal(await r.select("google"), true);
  assert.equal(calls.length, 3, "the new engine groups again with the kept setting");
  assert.equal(r.diagnostics().provider, "google");
  r.destroy();
  assert.equal(t.size, 0);
});
