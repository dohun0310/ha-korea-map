// Shared fakes for SDK engine tests. These are unit fakes, NOT live SDKs.

// A minimal DOM element: attributes, inline style, children and listeners.
export function fakeElement(tag = "div", doc) {
  const attrs = new Map();
  const listeners = new Map();
  const el = {
    tagName: tag.toUpperCase(),
    localName: tag,
    style: {},
    dataset: {},
    children: [],
    parentNode: null,
    clientWidth: 800,
    clientHeight: 600,
    ownerDocument: doc,
    append(...nodes) {
      for (const node of nodes) {
        node.parentNode?.children && node.remove();
        this.children.push(node);
        node.parentNode = this;
      }
    },
    appendChild(node) {
      this.append(node);
      return node;
    },
    remove() {
      const parent = this.parentNode;
      if (parent?.children) {
        const index = parent.children.indexOf(this);
        if (index !== -1) parent.children.splice(index, 1);
      }
      this.parentNode = null;
    },
    contains(node) {
      for (let n = node; n; n = n.parentNode) if (n === this) return true;
      return false;
    },
    querySelector(selector) {
      const match = (n) => (selector === "a" ? n.localName === "a" : false);
      const walk = (n) => {
        for (const child of n.children || []) {
          if (match(child)) return child;
          const found = walk(child);
          if (found) return found;
        }
        return null;
      };
      return walk(this);
    },
    setAttribute(k, v) {
      attrs.set(k, String(v));
    },
    getAttribute(k) {
      return attrs.get(k) ?? null;
    },
    hasAttribute(k) {
      return attrs.has(k);
    },
    removeAttribute(k) {
      attrs.delete(k);
    },
    addEventListener(name, fn) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(fn);
    },
    removeEventListener(name, fn) {
      listeners.get(name)?.delete(fn);
    },
    listenerCount(name) {
      return listeners.get(name)?.size || 0;
    },
    dispatch(name, extra = {}) {
      const ev = {
        type: name,
        stopped: false,
        defaultPrevented: false,
        stopPropagation() {
          this.stopped = true;
        },
        preventDefault() {
          this.defaultPrevented = true;
        },
        ...extra,
      };
      for (let n = this; n && !ev.stopped; n = n.parentNode) {
        for (const fn of [...(n.listenerSet?.(name) || [])]) fn(ev);
      }
      return ev;
    },
    listenerSet(name) {
      return listeners.get(name);
    },
    focus() {
      doc.activeElement = this;
    },
  };
  return el;
}

// A fake document. Templates parse innerHTML inertly into text only.
export function fakeDocument() {
  const doc = { innerHTMLWrites: [], activeElement: null };
  doc.createElement = (tag) => {
    const el = fakeElement(tag, doc);
    let html = "";
    Object.defineProperty(el, "innerHTML", {
      get: () => html,
      set(value) {
        html = value;
        doc.innerHTMLWrites.push(tag);
      },
    });
    if (tag === "template") {
      el.content = {
        get textContent() {
          return html.replace(/<[^>]*>/g, "");
        },
      };
    }
    Object.defineProperty(el, "textContent", {
      get: () => (tag === "template" ? "" : html.replace(/<[^>]*>/g, "")),
      set(value) {
        html = String(value);
      },
    });
    return el;
  };
  return doc;
}

