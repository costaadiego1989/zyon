import { DashboardHttpError } from "../../../api/http/error.js";

export type RefreshResult<T> = { kind: "success"; data: T } | { kind: "paused"; retryAt: number } | { kind: "error"; error: unknown; retryAt: number };

/** One request per resource; a tenant quota pauses all support reads together. */
export class SupportRefreshCoordinator {
  private blockedUntil = 0;
  private readonly inFlight = new Map<string, Promise<RefreshResult<unknown>>>();
  private readonly next = new Map<string, number>();
  private readonly failures = new Map<string, number>();
  constructor(private readonly now: () => number = Date.now) {}

  run<T>(key: string, work: () => Promise<T>): Promise<RefreshResult<T>> {
    const existing = this.inFlight.get(key);
    if (existing) return existing as Promise<RefreshResult<T>>;
    const retryAt = Math.max(this.blockedUntil, this.next.get(key) ?? 0);
    if (this.now() < retryAt) return Promise.resolve({ kind: "paused", retryAt });
    const task = Promise.resolve().then(work).then(data => {
      this.failures.delete(key); this.next.set(key, this.now() + 1000);
      return { kind: "success", data } as const;
    }).catch((error: unknown) => {
      const failures = (this.failures.get(key) ?? 0) + 1; this.failures.set(key, failures);
      const limited = error instanceof DashboardHttpError && error.status === 429;
      const delay = limited ? Math.max(1, error.retryAfterSeconds ?? 60) * 1000 : Math.min(120000, 15000 * 2 ** Math.min(failures - 1, 3));
      const retryAt = this.now() + delay;
      if (limited) this.blockedUntil = Math.max(this.blockedUntil, retryAt);
      this.next.set(key, retryAt);
      return { kind: "error", error, retryAt } as const;
    }).finally(() => { if (this.inFlight.get(key) === task) this.inFlight.delete(key); });
    this.inFlight.set(key, task);
    return task;
  }
}

const coordinators = new WeakMap<object, SupportRefreshCoordinator>();
export function supportRefreshCoordinator(api: object) {
  let coordinator = coordinators.get(api);
  if (!coordinator) { coordinator = new SupportRefreshCoordinator(); coordinators.set(api, coordinator); }
  return coordinator;
}

export function supportRefreshError(error: unknown) {
  return error instanceof DashboardHttpError && error.status === 429
    ? "A atualização foi pausada por alguns instantes. A conversa será atualizada automaticamente."
    : "Não foi possível atualizar agora. Uma nova consulta será feita automaticamente.";
}
