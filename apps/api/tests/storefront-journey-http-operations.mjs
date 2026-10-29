import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { IncomingMessage, Server, ServerResponse } from "node:http";
import { z } from "zod";
import { readJourneyCapability, revalidateJourneyCapability } from "./storefront-journey-guards.mjs";
import { assertCanonicalJourneyClaims, journeyArtifactModuleUrl } from "./storefront-journey-canonical-bindings.mjs";
import { assertJourneyTransportCapability } from "./storefront-journey-transport.mjs";

const operationSchema = z.strictObject({ operationId: z.uuidv4(), stage: z.enum(["turn", "tool", "classifier", "copy", "nudge"]) });
const slotHeader = "x-aacp-journey-slot";
function singleHeader(request, key) {
  const count = request.rawHeaders.filter((_, index) => index % 2 === 0).filter(name => name.toLowerCase() === key).length;
  assert.equal(count, 1, "journey_single_security_header_required");
  assert.equal(typeof request.headers[key], "string", "journey_security_header_required");
  return request.headers[key];
}
function bearer(request, key) {
  const value = singleHeader(request, key);
  assert.ok(value.startsWith("Bearer ") && value.length <= 8200 && !/\s/.test(value.slice(7)), "journey_signed_credential_required");
  return value.slice(7);
}

/** TEST ONLY: no production middleware or auth/repository override. Header is a
 * lookup key for a private, revalidated, single-use runner slot; never a grant.
 * The same actual verifier-backed capability must be used by transport/egress.
 * Contract resource doubles are not final SQL/Redis/HTTP-application proof. */
