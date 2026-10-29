import { AsyncLocalStorage } from "node:async_hooks";
import net from "node:net";
import { SANDBOX_LLM_APPROVAL } from "./storefront-sandbox-llm-budget.mjs";
import { readJourneyCapability, revalidateJourneyCapability } from "./storefront-journey-guards.mjs";
import { createStorefrontJourneyTransport, registerJourneyTransportWrapper } from "./storefront-journey-transport.mjs";

/** Test process only. Install BEFORE creating the approved budget/providers.
 * Blocks uninstrumented vision/voice/SDK HTTP and all other external sockets.
 * It is accident protection, not an OS sandbox. PSP/geocoder external transports
 * remain forbidden until separately integrated; this is not a full journey. */
export async function installStorefrontJourneyEgress({ capability, previousFence }) {
  const manifest = readJourneyCapability(capability);
  const previousFetch = globalThis.fetch, previousConnect = net.Socket.prototype.connect;
  if (previousFence !== undefined) {
    if (!previousFence || Object.keys(previousFence).sort().join("|") !== ["fetch", "connect", "underlyingFetch", "underlyingConnect"].sort().join("|")
      || previousFence.fetch !== previousFetch || previousFence.connect !== previousConnect
      || typeof previousFence.underlyingFetch !== "function" || typeof previousFence.underlyingConnect !== "function") throw Error("journey_previous_fence_identity_required");
  }
  const underlyingFetch = previousFence?.underlyingFetch ?? previousFetch, underlyingConnect = previousFence?.underlyingConnect ?? previousConnect;
  await revalidateJourneyCapability(capability);
  if (globalThis.fetch !== previousFetch || net.Socket.prototype.connect !== previousConnect) throw Error("journey_egress_installation_globals_changed");
  const ownedPorts = new Set([Number(new URL(manifest.apiOrigin).port), manifest.postgresPort, manifest.redisPort]);
  const window = new AsyncLocalStorage(), fetch = underlyingFetch, connect = underlyingConnect;
  let disposed = false, activeWindows = 0;
  const counters = { budgetedFetches: 0, deniedFetches: 0, deniedSockets: 0 };
  const deny = code => { throw new Error(code); };
  const controlledFetch = async (input, options) => {
    if (disposed) return deny("journey_egress_closed");
    let target;
    try { target = new URL(input instanceof Request ? input.url : input); } catch { counters.deniedFetches++; return deny("journey_unaccounted_fetch_forbidden"); }
    const state = window.getStore();
    if (target.href === SANDBOX_LLM_APPROVAL.endpoint && state?.active && !state.fetchStarted) {
      state.fetchStarted = true; counters.budgetedFetches++;
      return fetch(input, options);
    }
    if (target.origin === manifest.apiOrigin && !target.username && !target.password) {
      return fetch(input, { ...options, redirect: "error" });
    }
    counters.deniedFetches++; return deny("journey_unaccounted_fetch_forbidden");
  };
  const controlledConnect = function (...args) {
    const normalized = Array.isArray(args[0]) ? args[0] : args, first = normalized[0];
    const host = first && typeof first === "object" ? first.host ?? "127.0.0.1"
      : typeof normalized[1] === "string" ? normalized[1] : "127.0.0.1";
    const port = Number(first && typeof first === "object" ? first.port : first);
    const state = window.getStore();
    if (!first?.path && (host === "127.0.0.1" && ownedPorts.has(port)
      || host === "api.deepseek.com" && port === 443 && state?.active && state.fetchStarted)) return connect.apply(this, args);
    counters.deniedSockets++; return deny("journey_unaccounted_socket_forbidden");
  };
  globalThis.fetch = controlledFetch; net.Socket.prototype.connect = controlledConnect;
  return Object.freeze({
    evidence: () => Object.freeze({ ...counters, activeWindows, externalPspOrGeocoderEnabled: false }),
    createTransport({ budget, record, approvalId }) {
      if (disposed) return deny("journey_egress_closed");
      const transport = createStorefrontJourneyTransport({ capability, budget, record, approvalId, async runBudgeted(work) {
        if (disposed) return deny("journey_egress_closed");
        const state = { active: true, fetchStarted: false }; activeWindows++;
        try { return await window.run(state, work); }
        finally { state.active = false; activeWindows--; }
      } });
      return registerJourneyTransportWrapper(transport, Object.freeze({ fetchFactory: transport.fetchFactory, async runOperation(input, work) {
        if (counters.deniedFetches || counters.deniedSockets) return deny("journey_egress_violation");
        try { return await transport.runOperation(input, work); }
        finally { if (counters.deniedFetches || counters.deniedSockets) deny("journey_egress_violation"); }
      } }));
    },
    dispose() {
      if (disposed) return;
      if (activeWindows || globalThis.fetch !== controlledFetch || net.Socket.prototype.connect !== controlledConnect) return deny("journey_egress_cleanup_conflict");
      globalThis.fetch = previousFetch; net.Socket.prototype.connect = previousConnect; disposed = true;
    },
  });
}
