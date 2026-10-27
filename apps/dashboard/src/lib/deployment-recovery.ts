const RELOAD_KEY = "zyon:asset-reload-at";
const RELOAD_INTERVAL_MS = 90_000;

export function isAssetLoadError(error: unknown): boolean {
  const message = typeof error === "string" ? error
    : error && typeof error === "object" && "message" in error ? String(error.message) : "";
  return /Unable to preload CSS for |Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Loading chunk \S+ failed|ChunkLoadError/i.test(message);
}

// A tab opened before a deployment can reference chunks removed by that release.
// Reload once to get the current HTML, retaining the route and session. Keep a
// per-tab guard across reloads so an outage cannot cause a navigation loop.
export function recoverAssetLoad(error: unknown, browser: Window = window): boolean {
  if (!isAssetLoadError(error) || browser.navigator.onLine === false) return false;
  try {
    const now = Date.now();
    const previous = Number(browser.sessionStorage.getItem(RELOAD_KEY));
    if (previous > 0 && now - previous < RELOAD_INTERVAL_MS) return false;
    browser.sessionStorage.setItem(RELOAD_KEY, String(now));
  } catch {
    // If storage is unavailable, keep the explicit reload action instead.
    return false;
  }
  browser.location.reload();
  return true;
}

export function installDeploymentRecovery(browser: Window = window): () => void {
  const listener = (event: Event) => {
    if (recoverAssetLoad((event as Event & { payload?: unknown }).payload, browser)) event.preventDefault();
  };
  browser.addEventListener("vite:preloadError", listener);
  return () => browser.removeEventListener("vite:preloadError", listener);
}