export async function createJourneyHttpOperations(input) {
  assert.deepEqual(Object.keys(input).sort(), ["capability", "transport", "buyerJwt", "capabilities", "listener", "artifactTree", "routePrefix"].sort(), "journey_http_dependencies_required");
  const { capability, transport, buyerJwt, capabilities, listener, artifactTree, routePrefix } = input;
  const manifest = readJourneyCapability(capability);
  await revalidateJourneyCapability(capability);
  assert.ok(listener instanceof Server && listener.listening, "journey_owned_http_listener_required");
  const address = listener.address();
  assert.ok(address && address.address === "127.0.0.1" && address.port === Number(new URL(manifest.apiOrigin).port), "journey_exact_http_listener_required");
  assert.ok(routePrefix === "" || routePrefix === "/v1", "journey_canonical_route_prefix_required");
  assert.ok(transport && typeof transport.runOperation === "function", "journey_controlled_transport_required");
  assertJourneyTransportCapability(transport, capability);
  const [{ BuyerJwtService }, { RealtimeCapabilityService }] = await Promise.all([
    import(journeyArtifactModuleUrl(artifactTree, "modules/buyer-account/domain/services/buyer-jwt.service")),
    import(journeyArtifactModuleUrl(artifactTree, "shared/auth/realtime-capability")),
  ]);
  assert.ok(buyerJwt instanceof BuyerJwtService && capabilities instanceof RealtimeCapabilityService, "journey_canonical_auth_instances_required");
  const verifyBuyer = BuyerJwtService.prototype.verify.bind(buyerJwt), verifyConversation = RealtimeCapabilityService.prototype.verify.bind(capabilities);
  const path = `${routePrefix}/storefront/conversations/${manifest.sessionId}/messages`;
  const slots = new Map(), operations = new Map(), active = new Set();
  let closed = false;
  const live = () => assert.equal(closed, false, "journey_http_bridge_closed");
  const outcome = (slot, value) => { if (!slot.finished) { slot.finished = true; slot.resolve(Object.freeze(value)); } };
  const deny = (response, code = "journey_http_admission_failed") => {
    if (!response.headersSent && !response.destroyed) {
      response.statusCode = 403; response.setHeader("content-type", "application/json"); response.end(JSON.stringify({ code }));
    }
  };
  async function handle(request, response, next) {
    live();
    assert.ok(request instanceof IncomingMessage && response instanceof ServerResponse, "journey_actual_http_request_required");
    const actualPath = request.originalUrl ?? request.url;
    // No operation context for any other route. Missing context remains denied
    // by the controlled provider; this bridge never silently grants other paths.
    let decodedPath;
    try { decodedPath = decodeURIComponent(new URL(actualPath, manifest.apiOrigin).pathname); } catch {}
    const messageRoute = decodedPath?.startsWith(`${routePrefix}/storefront/conversations/`) && decodedPath.endsWith("/messages");
    if (!messageRoute && !request.headers[slotHeader]) { next(); return; }
    let slot;
    try {
      const token = z.uuidv4().parse(singleHeader(request, slotHeader));
      slot = slots.get(token);
      assert.ok(slot, "journey_http_slot_missing_or_consumed");
      slots.delete(token); // atomic before ANY auth/resource await, no retry
      assert.equal(request.method, slot.method, "journey_http_method_mismatch");
      assert.equal(actualPath, slot.path, "journey_http_path_mismatch");
      assert.ok(Date.now() <= slot.expiresAt, "journey_http_slot_expired");
      const currentAddress = listener.address();
      assert.ok(listener.listening && currentAddress && currentAddress.address === "127.0.0.1" && currentAddress.port === address.port
        && request.socket.localAddress === "127.0.0.1" && request.socket.localPort === address.port, "journey_http_listener_mismatch");
      const origin = singleHeader(request, "origin");
      assert.equal(origin, manifest.apiOrigin, "journey_http_origin_mismatch");
      const buyer = verifyBuyer(bearer(request, "x-buyer-authorization"));
      const conversation = verifyConversation(bearer(request, "authorization"), "storefront-conversation", origin);
      assertCanonicalJourneyClaims(manifest, buyer, conversation);
      await revalidateJourneyCapability(capability);
      live();
      assert.ok(!request.aborted && !response.destroyed, "journey_http_request_closed_before_admission");
    } catch {
      if (slot) outcome(slot, { outcome: "failed", code: "journey_http_admission_failed" });
      deny(response); return;
    }
    active.add(slot.operation.operationId);
    try {
      await transport.runOperation(slot.operation, () => new Promise((resolve, reject) => {
        let done = false;
        const finish = error => {
          if (done) return; done = true;
          response.off("finish", finished); response.off("close", ended); request.off("aborted", aborted);
          if (error) reject(error); else resolve();
        };
        const finished = () => finish(), ended = () => finish(Error("journey_http_response_closed")), aborted = () => finish(Error("journey_http_request_aborted"));
        response.once("finish", finished); response.once("close", ended); request.once("aborted", aborted);
        try { next(); } catch (error) { finish(error); }
      }));
      outcome(slot, { outcome: "completed", code: "none" });
    } catch {
      outcome(slot, { outcome: "failed", code: "journey_http_operation_failed" });
      deny(response, "journey_http_operation_failed");
    } finally { active.delete(slot.operation.operationId); }
  }
  return Object.freeze({
    async register(rawOperation) {
      live(); const operation = operationSchema.parse(rawOperation);
      assert.equal(operations.has(operation.operationId), false, "journey_http_operation_replayed");
      // Reserve the operation ID before awaiting resource revalidation.
      const slot = { operation: structuredClone(operation), method: "POST", path, expiresAt: Date.now() + 10_000, finished: false };
      slot.settled = new Promise(resolve => { slot.resolve = resolve; });
      operations.set(operation.operationId, slot);
      try { await revalidateJourneyCapability(capability); live(); }
      catch (error) { outcome(slot, { outcome: "failed", code: "journey_http_admission_failed" }); throw error; }
      const token = randomUUID(); slots.set(token, slot); return token;
    },
    middleware(request, response, next) { void handle(request, response, next).catch(() => deny(response)); },
    async waitForOperation(operationId) {
      const slot = operations.get(operationId); assert.ok(slot, "journey_http_operation_unknown");
      let timer;
      try { return await Promise.race([slot.settled, new Promise((_, reject) => { timer = setTimeout(() => reject(Error("journey_http_operation_deadline")), 70_000); })]); }
      finally { clearTimeout(timer); }
    },
    dispose() {
      assert.equal(active.size, 0, "journey_http_active_operation_cleanup_forbidden");
      closed = true;
      for (const slot of slots.values()) outcome(slot, { outcome: "failed", code: "journey_http_admission_failed" });
      slots.clear();
    },
  });
}
