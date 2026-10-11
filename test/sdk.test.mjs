// SDK fakes below are unit contract tests, NOT live provider authentication.
import { test } from "node:test";
import assert from "node:assert/strict";
test("official SDK engine exports and requires opt-in before loading", async () => {
  const mod = await import("../config/www/ha-map-sdk.mjs").catch(() => ({}));
  assert.equal(typeof mod.SDKEngine, "function", "official SDK engine missing");
  let calls = 0;
  const e = new mod.SDKEngine("naver", {
    key: "unit-public-key",
    optIn: false,
    loader: async () => {
      calls++;
    },
  });
  await assert.rejects(e.init({}, {}));
  assert.equal(calls, 0);
});
function element() {
  const attrs = new Map();
  return {
    style: {},
    dataset: {},
    children: [],
    clientWidth: 800,
    clientHeight: 600,
    append(...xs) {
      this.children.push(...xs);
      for (const x of xs) x.parentNode = this;
    },
    appendChild(x) {
      this.append(x);
    },
    remove() {
      this.removed = true;
    },
    setAttribute(k, v) {
      attrs.set(k, v);
    },
    hasAttribute(k) {
      return attrs.has(k);
    },
    getAttribute(k) {
      return attrs.get(k) ?? null;
    },
    removeAttribute(k) {
      attrs.delete(k);
    },
    addEventListener() {},
    removeEventListener() {},
    ownerDocument: { createElement: () => element() },
  };
}
function sdkFixture(provider) {
  const made = [];
  const callbacks = new globalThis.Map();
  class LatLng {
    constructor(a, b) {
      this.a = a;
      this.b = b;
    }
    lat() {
      return this.a;
    }
    lng() {
      return this.b;
    }
  }
  class Bounds {
    constructor() {
      this.points = [];
    }
    extend(x) {
      this.points.push(x);
    }
    hasLatLng() {
      return true;
    }
    contains() {
      return true;
    }
  }
  class Shape {
    constructor(o) {
      this.o = o;
      made.push(this);
    }
    setMap(m) {
      this.map = m;
    }
    setOptions(o) {
      Object.assign(this.o, o);
    }
  }
  class Map extends Shape {
    constructor(el, o) {
      super(o);
      this.center = o.center;
      this.zoom = o.zoom;
      queueMicrotask(() => {
        if (this.noFrame) return;
        for (const x of callbacks.get(this) || [])
          if (["idle", "tilesloaded"].includes(x.name)) x.fn();
      });
    }
    getCenter() {
      return this.center;
    }
    getZoom() {
      return this.zoom;
    }
    setCenter(x) {
      this.center = x;
    }
    setZoom(z) {
      this.zoom = z;
    }
    getBounds() {
      return new Bounds();
    }
    fitBounds(b, p) {
      this.fit = [b, p];
    }
    panTo(x) {
      this.center = x;
    }
    destroy() {
      this.destroyed = true;
    }
  }
  class OverlayView {
    setMap(m) {
      this.map = m;
      if (m) {
        this.onAdd();
        this.draw();
      } else this.onRemove();
    }
    getPanes() {
      return provider === "naver"
        ? { overlayImage: element(), overlayLayer: element() }
        : { overlayMouseTarget: element(), overlayLayer: element() };
    }
    getProjection() {
      return {
        fromCoordToOffset: () => ({ x: 200, y: 300 }),
        fromLatLngToDivPixel: () => ({ x: 200, y: 300 }),
      };
    }
  }
  const Event = {
    addListener(obj, name, fn) {
      const x = { name, fn };
      callbacks.set(obj, [...(callbacks.get(obj) || []), x]);
      return { remove() {}, obj, x };
    },
    removeListener() {},
    clearInstanceListeners() {},
    trigger() {},
  };
  return {
    sdk: {
      Map,
      LatLng,
      LatLngBounds: Bounds,
      OverlayView,
      Circle: Shape,
      Polyline: Shape,
      Event,
      event: Event,
      Position: { TOP_LEFT: 1, TOP_RIGHT: 2, BOTTOM_LEFT: 3, BOTTOM_RIGHT: 4 },
      ControlPosition: { TOP_LEFT: 1, TOP_RIGHT: 2, BOTTOM_LEFT: 3, BOTTOM_RIGHT: 4 },
    },
    made,
    callbacks,
  };
}
test("SDK URL and loader consent use only official endpoint and refuse network without opt-in", async () => {
  const { sdkURL, loadOfficialSDK } = await import("../config/www/ha-map-sdk.mjs");
  const n = new URL(sdkURL("naver", "unit_public", "ignored")),
    g = new URL(sdkURL("google", "unit_public", "unitCallback"));
  assert.equal(n.origin, "https://oapi.map.naver.com");
  assert.equal(n.searchParams.get("ncpKeyId"), "unit_public");
  assert.equal(n.searchParams.has("ncpClientId"), false);
  assert.equal(g.origin, "https://maps.googleapis.com");
  assert.equal(g.searchParams.get("key"), "unit_public");
  let count = 0;
  await assert.rejects(
    loadOfficialSDK("google", {
      key: "unit_public",
      document: {
        createElement() {
          count++;
        },
      },
      optIn: false,
    }),
  );
  assert.equal(count, 0);
});
for (const provider of ["naver", "google"])
  test(`unit ${provider}: auth failure signals router and first-frame timeout rejects safely`, async () => {
    const { SDKEngine } = await import("../config/www/ha-map-sdk.mjs");
    const f = sdkFixture(provider),
      e = new SDKEngine(provider, {
        key: "unit_public",
        optIn: true,
        loader: async () => f.sdk,
        timeout: 10,
      });
    await e.init(element(), { center: [37, 127], zoom: 12, events: {} });
    let failed = 0;
    e.config.onFailure = () => failed++;
    globalThis[provider === "naver" ? "navermap_authFailure" : "gm_authFailure"]();
    assert.equal(failed, 1);
    e.destroy();
    const f2 = sdkFixture(provider);
    f2.sdk.Map = class extends f2.sdk.Map {
      constructor(c, o) {
        super(c, o);
        this.noFrame = true;
      }
    };
    const timeout = new SDKEngine(provider, {
      key: "unit_public",
      optIn: true,
      loader: async () => f2.sdk,
      timeout: 5,
    });
    const pending = timeout.init(element(), { center: [37, 127], zoom: 12 });
    await assert.rejects(pending);
    timeout.destroy();
  });
