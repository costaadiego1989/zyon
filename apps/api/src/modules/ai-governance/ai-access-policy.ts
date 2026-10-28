export const AI_ACTOR_ROLES = ["owner", "admin", "staff", "buyer", "service"] as const;
export type AiActorRole = typeof AI_ACTOR_ROLES[number];
export const AI_TOOLS = ["aacp_evaluate_discount", "aacp_evaluate_shipping", "aacp_generate_message", "aacp_search_catalog", "aacp_get_agent_card"] as const;
export type AiGrant = { kind: "model" | "tool"; resource: string; roles: AiActorRole[]; sources: string[] };
export type AiPolicy = { version: number; grants: AiGrant[] };
export type AiIdentity = { merchantId: string; actorId?: string; actorRole: AiActorRole; teamId?: string; source: string; correlationId?: string };
const identifier = /^[a-zA-Z0-9][a-zA-Z0-9_.:/@-]{0,199}$/;
export function safeIdentifier(value: unknown): value is string { return typeof value === "string" && identifier.test(value); }
export function isAiActorRole(value: unknown): value is AiActorRole { return AI_ACTOR_ROLES.includes(value as AiActorRole); }
export function parseGrants(value: unknown, models: ReadonlySet<string>): AiGrant[] {
  if (!Array.isArray(value) || value.length > 200) throw new Error("ai_policy_invalid_grants");
  return value.map(entry => {
    if (!entry || typeof entry !== "object" || Object.keys(entry).some(k => !["kind","resource","roles","sources"].includes(k))) throw new Error("ai_policy_invalid_grant");
    const {kind, resource, roles, sources} = entry;
    if (!["model","tool"].includes(kind) || !safeIdentifier(resource) ||
      (kind === "model" ? !models.has(resource) : !AI_TOOLS.includes(resource as typeof AI_TOOLS[number]))) throw new Error("ai_policy_unknown_resource");
    if (!Array.isArray(roles) || !roles.length || roles.length > AI_ACTOR_ROLES.length || roles.some(r => !isAiActorRole(r)) ||
      !Array.isArray(sources) || !sources.length || sources.length > 50 || sources.some(s => s !== "*" && !safeIdentifier(s))) throw new Error("ai_policy_invalid_scope");
    return { kind, resource, roles: [...new Set<AiActorRole>(roles)], sources: [...new Set<string>(sources)] };
  });
}
export function decideAccess(policy: AiPolicy | null, identity: AiIdentity, kind: AiGrant["kind"], resource: string, models: ReadonlySet<string>) {
  if (!safeIdentifier(identity.merchantId) || !safeIdentifier(identity.source) || !isAiActorRole(identity.actorRole) || !safeIdentifier(resource)) return { allowed:false, reason:"invalid_context" };
  const registered = kind === "model" ? models.has(resource) : AI_TOOLS.includes(resource as typeof AI_TOOLS[number]);
  if (!registered) return { allowed:false, reason:"unregistered_resource" };
  // Existing server-selected models remain usable until a tenant publishes a policy.
  // Publishing an empty policy intentionally revokes every model/tool grant.
  if (!policy) return { allowed:true, reason:"deployed_catalog" };
  const allowed = policy.grants.some(grant => grant.kind === kind && grant.resource === resource && grant.roles.includes(identity.actorRole) &&
    (grant.sources.includes("*") || grant.sources.includes(identity.source)));
  return { allowed, reason: allowed ? "policy_grant" : "policy_denied" };
}