// A fake official SDK for "naver" or "google". Projection is Web Mercator at the
// map's zoom, relative to the map center, so pixel distances match a real map.
export function fakeSDK(provider, { maxZoom = 21 } = {}) {
  const made = [];
  const callbacks = new Map();
  const project = (lat, lng, zoom) => {
    const scale = 256 * 2 ** zoom;
    const sin = Math.sin((Math.max(-85.05, Math.min(85.05, lat)) * Math.PI) / 180);
    return {
      x: (lng / 360 + 0.5) * scale,
      y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
    };
  };
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
      this.map = o?.map;
      made.push(this);
    }
    setMap(m) {
      this.map = m;
    }
    setOptions(o) {
      Object.assign(this.o, o);
    }
  }
  const Event = {
    addListener(obj, name, fn) {
      const handle = { obj, name, fn, removed: false };
      if (!callbacks.has(obj)) callbacks.set(obj, []);
      callbacks.get(obj).push(handle);
      return handle;
    },
    removeListener(handle) {
      if (!handle) return;
      handle.removed = true;
      const list = callbacks.get(handle.obj) || [];
      const index = list.indexOf(handle);
      if (index !== -1) list.splice(index, 1);
    },
    clearInstanceListeners(obj) {
      callbacks.delete(obj);
    },
    trigger(obj, name, ...args) {
      for (const h of [...(callbacks.get(obj) || [])]) if (h.name === name) h.fn(...args);
    },
    count(obj, name) {
      return (callbacks.get(obj) || []).filter((h) => !name || h.name === name).length;
    },
  };
  class FakeMap extends Shape {
    constructor(el, o) {
      super(o);
      this.el = el;
      this.center = o.center;
      this.zoom = o.zoom;
      const doc = el.ownerDocument;
      // Tile pane plus overlay panes, siblings under one parent like the real SDKs.
      this.paneParent = doc.createElement("div");
      this.tilePane = doc.createElement("div");
      this.tilePane.append(doc.createElement("img"));
      this.panes =
        provider === "naver"
          ? {
              overlayLayer: doc.createElement("div"),
              overlayImage: doc.createElement("div"),
              floatPane: doc.createElement("div"),
            }
          : {
              overlayLayer: doc.createElement("div"),
              overlayMouseTarget: doc.createElement("div"),
              floatPane: doc.createElement("div"),
            };
      this.paneParent.append(this.tilePane, ...Object.values(this.panes));
      this.controls = doc.createElement("div");
      const logo = doc.createElement("a");
      logo.append(doc.createElement("img"));
      this.controls.append(logo);
      el.append(this.paneParent, this.controls);
      queueMicrotask(() => {
        if (!this.noFrame) Event.trigger(this, "tilesloaded");
      });
    }
    getCenter() {
      return this.center;
    }
    getZoom() {
      return this.zoom;
    }
    getMaxZoom() {
      return maxZoom;
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
    getPanes() {
      return this.panes;
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
    // Test helper: pixel of a location in the map's div at the current view.
    pixel(location) {
      const c = project(this.center.lat(), this.center.lng(), this.zoom);
      const p = project(location.lat(), location.lng(), this.zoom);
      return { x: p.x - c.x + 400, y: p.y - c.y + 300 };
    }
  }
  // Real Google maps have neither method; NAVER documents both.
  if (provider === "google") {
    delete FakeMap.prototype.getPanes;
    delete FakeMap.prototype.getMaxZoom;
  }
  class OverlayView {
    setMap(m) {
      if (this.map === m) return;
      if (this.map) this.onRemove();
      this.map = m;
      if (m) {
        this.onAdd();
        this.draw();
      }
    }
    getMap() {
      return this.map;
    }
    getPanes() {
      return this.map.panes;
    }
    getProjection() {
      const map = this.map;
      return {
        fromCoordToOffset: (p) => map.pixel(p),
        fromLatLngToDivPixel: (p) => map.pixel(p),
      };
    }
  }
  const sdk = {
    Map: FakeMap,
    LatLng,
    LatLngBounds: Bounds,
    OverlayView,
    Circle: Shape,
    Polyline: Shape,
    Size: class {
      constructor(w, h) {
        this.w = w;
        this.h = h;
      }
    },
    Event,
    event: Event,
    ColorScheme: { LIGHT: "LIGHT", DARK: "DARK", FOLLOW_SYSTEM: "FOLLOW_SYSTEM" },
  };
  return { sdk, made, Event, maps: () => made.filter((x) => x instanceof FakeMap) };
}

export const flush = () => new Promise((resolve) => setImmediate(resolve));

// Creates an initialised SDKEngine on a fake SDK. Caller must destroy() it.
export async function makeEngine(SDKEngine, provider, { config = {}, options = {}, sdk } = {}) {
  const fake = sdk || fakeSDK(provider);
  const doc = fakeDocument();
  const container = doc.createElement("div");
  const engine = new SDKEngine(provider, {
    key: "unit-public-key",
    optIn: true,
    loader: async () => fake.sdk,
    timeout: 50,
    ...config,
  });
  await engine.init(container, { center: [37.5, 127], zoom: 12, events: {}, ...options });
  const map = fake.maps().at(-1);
  return { engine, fake, doc, container, map };
}