for (const provider of ["naver", "google"])
  test(`unit ${provider}: adapter creates SDK map, same DOM anchored marker, meter circle and path`, async () => {
    const { SDKEngine } = await import("../config/www/ha-map-sdk.mjs");
    const f = sdkFixture(provider),
      c = element();
    let drawn = 0;
    const e = new SDKEngine(provider, {
      key: "unit-public-key",
      optIn: true,
      loader: async () => f.sdk,
    });
    await e.init(c, { center: [37, 127], zoom: 12, events: { drawn: () => drawn++ } });
    assert.equal(f.made.length, 1, "must construct official SDK Map");
    assert.equal(drawn, 1);
    assert.deepEqual(e.getView(), { center: [37, 127], zoom: 12 });
    const dom = element(),
      h = e.addMarker(dom, [37, 127], {
        size: [40, 60],
        anchor: [20, 65],
        decoration: { radius: 123, color: "red" },
      });
    assert.equal(h.location[0], 37);
    assert.equal(f.made[1].o.radius, 123);
    assert.equal(dom.style.transform, undefined, "caller DOM styling must be preserved");
    assert.equal(dom.getAttribute("tabindex"), "0", "caller DOM must remain keyboard target");
    assert.equal(dom.parentNode.getAttribute("tabindex"), null, "wrapper must not steal focus");
    assert.equal(dom.parentNode.style.left, "180px");
    assert.equal(dom.parentNode.style.top, "235px");
    assert.equal(dom.parentNode.children[0], dom);
    const circle = e.addCircle([38, 128], { radius: 200, color: "blue" });
    circle.update([39, 129], { radius: 300, color: "green" });
    assert.equal(f.made.at(-1).o.radius, 300);
    const path = e.addPath({
      color: "red",
      segments: [
        {
          points: [
            [37, 127],
            [38, 128],
          ],
          opacity: 0.3,
        },
      ],
      markers: [{ location: [37, 127], tooltipHtml: "time" }],
    });
    path.update({ color: "blue", segments: [], markers: [] });
    path.remove();
    path.remove();
    h.remove();
    circle.remove();
    e.destroy();
    assert.equal(e.getView(), undefined);
  });
for (const provider of ["naver", "google"])
  test(`unit ${provider}: no zoom buttons or other built-in map controls are shown`, async () => {
    const { SDKEngine } = await import("../config/www/ha-map-sdk.mjs");
    const f = sdkFixture(provider),
      e = new SDKEngine(provider, { key: "unit_public", optIn: true, loader: async () => f.sdk });
    await e.init(element(), {
      center: [37, 127],
      zoom: 12,
      zoomControlPosition: "topright",
      events: {},
    });
    const map = f.made.find((x) => x instanceof f.sdk.Map);
    assert.equal(map.o.zoomControl, false, "zoom buttons hidden at creation");
    if (provider === "google") assert.equal(map.o.disableDefaultUI, true);
    e.setZoomControlPosition("bottomright");
    assert.equal(
      map.o.zoomControl,
      false,
      "HA asking for a zoom position must not bring the buttons back",
    );
    e.destroy();
  });
for (const provider of ["naver", "google"])
  test(`unit ${provider}: clustering leaves a lone unkeyed marker individually visible`, async () => {
    const { SDKEngine } = await import("../config/www/ha-map-sdk.mjs");
    const f = sdkFixture(provider),
      e = new SDKEngine(provider, { key: "unit_public", optIn: true, loader: async () => f.sdk });
    await e.init(element(), { center: [37, 127], zoom: 12, events: {} });
    const dom = element();
    const h = e.addMarker(dom, [37, 127], { size: [20, 20], cluster: true });
    assert.doesNotThrow(() => e.setClustering({ radius: 40, iconBuilder() {} }));
    assert.doesNotThrow(() => e.refreshClusters());
    assert.ok(dom.parentNode, "marker stays on the map");
    e.setClustering(null);
    h.remove();
    e.destroy();
  });
