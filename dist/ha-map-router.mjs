// Stable HA MapEngine router. Records and caller DOM belong here, not an SDK.
export class MapRouter {
  constructor({
    nativeFactory,
    providerFactory,
    provider = "native",
    timeout = 15000,
    onDestroy,
  } = {}) {
    this.nativeFactory = nativeFactory;
    this.providerFactory = providerFactory;
    this.desired = provider;
    this.timeout = timeout;
    this.onDestroy = onDestroy;
    this.records = new Set();
    this.generation = 0;
    this.safeMode = false;
    this.dead = false;
    this.settings = { clustering: null };
    this.pending = new Set();
  }
  async init(container, options) {
    this.container = container;
    this.options = options;
    await this.select("native");
    if (this.dead || this.desired === "native") return;
    if (this.desired === "auto") {
      await this.auto?.start();
      return;
    }
    await this.select(this.desired);
  }
  stage() {
    const el = this.container.ownerDocument.createElement("div");
    Object.assign(el.style, {
      position: "absolute",
      inset: "0",
      width: "100%",
      height: "100%",
      visibility: "hidden",
      pointerEvents: "none",
    });
    this.container.style.position = "relative";
    this.container.appendChild(el);
    return el;
  }
  async select(provider, { force = false } = {}) {
    if (this.dead) return false;
    if (!["native", "naver", "google"].includes(provider)) return false;
    if (provider !== "native" && this.safeMode) return false;
    const generation = ++this.generation;
    this.cancelPending();
    if (this.current?.provider === provider && !force) return true;
    const stage = this.stage(),
      candidate = { provider, stage, engine: null, cancel: null };
    this.pending.add(candidate);
    const view = this.current?.engine.getView?.() || {
      center: this.options.center,
      zoom: this.options.zoom,
    };
    let timer;
    const stale = () => this.dead || generation !== this.generation;
    try {
      const construct = Promise.resolve().then(() =>
        provider === "native"
          ? this.nativeFactory()
          : this.providerFactory(
              provider,
              () => {
                void this.recover("provider-auth-failure").catch(() => {
                  this.reason = "native-recovery-failed";
                });
              },
              // A creation-time style option changed (e.g. Google colorScheme): rebuild this
              // provider, but only while this very engine is still the committed one.
              () => (this.current === candidate ? this.select(provider, { force: true }) : false),
            ),
      );
      construct.then(
        (e) => {
          if (stale()) {
            e.destroy();
          } else candidate.engine = e;
        },
        () => {},
      );
      const init = construct.then(async (e) => {
        if (stale()) throw Error("cancelled");
        candidate.engine = e;
        const camera =
          (name) =>
          (...a) => {
            this.options.events?.[name]?.(...a);
            if (this.current?.engine === e) this.onCamera?.("event", { name });
          };
        const events = {
          ...this.options.events,
          moveStart: camera("moveStart"),
          zoomStart: camera("zoomStart"),
          fatal: () => {
            if (provider === "native") this.options.events?.fatal?.();
            else
              void this.recover("provider-fatal").catch(() => {
                this.reason = "native-recovery-failed";
              });
          },
        };
        // No HA token/config objects sent to SDK engine. Native alone gets original options.
        const opts =
          provider === "native"
            ? { ...this.options, ...view, events }
            : {
                center: view.center,
                zoom: view.zoom,
                zoomControlPosition: this.options.zoomControlPosition,
                // HA's resolved light/dark style only (no tile token or other HA options).
                mapStyle: this.settings.style || this.options.mapStyle,
                events,
              };
        await e.init(stage, opts);
        if (stale()) {
          e.destroy();
          throw Error("cancelled");
        }
        return e;
      });
      const cancelled = new Promise((_, reject) => {
        candidate.cancel = () => reject(Error("cancelled"));
      });
      const expired = new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error("transition-timeout")), this.timeout);
      });
      const e = await Promise.race([init, cancelled, expired]);
      if (stale()) return false;
      const latestView = this.current?.engine.getView?.();
      if (latestView) e.setView?.(latestView.center, latestView.zoom);
      for (const record of this.records) {
        record.live?.remove();
        record.live = null;
      }
      this.current?.engine.destroy();
      this.current?.stage.remove();
      this.current = candidate;
      for (const record of this.records) this.render(record);
      e.setMapStyle?.(this.settings.style || this.options.mapStyle);
      e.setZoomControlPosition?.(this.settings.zoomPosition || this.options.zoomControlPosition);
      e.setScaleRuler?.(this.settings.scale || null);
      e.setClustering?.(this.settings.clustering);
      stage.style.visibility = "visible";
      stage.style.pointerEvents = "auto";
      if (!this.safeMode) this.reason = undefined;
      return true;
    } catch {
      candidate.engine?.destroy();
      stage.remove();
      if (stale()) return false;
      if (this.current === candidate) this.current = null;
      if (provider !== "native") {
        this.safeMode = true;
        this.auto?.disable("safe-mode");
        this.reason = "provider-failed-native-safe-mode";
        return await this.select("native");
      }
      this.reason = "native-recovery-failed";
      throw Error("native-recovery-failed");
    } finally {
      clearTimeout(timer);
      this.pending.delete(candidate);
    }
  }
  cancelPending() {
    for (const c of this.pending) {
      c.cancel?.();
      c.engine?.destroy();
      c.stage.remove();
    }
    this.pending.clear();
  }
  async recover(reason = "manual-native-safe-mode") {
    this.safeMode = true;
    this.auto?.disable("safe-mode");
    this.reason = reason;
    const ok = await this.select("native");
    this.reason = reason;
    return ok;
  }
  async resume(provider = this.desired) {
    if (provider === "auto") return this.choose("auto");
    this.safeMode = false;
    this.desired = provider;
    return this.select(provider);
  }
  // Manual choice from UI/API: a concrete provider turns automatic selection off.
  async choose(value) {
    if (this.dead) return false;
    if (value === "auto") {
      if (!this.auto?.geometry) return false;
      this.safeMode = false;
      this.reason = undefined;
      return this.auto.enable();
    }
    this.auto?.disable("manual");
    if (value === "native") {
      this.safeMode = false;
      this.desired = "native";
      this.reason = undefined;
      return this.select("native");
    }
    return this.resume(value);
  }
  diagnostics() {
    return {
      provider: this.current?.provider || "none",
      safeMode: this.safeMode,
      records: this.records.size,
      pending: this.pending.size,
      reason: this.reason || null,
      clustering: !!this.settings.clustering,
      // How the current engine draws HA's groups: "native" (HA engine), "individual-markers"
      // (provider map shows every marker on its own) or "off".
      clusterRendering: this.settings.clustering
        ? (this.current?.engine.clusterMode?.() ?? "native")
        : "off",
      ...(this.auto ? this.auto.diagnostics() : { auto: false }),
    };
  }
  render(r) {
    const e = this.current?.engine;
    if (e) r.live = e[r.method](...r.args);
  }
  record(method, args) {
    const r = { method, args, live: null };
    this.records.add(r);
    this.render(r);
    const handle = {
      remove: () => {
        if (!this.records.delete(r)) return;
        r.live?.remove();
        r.live = null;
      },
    };
    if (method === "addMarker") {
      Object.defineProperties(handle, {
        location: { get: () => r.args[1] },
        clusterData: { get: () => r.args[2]?.clusterData },
      });
    } else
      handle.update = (...next) => {
        if (!this.records.has(r)) return;
        r.args = next;
        r.live?.update(...next);
      };
    return handle;
  }
  addMarker(...a) {
    return this.record("addMarker", a);
  }
  addCircle(...a) {
    return this.record("addCircle", a);
  }
  addPath(...a) {
    return this.record("addPath", a);
  }
  // HA's grouping toggle. Every engine receives the setting; switching engines replays it.
  setClustering(o) {
    this.settings.clustering = o;
    this.current?.engine.setClustering(o);
  }
  refreshClusters() {
    this.current?.engine.refreshClusters();
  }
  setMapStyle(o) {
    this.settings.style = o;
    this.current?.engine.setMapStyle(o);
  }
  setZoomControlPosition(o) {
    this.settings.zoomPosition = o;
    this.current?.engine.setZoomControlPosition(o);
  }
  setScaleRuler(o) {
    this.settings.scale = o;
    this.current?.engine.setScaleRuler(o);
  }
  getView() {
    return this.current?.engine.getView();
  }
  camera(method, args) {
    this.current?.engine[method](...args);
    this.onCamera?.("programmatic", { method, args });
  }
  setView(...a) {
    this.camera("setView", a);
  }
  setZoom(...a) {
    this.camera("setZoom", a);
  }
  panTo(...a) {
    this.camera("panTo", a);
  }
  fitBounds(...a) {
    this.camera("fitBounds", a);
  }
  containsLocation(...a) {
    return this.current?.engine.containsLocation(...a) || false;
  }
  hasUsableSize() {
    return this.current?.engine.hasUsableSize() || false;
  }
  invalidateSize() {
    this.current?.engine.invalidateSize();
  }
  destroy() {
    if (this.dead) return;
    this.dead = true;
    this.auto?.destroy();
    ++this.generation;
    this.cancelPending();
    for (const r of this.records) r.live?.remove();
    this.records.clear();
    this.current?.engine.destroy();
    this.current?.stage.remove();
    this.current = null;
    this.onDestroy?.();
  }
}
