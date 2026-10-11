// Official SDKs only. HA tile tokens never reach these loaders or SDK options.
const loads = new Map(),
  failureSets = { naver: new Set(), google: new Set() };
const authNames = { naver: "navermap_authFailure", google: "gm_authFailure" };
export function sdkURL(provider, key, callback, { submodules } = {}) {
  if (!["naver", "google"].includes(provider) || typeof key !== "string" || !key.trim())
    throw new Error("provider-key-missing");
  const u = new URL(
    provider === "naver"
      ? "https://oapi.map.naver.com/openapi/v3/maps.js"
      : "https://maps.googleapis.com/maps/api/js",
  );
  u.searchParams.set(provider === "naver" ? "ncpKeyId" : "key", key);
  if (provider === "google") {
    u.searchParams.set("v", "quarterly");
    u.searchParams.set("loading", "async");
    u.searchParams.set("callback", callback);
  } else if (submodules) {
    // NAVER calls the callback once the requested submodules have loaded too.
    u.searchParams.set("submodules", submodules);
    u.searchParams.set("callback", callback);
  }
  return u.href;
}
// HA resolves its map style per theme mode into a palette; dark palettes end in "-dark"
// (frontend 20260930.3 src/common/map/map-styles.ts paletteFor()).
export function isDarkStyle(style) {
  return typeof style?.palette === "string" && style.palette.endsWith("-dark");
}
function hasStyleIds(styleIds) {
  return !!(styleIds?.light || styleIds?.dark);
}
// The filter HA itself applies to raster tiles in dark mode (ha-map.ts, --map-filter).
export const TILE_DARK_FILTER =
  "invert(0.9) hue-rotate(170deg) brightness(1.5) contrast(1.2) saturate(0.3)";
