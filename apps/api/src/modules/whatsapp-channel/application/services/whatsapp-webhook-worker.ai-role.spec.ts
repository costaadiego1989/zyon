import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { WhatsAppWebhookWorker } from "./whatsapp-webhook-worker.service.js";
import { TenantContextService } from "../../../../shared/tenant/tenant-context.service.js";
import { AiGovernanceService } from "../../../ai-governance/ai-governance.service.js";
import type { WhatsAppInboxClaim } from "../../domain/ports/whatsapp-webhook-inbox.port.js";

const merchantId = "synthetic-role-merchant", source = "storefront_agent", resource = "openai:gpt-4o-mini";
function policy(tenant: TenantContextService, roles: Array<"buyer" | "owner">) {
  const decisions: Array<Record<string, any>> = [];
  const governance = new AiGovernanceService({
    aiActorTeam: { findMany: async (input: any) => {
      assert.equal(input.where.merchantId, merchantId);
      assert.deepEqual(input.where.actorId.in, ["whatsapp-inbox", "source:" + source]); return [];
    } },
    aiGovernancePolicy: { findUnique: async (input: any) => {
      assert.deepEqual(input.where, { merchantId });
      return { version: 1, grants: [{ kind: "model", resource, roles, sources: [source] }] };
    } },
    aiGovernanceDecision: { create: async (input: any) => { decisions.push(input.data); return input.data; } },
  } as never, tenant);
  assert.equal(governance.models.has(resource), true);
  return { governance, decisions };
}
function worker(tenant: TenantContextService, work: () => Promise<void>) {
  const claim: WhatsAppInboxClaim = { id: "synthetic-role-inbox", dedupKey: "synthetic-role-dedup", eventId: "synthetic-role-event",
    kind: "message", merchantId, configId: "synthetic-role-config", deviceId: "META_CLOUD:synthetic-role-config",
    streamKey: "synthetic-role-stream", payloadHash: "synthetic-role-hash", leaseToken: "synthetic-role-lease", attempts: 1,
    payload: { merchantId, deviceId: "META_CLOUD:synthetic-role-config", fromNumber: "5511999995701",
      body: "Você pode chamar alguém da equipe?", messageType: "text", timestamp: Date.now(), provider: "META_CLOUD" } };
  Object.assign(claim.payload, { role: "owner", userId: "forged-owner", auth: { role: "admin" } });
  let next: WhatsAppInboxClaim | null = claim;
  const completed: string[] = [], failures: string[] = [], thrown: string[] = [];
  const instance = new WhatsAppWebhookWorker({
    claimNext: async () => { const value = next; next = null; return value; }, renew: async () => true,
    complete: async () => { completed.push(claim.id); return true; },
    fail: async (_claim: unknown, code: string) => { failures.push(code); return true; },
  } as never, { findById: async () => ({ id: claim.configId, merchantId, provider: "META_CLOUD", enabled: true }) } as never,
  { execute: async () => { try { await work(); } catch (error) { thrown.push(error instanceof Error ? error.message : "non_error"); throw error; } } } as never,
  { execute: async () => assert.fail("message cannot run status handler") } as never, undefined, tenant);
  return { instance, claim, completed, failures, thrown };
}

test("T57 WhatsApp buyer reaches the real existing buyer-only AI grant with a technical actor", async () => {
  const tenant = new TenantContextService(), { governance, decisions } = policy(tenant, ["buyer"]);
  let identity: unknown;
  const f = worker(tenant, async () => { identity = await governance.authorize({ merchantId, source }, "model", resource); });
  await f.instance.drain();
  // The old producer system role raises ai_invalid_actor_role in the actual
  // public governance API before it can evaluate this legitimate buyer grant.
  assert.deepEqual(f.thrown, []); assert.deepEqual(f.completed, [f.claim.id]); assert.deepEqual(f.failures, []);
  assert.deepEqual(identity, { merchantId, actorRole: "buyer", actorId: "whatsapp-inbox", teamId: undefined, source, correlationId: f.claim.id });
  assert.equal(decisions.length, 1); assert.equal(decisions[0]!.allowed, true);
  assert.equal(decisions[0]!.reason, "policy_grant"); assert.equal(decisions[0]!.actorRole, "buyer");
  assert.equal(decisions[0]!.actorId, "whatsapp-inbox"); assert.equal(decisions[0]!.merchantId, merchantId);
  assert.equal(decisions[0]!.resourceKind, "model"); assert.equal(decisions[0]!.resource, resource);
  assert.equal(decisions[0]!.policyVersion, 1); assert.equal(tenant.get(), null);
});

test("T57 a forged owner payload cannot spend an owner-only AI grant", async () => {
  const tenant = new TenantContextService(), { governance, decisions } = policy(tenant, ["owner"]);
  const f = worker(tenant, async () => { await governance.authorize({ merchantId, source }, "model", resource); });
  await f.instance.drain();
  assert.deepEqual(f.thrown, ["ai_access_denied"]); assert.deepEqual(f.completed, []);
  assert.deepEqual(f.failures, ["whatsapp_inbox_processing_failed"]);
  assert.equal(decisions.length, 1); assert.equal(decisions[0]!.allowed, false);
  assert.equal(decisions[0]!.reason, "policy_denied"); assert.equal(decisions[0]!.actorRole, "buyer");
  assert.equal(decisions[0]!.actorId, "whatsapp-inbox"); assert.equal(tenant.get(), null);
});

test("T57 the existing governance still rejects unsupported system roles", async () => {
  const tenant = new TenantContextService(), { governance, decisions } = policy(tenant, ["buyer"]);
  await assert.rejects(tenant.run({ merchantId, userId: "whatsapp-inbox", role: "system" },
    () => governance.identity({ merchantId, source })), /ai_invalid_actor_role/);
  assert.deepEqual(decisions, []); assert.equal(tenant.get(), null);
});
