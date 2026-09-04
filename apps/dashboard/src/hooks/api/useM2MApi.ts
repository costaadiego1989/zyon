import { useApi } from "../useApi.js";

/**
 * Domain-scoped hook for M2M (machine-to-machine) negotiation operations.
 *
 * M2M lets external buyer agents negotiate discounts autonomously via the
 * `merchant-negotiation-policy` endpoint. The merchant enables/disables M2M
 * via the `policy.enabled` flag and can inspect negotiation sessions.
 *
 * Use this hook when you need to read or update the merchant negotiation
 * policy and inspect M2M session activity.
 */
export function useM2MApi() {
  const api = useApi();
  return {
    getNegotiationPolicy: api.getNegotiationPolicy,
    putNegotiationPolicy: api.putNegotiationPolicy,
    getNegotiationSessions: api.getNegotiationSessions,
    getNegotiationStats: api.getNegotiationStats,
  };
}