function subscribeAuth(provider, fn) {
  const set = failureSets[provider],
    name = authNames[provider];
  if (!set.size) {
    const previous = globalThis[name];
    const handler = () => {
      for (const cb of [...set]) cb();
      if (typeof previous === "function") previous();
    };
    set.previous = previous;
    set.handler = handler;
    globalThis[name] = handler;
  }
  set.add(fn);
  return () => {
    set.delete(fn);
    if (!set.size && globalThis[name] === set.handler) {
      if (set.previous === undefined) delete globalThis[name];
      else globalThis[name] = set.previous;
    }
  };
}
export function loadOfficialSDK(
  provider,
  { key, optIn = false, timeout = 12000, document = globalThis.document, styleIds } = {},
) {
  if (!optIn || !key || !document) return Promise.reject(new Error("provider-not-enabled"));
  if (!["naver", "google"].includes(provider)) return Promise.reject(new Error("provider-unknown"));
  // Single owner per document. Different-key reload requires a full page reload.
  if (loads.has(provider)) {
    const entry = loads.get(provider);
    return entry.key === key
      ? entry.promise
      : Promise.reject(new Error("provider-key-change-reload"));
  }
  const callback = `__haMapSDK_${provider}`,
    script = document.createElement("script");
  const promise = new Promise((resolve, reject) => {
    let finished = false,
      timer,
      off;
    const done = (ok) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      off?.();
      script.onload = null;
      script.onerror = null;
      delete globalThis[callback];
      if (ok) {
        const sdk = provider === "naver" ? globalThis.naver?.maps : globalThis.google?.maps;
        if (sdk?.Map && sdk?.OverlayView) {
          resolve(sdk);
          return;
        }
      }
      script.remove();
      reject(new Error("provider-sdk-unavailable"));
    };
    off = subscribeAuth(provider, () => done(false));
    timer = setTimeout(() => done(false), timeout);
    globalThis[callback] = () => done(true);
    // NAVER Style Editor styles need the GL submodule (navermaps tutorial-2-Style-Editor).
    const submodules = provider === "naver" && hasStyleIds(styleIds) ? "gl" : undefined;
    script.async = true;
    script.src = sdkURL(provider, key, callback, { submodules });
    script.onerror = () => done(false);
    script.onload = () => {
      if (provider === "naver" && !submodules) done(true);
    };
    document.head.appendChild(script);
  });
  loads.set(provider, { key, promise });
  return promise;
}
// Tooltip HTML to plain text. A <template> parses inertly: no image loads or event
// handlers run, unlike innerHTML on a live element.
function htmlToText(document, html) {
  const template = document.createElement("template");
  template.innerHTML = String(html ?? "");
  return ((template.content ?? template).textContent || "").trim();
}
export class SDKEngine {
  constructor(provider, config = {}) {
    if (!["naver", "google"].includes(provider)) throw new Error("provider-unknown");
    this.provider = provider;
    this.config = config;
    this.items = new Set();
    this.listeners = [];
    this.dead = false;
  }
  async init(container, options) {
    if (!this.config.optIn || !this.config.key) throw new Error("provider-not-enabled");
    this.container = container;
    this.options = options;
    this.offAuth = subscribeAuth(this.provider, () => {
      this.cancelInit?.();
      this.config.onFailure?.();
    });
    this.sdk = await (this.config.loader || loadOfficialSDK)(this.provider, this.config);
    if (this.dead) throw new Error("provider-cancelled");
    const s = this.sdk;
    this.event = this.provider === "naver" ? s.Event : s.event;
    // The style the map is drawn with. Google's colorScheme and NAVER's customStyleId are
    // creation-time options, so a later theme change of those needs a new map (onRestyle).
    this.dark = isDarkStyle(options.mapStyle);
    this.drawnDark = this.dark;
    const styleId = this.styleId(this.dark);
    // No built-in buttons (zoom, map type, street view, fullscreen); pinch/wheel/double-click zoom still work.
    this.map = new s.Map(container, {
      center: this.coord(options.center),
      zoom: options.zoom,
      zoomControl: false,
      ...(this.provider === "google"
        ? {
            disableDefaultUI: true,
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: false,
            colorScheme: this.dark
              ? (s.ColorScheme?.DARK ?? "DARK")
              : (s.ColorScheme?.LIGHT ?? "LIGHT"),
          }
        : {
            scaleControl: false,
            mapTypeControl: false,
            ...(styleId ? { gl: true, customStyleId: styleId } : {}),
          }),
    });
    this.applyTileFilter();
    // NAVER may rebuild its tile layer; keep the filter on whatever layer is current.
    if (this.provider === "naver") this.listen("tilesloaded", () => this.applyTileFilter());
    this.listen("click", (ev) => {
      const p = this.provider === "naver" ? ev.coord : ev.latLng;
      if (p) options.events?.click?.([p.lat(), p.lng()]);
    });
    this.listen("zoom_changed", () => options.events?.zoomStart?.());
    this.listen("dragstart", () => options.events?.moveStart?.());
    // A script load isn't proof of geography: wait for SDK tilesloaded event.
    await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.cancelInit = undefined;
        ok ? resolve() : reject(new Error("provider-first-frame-failed"));
      };
      const timer = setTimeout(() => finish(false), this.config.timeout || 12000);
      this.cancelInit = () => finish(false);
      this.listen("tilesloaded", () => finish(true));
    });
    if (this.dead) throw new Error("provider-cancelled");
    options.events?.drawn?.();
  }
  coord(p) {
    return new this.sdk.LatLng(p[0], p[1]);
  }
  // Optional NAVER Style Editor id for a mode (config.styleIds = {light, dark}).
  styleId(dark) {
    return this.provider === "naver" ? this.config.styleIds?.[dark ? "dark" : "light"] : undefined;
  }
  // NAVER has no built-in dark map without a Style Editor id. Then the tile layer alone gets
  // HA's raster dark filter: the overlay panes (markers, circles, paths) and the controls
  // (logo, scale, attribution) are left untouched. The tile layer is found as the sibling of
  // NAVER's documented overlay panes; anything holding a link or text is skipped.
  applyTileFilter() {
    if (this.provider !== "naver" || !this.map?.getPanes) return;
    const panes = Object.values(this.map.getPanes() || {});
    const parent = panes[0]?.parentNode;
    if (!parent?.children) return;
    const filter = this.dark && !this.styleId(this.drawnDark) ? TILE_DARK_FILTER : "";
    for (const layer of [...parent.children]) {
      if (panes.includes(layer)) continue;
      if (layer.querySelector?.("a") || (layer.textContent || "").trim()) continue;
      if (filter || layer.style.filter) layer.style.filter = filter;
    }
  }
  listen(name, fn) {
    const h = this.event.addListener(this.map, name, fn);
    this.listeners.push(h);
    return h;
  }
  unlisten(h) {
    if (!h) return;
    this.event.removeListener(h);
    const index = this.listeners.indexOf(h);
    if (index !== -1) this.listeners.splice(index, 1);
  }
  tracked(handle) {
    this.items.add(handle);
    const remove = handle.remove;
    handle.remove = () => {
      if (!this.items.delete(handle)) return;
      remove();
    };
    return handle;
  }
  addMarker(element, location, options = {}) {
    const engine = this,
      s = this.sdk,
      wrapper = this.container.ownerDocument.createElement("div"),
      size = options.size || [0, 0],
      anchor = options.anchor || [size[0] / 2, size[1] / 2];
    Object.assign(wrapper.style, {
      position: "absolute",
      width: `${size[0]}px`,
      height: `${size[1]}px`,
      pointerEvents: options.interactive === false ? "none" : "auto",
      zIndex: options.raised ? "100" : "1",
    });
    const owned = [],
      savedSize = { width: element.style.width, height: element.style.height };
    element.style.width = `${size[0]}px`;
    element.style.height = `${size[1]}px`;
    const addAttr = (name, value) => {
      if (!element.hasAttribute(name)) {
        element.setAttribute(name, value);
        owned.push([name, value]);
      }
    };
    if (options.title && !element.hasAttribute("aria-labelledby"))
      addAttr("aria-label", options.title);
    if (options.title && options.nativeTitle !== false) addAttr("title", options.title);
    const focusable = options.focusable ?? options.interactive !== false;
    addAttr("role", focusable ? "button" : options.title ? "img" : "presentation");
    if (focusable) addAttr("tabindex", "0");
    const cleanup = () => {
      for (const [name, value] of owned)
        if (element.getAttribute(name) === value) element.removeAttribute(name);
      for (const [name, value] of Object.entries(savedSize))
        if (element.style[name] === `${size[name === "width" ? 0 : 1]}px`)
          element.style[name] = value || "";
    };
    const stop = (ev) => ev.stopPropagation();
    for (const name of ["click", "dblclick", "pointerdown"]) wrapper.addEventListener(name, stop);
    class DOMOverlay extends s.OverlayView {
      onAdd() {
        const panes = this.getPanes();
        (options.interactive === false
          ? panes.overlayLayer
          : engine.provider === "naver"
            ? panes.overlayImage
            : panes.overlayMouseTarget
        ).appendChild(wrapper);
        wrapper.appendChild(element);
        if (engine.provider === "google") s.OverlayView.preventMapHitsAndGesturesFrom?.(wrapper);
      }
      draw() {
        const projection = this.getProjection();
        if (!projection) return;
        const point =
          engine.provider === "naver"
            ? projection.fromCoordToOffset(engine.coord(location))
            : projection.fromLatLngToDivPixel(engine.coord(location));
        if (point) {
          wrapper.style.left = `${point.x - anchor[0]}px`;
          wrapper.style.top = `${point.y - anchor[1]}px`;
        }
      }
      onRemove() {
        if (element.parentNode === wrapper) element.remove();
        wrapper.remove();
      }
    }
    const overlay = new DOMOverlay();
    overlay.setMap(this.map);
    const decoration = options.decoration
      ? this.addCircle(location, options.decoration)
      : undefined;
    return this.tracked({
      location,
      clusterData: options.clusterData,
      remove() {
        overlay.setMap(null);
        cleanup();
        decoration?.remove();
        for (const name of ["click", "dblclick", "pointerdown"])
          wrapper.removeEventListener(name, stop);
      },
    });
  }
  circleOptions(center, o) {
    return {
      center: this.coord(center),
      radius: o.radius,
      strokeColor: o.color,
      strokeWeight: o.outline === false ? 0 : 1,
      strokeOpacity: 0.7,
      fillColor: o.color,
      fillOpacity: 0.15,
      clickable: false,
    };
  }
  addCircle(center, options) {
    const shape = new this.sdk.Circle({ map: this.map, ...this.circleOptions(center, options) });
    return this.tracked({
      update: (p, o) => shape.setOptions(this.circleOptions(p, o)),
      remove: () => shape.setMap(null),
    });
  }
  addPath(path) {
    let children = [];
    const paint = (p) => {
      children.forEach((h) => h.remove());
      children = [];
      for (const segment of p.segments) {
        const line = new this.sdk.Polyline({
          map: this.map,
          path: segment.points.map((x) => this.coord(x)),
          strokeColor: p.color,
          strokeOpacity: segment.opacity ?? 1,
          strokeWeight: 3,
          clickable: false,
        });
        children.push({ remove: () => line.setMap(null) });
      }
      for (const marker of p.markers) {
        const dot = this.container.ownerDocument.createElement("div");
        Object.assign(dot.style, {
          width: "8px",
          height: "8px",
          borderRadius: "50%",
          background: p.color,
          opacity: String(marker.opacity ?? 1),
        });
        dot.setAttribute("title", htmlToText(this.container.ownerDocument, marker.tooltipHtml));
        children.push(
          this.addMarker(dot, marker.location, {
            size: [8, 8],
            interactive: true,
            focusable: false,
          }),
        );
      }
    };
    paint(path);
    return this.tracked({
      update: paint,
      remove: () => {
        children.forEach((h) => h.remove());
        children = [];
      },
    });
  }
  setView(center, zoom) {
    this.map.setCenter(this.coord(center));
    if (zoom !== undefined) this.map.setZoom(zoom);
  }
  getView() {
    if (!this.map || this.dead) return undefined;
    const c = this.map.getCenter();
    return { center: [c.lat(), c.lng()], zoom: this.map.getZoom() };
  }
  setZoom(z) {
    this.map.setZoom(z);
  }
  panTo(p) {
    this.map.panTo(this.coord(p));
  }
  containsLocation(p) {
    const b = this.map?.getBounds();
    return (
      !!b && (this.provider === "naver" ? b.hasLatLng(this.coord(p)) : b.contains(this.coord(p)))
    );
  }
  fitBounds(points, o = {}) {
    if (!points.length) return;
    let south = 90,
      north = -90,
      west = 180,
      east = -180;
    for (const [a, l] of points) {
      south = Math.min(south, a);
      north = Math.max(north, a);
      west = Math.min(west, l);
      east = Math.max(east, l);
    }
    // Zero-area bounds (one point, or all points equal): centre on it like the native engines.
    if (south === north && west === east) {
      this.setView([south, west], o.maxZoom);
      return;
    }
    // Same padding rule as HA's MapLibre/Leaflet engines: each side grows by pad (default 0.5).
    const pad = o.pad ?? 0.5,
      dy = (north - south) * pad,
      dx = (east - west) * pad;
    const b = new this.sdk.LatLngBounds();
    b.extend(this.coord([Math.max(-85, south - dy), west - dx]));
    b.extend(this.coord([Math.min(85, north + dy), east + dx]));
    this.map.fitBounds(
      b,
      this.provider === "naver" ? { ...o.padding, maxZoom: o.maxZoom } : o.padding || 0,
    );
    if (o.maxZoom !== undefined) {
      const cap = () => {
        if (this.map && this.map.getZoom() > o.maxZoom) this.map.setZoom(o.maxZoom);
      };
      cap();
      // One pending cap at a time; a newer fit replaces the older one.
      this.unlisten(this.fitCap);
      this.fitCap = this.listen("idle", () => {
        this.unlisten(this.fitCap);
        this.fitCap = undefined;
        cap();
      });
    }
  }
  hasUsableSize() {
    return !!this.container?.clientWidth && !!this.container?.clientHeight;
  }
  invalidateSize() {
    if (this.provider === "naver")
      this.map?.setSize?.(
        new this.sdk.Size(this.container.clientWidth, this.container.clientHeight),
      );
    else if (this.map) this.event.trigger(this.map, "resize");
  }
  // HA's light/dark style (theme_mode, or the HA theme's dark mode) on the provider map.
  setMapStyle(style) {
    if (!style || this.dead) return;
    this.dark = isDarkStyle(style);
    const recreate =
      this.provider === "google" ||
      this.styleId(true) !== undefined ||
      this.styleId(false) !== undefined;
    if (!recreate) {
      this.applyTileFilter();
      return;
    }
    if (this.dark === this.drawnDark || this.restyleRequested === this.dark) return;
    this.restyleRequested = this.dark;
    this.config.onRestyle?.();
  }
  setZoomControlPosition() {
    // Zoom buttons stay hidden on provider maps even when HA asks for a position.
    this.map?.setOptions({
      zoomControl: false,
    });
  }
  setScaleRuler(o) {
    this.map?.setOptions({ scaleControl: !!o });
  }
  // Grouping is accepted but not drawn yet: every marker stays individually visible.
  setClustering(o) {
    this.clustering = o || null;
  }
  clusterMode() {
    return this.clustering ? "individual-markers" : "off";
  }
  refreshClusters() {}
  destroy() {
    if (this.dead) return;
    this.dead = true;
    this.cancelInit?.();
    this.offAuth?.();
    for (const h of [...this.items]) h.remove();
    for (const h of this.listeners) this.event?.removeListener(h);
    this.listeners = [];
    if (this.map) {
      this.event?.clearInstanceListeners?.(this.map);
      this.map.destroy?.();
    }
    this.map = undefined;
  }
}
