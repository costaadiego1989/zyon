import type { PlatformAuthResponse } from "./api.js";
import { clearPlatformSession, readPlatformSession, writePlatformSession } from "./session.js";

/** One rotation owner per API client. Old resource clients use its replacement token. */
export class PlatformSessionRefresh {
  private readonly previous = new Set<string>();
  private operatorId: string | null = null;
  private pending: Promise<string> | null = null;
  private epoch = 0;

  constructor(private readonly exchange: (token: string) => Promise<PlatformAuthResponse>) {}

  current(token: string): string {
    const session = readPlatformSession();
    return session && this.previous.has(token) && session.operator.operator_id === this.operatorId
      ? session.token : token;
  }

  manages(token: string): boolean {
    const session = readPlatformSession();
    return !!session && (session.token === token || this.current(token) === session.token);
  }

  cancel(): void { this.epoch++; }

  async renew(token: string): Promise<string> {
    const session = readPlatformSession();
    if (!session || !this.manages(token)) throw new Error("platform_session_changed");
    const current = this.current(token);
    if (current !== token) return current;
    if (this.pending) return this.pending;
    const epoch = this.epoch;
    this.operatorId = session.operator.operator_id;
    const ownsSession = () => this.epoch === epoch && readPlatformSession()?.token === current;
    this.pending = this.exchange(current).then(auth => {
      if (!ownsSession()) throw new Error("platform_session_changed");
      if (!auth.access_token || auth.operator_id !== session.operator.operator_id ||
          auth.email !== session.operator.email || auth.role !== session.operator.role) {
        clearPlatformSession();
        throw new Error("platform_session_identity_changed");
      }
      this.previous.add(current);
      writePlatformSession(auth);
      return auth.access_token;
    }).catch(error => {
      if (ownsSession() && typeof error === "object" && error !== null && "status" in error && error.status === 401) clearPlatformSession();
      throw error;
    }).finally(() => { this.pending = null; });
    return this.pending;
  }
}

/** JWT claims only schedule renewal; authorization remains entirely server-side. */
export function platformTokenExpiresAt(token: string): number | null {
  try {
    const part = token.split(".")[1];
    const claims = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/"))) as { exp?: unknown };
    return typeof claims.exp === "number" && Number.isSafeInteger(claims.exp) && claims.exp > 0
      ? claims.exp * 1000 : null;
  } catch { return null; }
}

export function maintainPlatformSession(
  token: string,
  renew: (token: string) => Promise<string>,
  onTransientError: () => void,
): () => void {
  let active = true;
  let pending = false;
  let current = token;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = (delay?: number) => {
    clearTimeout(timer);
    const expires = platformTokenExpiresAt(current);
    if (active && expires !== null) timer = setTimeout(run, delay ?? Math.max(0, expires - Date.now() - 60_000));
  };
  const run = async () => {
    if (!active || pending) return;
    pending = true;
    try {
      current = await renew(current);
      if (active) schedule();
    } catch (error) {
      if (active && !(typeof error === "object" && error !== null && "status" in error && error.status === 401)) {
        onTransientError();
        schedule(30_000);
      }
    } finally { pending = false; }
  };
  const resume = () => {
    const expires = platformTokenExpiresAt(current);
    if (document.visibilityState === "visible" && expires !== null && expires - Date.now() <= 60_000) void run();
  };
  schedule();
  document.addEventListener("visibilitychange", resume);
  window.addEventListener("online", resume);
  window.addEventListener("focus", resume);
  return () => {
    active = false;
    clearTimeout(timer);
    document.removeEventListener("visibilitychange", resume);
    window.removeEventListener("online", resume);
    window.removeEventListener("focus", resume);
  };
}
