// Production entry (ha-korea-map.js). Served from either install location:
//   HACS:   /hacsfiles/ha-korea-map/ha-korea-map.js  (files in /config/www/community/ha-korea-map/)
//   manual: /local/ha-korea-map/ha-korea-map.js      (files in /config/www/ha-korea-map/)
// Sibling modules and the boundary are resolved relative to this file. The key config lives
// OUTSIDE the package folder (/config/www/ha-korea-map-config.mjs -> /local/...) so a HACS
// update, which replaces the package folder, never overwrites it.
// Unknown HA/frontend versions fail closed: the original HA map stays untouched.
import { startAutoHook } from "./ha-map-extension.mjs?v=auto-5";

export const CONFIG_PATH = "/local/ha-korea-map-config.mjs";
export const BOUNDARY_FILE = "./ha-map-korea-boundary.geojson?v=auto-5";

export function packageUrls(moduleUrl) {
  return {
    config: new URL(CONFIG_PATH, moduleUrl).href,
    boundary: new URL(BOUNDARY_FILE, moduleUrl).href,
  };
}

const rejected = (reason) => ({ installed: false, reason, uninstall() {} });

// Starts the hook once per page. The module may be registered twice (HACS dashboard resource
// plus frontend.extra_module_url) under different URLs, which evaluates it twice; the second
// evaluation reuses the first result instead of wrapping ha-map again.
export function bootstrap({
  moduleUrl,
  scope = globalThis,
  importConfig = (url) => import(url),
  start = startAutoHook,
} = {}) {
  if (scope.haMapExtensionReady) return scope.haMapExtensionReady;
  const urls = packageUrls(moduleUrl);
  const ready = (async () => {
    let config;
    try {
      config = (await importConfig(urls.config)).labConfig;
    } catch {
      return rejected("config-unavailable");
    }
    if (!config || typeof config !== "object") return rejected("config-invalid");
    // A boundary URL in the config wins; otherwise the copy shipped next to this file.
    return start({ config: { ...config, boundary: config.boundary ?? { url: urls.boundary } } });
  })()
    .catch((error) => rejected(String(error)))
    .then((ctl) => {
      scope.haMapExtension = ctl;
      return ctl;
    });
  scope.haMapExtensionReady = ready;
  return ready;
}

if (globalThis.customElements && !globalThis.HA_MAP_LAB_HARNESS) {
  bootstrap({ moduleUrl: import.meta.url });
}
