// Pinned private HA integration; official SDKs are only loaded with key + opt-in.
import { MapRouter } from "./ha-map-router.mjs?v=auto-3";
import { SDKEngine } from "./ha-map-sdk.mjs?v=auto-3";
import { AutoSwitch, loadBoundary } from "./ha-map-auto.mjs?v=auto-3";
const installed = new WeakMap();
export function ownsDefaultPanel(map, path = globalThis.location?.pathname) {
  if (path !== "/map" && path !== "/map/0") return false;
  const seen = new Set();
  let n = map,
    legacy = false,
    card = false,
    owner = false;
  while (n && !seen.has(n)) {
    seen.add(n);
    if (
      n.localName === "ha-locations-editor" ||
      n.localName === "hui-dialog-edit-card" ||
      n.localName === "hui-card-preview"
    )
      return false;
    if (n.localName === "ha-panel-map") legacy = true;
    if (n.localName === "hui-map-card") card = true;
    if (n.localName === "ha-panel-lovelace") {
      if (n.panel?.url_path !== "map") return false;
      owner = true;
    }
    n = n.parentNode || n.getRootNode?.()?.host;
  }
  return legacy || (card && owner);
}
export function installHook(
  C,
  {
    coreVersion,
    frontendVersion,
    pathname = () => globalThis.location.pathname,
    mode = "native",
    events = [],
    provider = "native",
    providers = {},
    boundary,
    fetch = globalThis.fetch,
  } = {},
) {
  if (installed.has(C)) return installed.get(C);
  const p = C?.prototype,
    d = p && Object.getOwnPropertyDescriptor(p, "_createEngine");
  const shape = [
    !d && "_createEngine missing",
    d && !d.configurable && "_createEngine not configurable",
    d && typeof d.value !== "function" && "_createEngine not a method",
    d && typeof d.value === "function" && d.value.length !== 0 && "_createEngine arity",
    ...["_setUpEngine", "_loadMap", "disconnectedCallback"]
      .filter((k) => typeof p?.[k] !== "function")
      .map((k) => k + " missing"),
  ].filter(Boolean);
  if (coreVersion !== "2026.10.1" || frontendVersion !== "20260930.3")
    return { installed: false, reason: "unknown version/method shape: version", uninstall() {} };
  if (shape.length)
    return {
      installed: false,
      reason: "unknown version/method shape: " + shape.join(", "),
      uninstall() {},
    };
  let enabled = true;
  const original = d.value,
    routers = new Set();
  const wrapper = async function () {
    const native = await original.call(this);
    if (
      !enabled ||
      !ownsDefaultPanel(this, pathname()) ||
      this._forceLeaflet ||
      this.rasterOnly ||
      mode === "native"
    )
      return native;
    if (mode === "official") {
      const enabled = (name) => !!(providers[name]?.key && providers[name]?.optIn === true);
      // auto needs both opted-in keys and a boundary file; otherwise leave HA's map untouched.
      if (
        provider === "auto"
          ? !(enabled("naver") && enabled("google") && boundary?.url)
          : !["naver", "google"].includes(provider) || !enabled(provider)
      )
        return native;
      let initial = native,
        router;
      const target = this;
      router = new MapRouter({
        provider,
        nativeFactory: async () => {
          if (initial) {
            const e = initial;
            initial = null;
            return e;
          }
          return original.call(target);
        },
        providerFactory: (name, onFailure) =>
          new SDKEngine(name, {
            key: providers[name]?.key,
            optIn: providers[name]?.optIn === true,
            onFailure,
          }),
        onDestroy: () => routers.delete(router),
      });
      if (provider === "auto")
        new AutoSwitch(router, { boundary: loadBoundary(boundary.url, { fetch }) });
      // HA's clustering is on by default. Do not silently drop it or fetch SDK.
      if (this.clusterMarkers !== false) {
        router.blockClustering = true;
        router.safeMode = true;
        router.reason = "clustering-requires-native";
      }
      routers.add(router);
      return router;
    }
    // Mock is a transparent facade over the REAL native engine, not a provider map.
    // The factory/lifecycle/overlays remain actual HA implementation.
    if (mode !== "mock" && mode !== "mock-init-failure") return native;
    const target = this;
    return new Proxy(native, {
      get(n, k) {
        if (k === "labAdapter") return mode;
        if (k === "init")
          return async (container, options) => {
            events.push({ type: "adapter-init", mode });
            if (mode === "mock-init-failure") {
              try {
                throw new Error("Injected mock adapter initialization failure");
              } catch (error) {
                events.push({ type: "mock-failed-native-recovery", reason: error.message });
                await n.init(container, options);
                return;
              }
            }
            await n.init(container, options);
            container.dataset.haMapLab = "mock-native-backed";
            events.push({ type: "native-backed-ready" });
          };
        if (k === "destroy")
          return () => {
            events.push({ type: "destroy" });
            n.destroy();
          };
        const v = Reflect.get(n, k, n);
        if (typeof v === "function")
          return (...a) => {
            if (k === "addMarker") events.push({ type: "marker", location: a[1] });
            return v.apply(n, a);
          };
        return v;
      },
    });
  };
  Object.defineProperty(p, "_createEngine", { ...d, value: wrapper });
  // Verification API (no coordinates/keys in diagnostics). select() is a manual choice and turns auto off.
  const all = (fn) => Promise.all([...routers].map(fn));
  const ctl = {
    installed: true,
    diagnostics() {
      return { mode, provider, routers: [...routers].map((r) => r.diagnostics()) };
    },
    select(name) {
      return all((r) => (r.choose ? r.choose(name) : r.select(name)));
    },
    auto() {
      return all((r) => r.choose("auto"));
    },
    setView(center, zoom) {
      for (const r of routers) r.setView(center, zoom);
    },
    panTo(center) {
      for (const r of routers) r.panTo(center);
    },
    fitBounds(points, options = {}) {
      for (const r of routers) r.fitBounds(points, options);
    },
    recover() {
      return Promise.all([...routers].map((r) => r.recover()));
    },
    resume(name = provider) {
      return Promise.all([...routers].map((r) => r.resume(name)));
    },
    uninstall() {
      enabled = false;
      for (const r of routers) void r.recover("uninstalled-native-safe-mode").catch(() => {});
      if (p._createEngine === wrapper) Object.defineProperty(p, "_createEngine", d);
      installed.delete(C);
      ctl.installed = false;
    },
  };
  installed.set(C, ctl);
  return ctl;
}
export function detectFrontendVersion({ pin, origin, preloads = [], resources = [] } = {}) {
  if (!pin || pin.entrypoints?.length !== 2 || !origin) return undefined;
  const paths = (items) =>
    new Set(
      items.flatMap((item) => {
        try {
          const u = new URL(item.href || item.name, origin);
          return u.origin === origin ? [u.pathname] : [];
        } catch {
          return [];
        }
      }),
    );
  const html = paths(preloads),
    active = paths(resources);
  if (!pin.entrypoints.every((path) => html.has(path) && active.has(path))) return undefined;
  // Mixed cached builds are not a match, even when the expected entries also exist.
  for (const path of [...html, ...active])
    if (/^\/frontend_(latest|es5)\/(core|app)\./.test(path) && !pin.entrypoints.includes(path))
      return undefined;
  return pin.frontendVersion;
}
export async function startAutoHook({
  config = {},
  registry = globalThis.customElements,
  document = globalThis.document,
  performance = globalThis.performance,
  location = globalThis.location,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  maxAttempts = 100,
  interval = 100,
} = {}) {
  const rejected = (reason) => ({ installed: false, reason, uninstall() {} });
  if (!registry || !document || !location) return rejected("missing browser environment");
  let finished = false,
    result,
    lastShape;
  const attempt = () => {
    if (finished || result) return;
    const coreVersion = document.querySelector("home-assistant")?.hass?.config?.version;
    if (!coreVersion) return;
    if (coreVersion !== config.pin?.coreVersion || coreVersion !== "2026.10.1") {
      result = rejected("unknown core version");
      return;
    }
    const C = registry.get("ha-map");
    if (!C) return;
    const frontendVersion = detectFrontendVersion({
      pin: config.pin,
      origin: location.origin,
      preloads: Array.from(document.querySelectorAll('link[rel="modulepreload"]')),
      resources: performance?.getEntriesByType("resource") || [],
    });
    if (!frontendVersion) return;
    const r = installHook(C, {
      coreVersion,
      frontendVersion,
      pathname: () => location.pathname,
      mode: config.mode || "native",
      events: config.events || [],
      provider: config.provider || "native",
      providers: config.providers || {},
      boundary: config.boundary,
    });
    // A shape mismatch seen once (e.g. during frontend chunk loading) is retried until the poll budget ends.
    if (
      !r.installed &&
      r.reason?.startsWith("unknown version/method shape: ") &&
      !r.reason.endsWith(": version")
    ) {
      lastShape = r;
      return;
    }
    result = r;
    result.evidence = {
      coreVersion,
      frontendVersion,
      mode: config.mode || "native",
      entrypoints: [...config.pin.entrypoints],
    };
  };
  // Best effort only: this continuation is not proof of pre-first-instance timing.
  registry
    .whenDefined("ha-map")
    .then(attempt)
    .catch(() => {});
  const limit = Math.min(
    300,
    Math.max(1, Number.isFinite(maxAttempts) ? Math.floor(maxAttempts) : 100),
  );
  for (let i = 0; i < limit; i++) {
    attempt();
    if (result) break;
    await sleep(Math.min(1000, Math.max(0, interval)));
  }
  finished = true;
  return (
    result || lastShape || rejected("timed out waiting for hass, ha-map or exact active frontend")
  );
}
// Auto startup lives in the explicitly pinned lab bootstrap. Importing this module
// alone is side-effect free so the existing exact-bundle harness remains compatible.
