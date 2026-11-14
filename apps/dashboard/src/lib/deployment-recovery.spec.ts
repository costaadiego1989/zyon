import { describe, expect, it, vi } from "vitest";
import { installDeploymentRecovery, isAssetLoadError, recoverAssetLoad } from "./deployment-recovery.js";

function browser() {
  const storage = new Map<string, string>();
  const events = new EventTarget();
  return {
    navigator: { onLine: true },
    location: { reload: vi.fn() },
    sessionStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events),
  };
}
const cssFailure = new Error("Unable to preload CSS for /assets/index-old.css");

describe("deployment recovery", () => {
  it("handles CSS and browser-specific dynamic import failures, not application errors", () => {
    for (const message of [cssFailure.message, "Failed to fetch dynamically imported module: /assets/old.js",
      "Importing a module script failed.", "error loading dynamically imported module"]) {
      expect(isAssetLoadError({ message })).toBe(true);
    }
    expect(isAssetLoadError(new Error("crm_credentials_invalid"))).toBe(false);
    expect(isAssetLoadError(null)).toBe(false);
  });

  it("reloads only once even across a page refresh", () => {
    const target = browser();
    expect(recoverAssetLoad(cssFailure, target as unknown as Window)).toBe(true);
    target.location.reload.mockClear();
    expect(recoverAssetLoad(cssFailure, target as unknown as Window)).toBe(false);
    expect(target.location.reload).not.toHaveBeenCalled();
  });

  it("allows recovery after a later deployment without clearing unrelated session state", () => {
    const target = browser();
    target.sessionStorage.setItem("merchant-session", "retained");
    target.sessionStorage.setItem("zyon:asset-reload-at", String(Date.now() - 91_000));
    expect(recoverAssetLoad(cssFailure, target as unknown as Window)).toBe(true);
    expect(target.sessionStorage.getItem("merchant-session")).toBe("retained");
  });

  it("does not reload while offline or when storage is unavailable", () => {
    const target = browser();
    target.navigator.onLine = false;
    expect(recoverAssetLoad(cssFailure, target as unknown as Window)).toBe(false);
    target.navigator.onLine = true;
    target.sessionStorage.setItem = () => { throw Error("storage_denied"); };
    expect(recoverAssetLoad(cssFailure, target as unknown as Window)).toBe(false);
    expect(target.location.reload).not.toHaveBeenCalled();
  });

  it("prevents the Vite error only during a recovery and removes its listener", () => {
    const target = browser();
    const uninstall = installDeploymentRecovery(target as unknown as Window);
    const failure = () => Object.assign(new Event("vite:preloadError", { cancelable: true }), { payload: cssFailure });
    expect(target.dispatchEvent(failure())).toBe(false);
    expect(target.dispatchEvent(failure())).toBe(true);
    expect(target.location.reload).toHaveBeenCalledTimes(1);
    uninstall();
    target.dispatchEvent(failure());
    expect(target.location.reload).toHaveBeenCalledTimes(1);
  });
});
