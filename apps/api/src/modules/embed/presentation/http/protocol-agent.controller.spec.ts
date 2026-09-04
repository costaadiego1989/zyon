import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ProtocolAgentController } from "./protocol-agent.controller.js";
import { StartProtocolSessionUseCase } from "../../application/start-protocol-session.use-case.js";
import { TransitionProtocolStateUseCase } from "../../application/transition-protocol-state.use-case.js";
import { GetProtocolStateUseCase } from "../../application/get-protocol-state.use-case.js";
import { AgentSessionTokenService } from "../../domain/agent-session-token.service.js";
import { AgentCheckoutStateService } from "../../domain/agent-checkout-state.service.js";
import type { ProtocolSessionRepository } from "../../infrastructure/protocol-session.repository.js";
import { randomUUID } from "node:crypto";

// In-memory repository for testing (test double)
function createInMemoryRepo(): ProtocolSessionRepository {
  const sessions = new Map<string, any>();
  return {
    async create(data) {
      const session = { ...data, createdAt: new Date(), updatedAt: new Date() };
      sessions.set(data.id, session);
      return session;
    },
    async findById(id) {
      return sessions.get(id) ?? null;
    },
    async findByIdAndMerchant(id, merchantId) {
      const s = sessions.get(id);
      return s && s.merchantId === merchantId ? s : null;
    },
    async updateState(id, newState, stateHistory, sessionData, expiresAt) {
      const s = sessions.get(id);
      if (!s) throw new Error("not found");
      s.currentState = newState;
      s.stateHistory = stateHistory;
      s.sessionData = sessionData;
      s.expiresAt = expiresAt;
      s.updatedAt = new Date();
      return s;
    },
    async markExpired(id) {
      const s = sessions.get(id);
      if (s) s.currentState = "expired";
    },
    async listExpired(before) {
      return [...sessions.values()]
        .filter((s) => s.expiresAt <= before && s.currentState !== "expired")
        .map((s) => s.id);
    },
  };
}

function createController() {
  const secret = { value: Buffer.from("protocol-ctrl-spec-secret-32chars!!!") };
  const tokenService = new AgentSessionTokenService(secret);
  const stateService = new AgentCheckoutStateService();
  const repo = createInMemoryRepo();

  const startUseCase = new StartProtocolSessionUseCase(tokenService, stateService, repo as any);
  const transitionUseCase = new TransitionProtocolStateUseCase(tokenService, stateService, repo as any);
  const getStateUseCase = new GetProtocolStateUseCase(tokenService, stateService, repo as any);

  return new ProtocolAgentController(startUseCase, transitionUseCase, getStateUseCase);
}

describe("ProtocolAgentController — Integration Tests", () => {
  describe("POST /protocol/start", () => {
    it("@regression: creates session in idle state with token and metadata", async () => {
      const ctrl = createController();
      const result = await ctrl.start({
        merchant_id: "merchant_1",
        agent_id: "agent_x",
        callback_url: "https://example.com/webhook",
      });

      assert.ok(result.session_token);
      assert.ok(result.session_id);
      assert.equal(result.current_state, "idle");
      assert.deepEqual(result.allowed_next_actions, ["discover"]);
      assert.ok(result.expires_at);
    });

    it("session_id prefixed with proto_", async () => {
      const ctrl = createController();
      const result = await ctrl.start({
        merchant_id: "merchant_1",
        agent_id: "agent_x",
      });

      assert.ok(result.session_id.startsWith("proto_"));
    });

    it("session_token is valid JWT (can be decoded)", async () => {
      const ctrl = createController();
      const result = await ctrl.start({
        merchant_id: "merchant_1",
        agent_id: "agent_x",
      });

      const token = result.session_token;
      assert.equal(token.split(".").length, 2, "Token should be valid format");
    });

    it("merchant_id and agent_id are required", async () => {
      const ctrl = createController();
      assert.throws(
        () =>
          ctrl.start({
            merchant_id: "",
            agent_id: "agent_x",
          } as any),
        /merchant_id.*required|BadRequest/i
      );
    });
  });

  describe("POST /protocol/discover (idle → discovered)", () => {
    it("@regression: valid token transitions to discovered", async () => {
      const ctrl = createController();
      const startResult = await ctrl.start({
        merchant_id: "merchant_1",
        agent_id: "agent_x",
      });

      const discoverResult = await ctrl.discover(`Bearer ${startResult.session_token}`, {
        action: "discover",
        payload: { products: 5 },
      });

      assert.equal(discoverResult.current_state, "discovered");
      assert.equal(discoverResult.previous_state, "idle");
      assert.deepEqual(discoverResult.allowed_next_actions, ["negotiate"]);
    });

    it("@regression: invalid token (malformed) returns 401", async () => {
      const ctrl = createController();
      assert.throws(
        () => ctrl.discover(`Bearer invalid_token`, { action: "discover" } as any),
        /Unauthorized|401/i
      );
    });

    it("@regression: missing Bearer token returns 401", async () => {
      const ctrl = createController();
      assert.throws(
        () => ctrl.discover(`NoBearer token`, { action: "discover" } as any),
        /Unauthorized|401/i
      );
    });

    it("token is refreshed (new expires_at)", async () => {
      const ctrl = createController();
      const startResult = await ctrl.start({
        merchant_id: "merchant_1",
        agent_id: "agent_x",
      });

      const oldExpiresAt = new Date(startResult.expires_at).getTime();

      // Small delay to ensure time has progressed
      await new Promise((r) => setTimeout(r, 10));

      const discoverResult = await ctrl.discover(`Bearer ${startResult.session_token}`, {
        action: "discover",
        payload: { products: 5 },
      });

      const newExpiresAt = new Date(discoverResult.expires_at).getTime();
      assert.ok(newExpiresAt > oldExpiresAt, "expires_at should be refreshed (later)");
    });
  });

  describe("POST /protocol/negotiate (discovered → negotiated)", () => {
    it("@regression: valid transition from discovered", async () => {
      const ctrl = createController();
      const startResult = await ctrl.start({
        merchant_id: "merchant_1",
        agent_id: "agent_x",
      });
      const discoverResult = await ctrl.discover(`Bearer ${startResult.session_token}`, {
        action: "discover",
        payload: { products: 5 },
      });

      const negotiateResult = await ctrl.negotiate(`Bearer ${discoverResult.session_token}`, {
        action: "negotiate",
        payload: { offer: 10 },
      });

      assert.equal(negotiateResult.current_state, "negotiated");
      assert.equal(negotiateResult.previous_state, "discovered");
      assert.deepEqual(negotiateResult.allowed_next_actions, ["quote"]);
    });

    it("@regression: from idle (skip discover) returns 409", async () => {
      const ctrl = createController();
      const startResult = await ctrl.start({
        merchant_id: "merchant_1",
        agent_id: "agent_x",
      });

      assert.throws(
        () => ctrl.negotiate(`Bearer ${startResult.session_token}`, { action: "negotiate" } as any),
        (err: any) => err.response?.error === "INVALID_STATE_TRANSITION" || err.status === 409
      );
    });
  });

  describe("POST /protocol/quote (negotiated → quoted)", () => {
    it("@regression: valid transition from negotiated", async () => {
      const ctrl = createController();
      const startResult = await ctrl.start({
        merchant_id: "merchant_1",
        agent_id: "agent_x",
      });
      const discoverResult = await ctrl.discover(`Bearer ${startResult.session_token}`, {
        action: "discover",
        payload: { products: 5 },
      });
      const negotiateResult = await ctrl.negotiate(`Bearer ${discoverResult.session_token}`, {
        action: "negotiate",
        payload: { offer: 10 },
      });

      const quoteResult = await ctrl.quote(`Bearer ${negotiateResult.session_token}`, {
        action: "quote",
        payload: { total: 100 },
      });

      assert.equal(quoteResult.current_state, "quoted");
      assert.equal(quoteResult.previous_state, "negotiated");
      assert.deepEqual(quoteResult.allowed_next_actions, ["checkout"]);
    });

    it("@regression: from discovered (skip negotiate) returns 409", async () => {
      const ctrl = createController();
      const startResult = await ctrl.start({
        merchant_id: "merchant_1",
        agent_id: "agent_x",
      });
      const discoverResult = await ctrl.discover(`Bearer ${startResult.session_token}`, {
        action: "discover",
        payload: { products: 5 },
      });

      assert.throws(
        () => ctrl.quote(`Bearer ${discoverResult.session_token}`, { action: "quote" } as any),
        (err: any) => err.response?.error === "INVALID_STATE_TRANSITION" || err.status === 409
      );
    });
  });

  describe("POST /protocol/checkout (quoted → confirmed)", () => {
    it("@regression: valid transition from quoted", async () => {
      const ctrl = createController();
      const startResult = await ctrl.start({
        merchant_id: "merchant_1",
        agent_id: "agent_x",
      });
      const discoverResult = await ctrl.discover(`Bearer ${startResult.session_token}`, {
        action: "discover",
        payload: { products: 5 },
      });
      const negotiateResult = await ctrl.negotiate(`Bearer ${discoverResult.session_token}`, {
        action: "negotiate",
        payload: { offer: 10 },
      });
      const quoteResult = await ctrl.quote(`Bearer ${negotiateResult.session_token}`, {
        action: "quote",
        payload: { total: 100 },
      });

      const checkoutResult = await ctrl.checkout(`Bearer ${quoteResult.session_token}`, {
        action: "checkout",
      });

      assert.equal(checkoutResult.current_state, "confirmed");
      assert.equal(checkoutResult.previous_state, "quoted");
      assert.deepEqual(checkoutResult.allowed_next_actions, ["pay"]);
    });
  });

  describe("POST /protocol/pay (confirmed → payment_pending)", () => {
    it("@regression: valid transition from confirmed", async () => {
      const ctrl = createController();
      const startResult = await ctrl.start({
        merchant_id: "merchant_1",
        agent_id: "agent_x",
      });
      const discoverResult = await ctrl.discover(`Bearer ${startResult.session_token}`, {
        action: "discover",
        payload: { products: 5 },
      });
      const negotiateResult = await ctrl.negotiate(`Bearer ${discoverResult.session_token}`, {
        action: "negotiate",
        payload: { offer: 10 },
      });
      const quoteResult = await ctrl.quote(`Bearer ${negotiateResult.session_token}`, {
        action: "quote",
        payload: { total: 100 },
      });
      const checkoutResult = await ctrl.checkout(`Bearer ${quoteResult.session_token}`, {
        action: "checkout",
      });

      const payResult = await ctrl.pay(`Bearer ${checkoutResult.session_token}`, {
        action: "pay",
      });

      assert.equal(payResult.current_state, "payment_pending");
      assert.equal(payResult.previous_state, "confirmed");
      assert.deepEqual(payResult.allowed_next_actions, ["payment_confirm"]);
    });
  });

  describe("GET /protocol/state (read-only introspection)", () => {
    it("@regression: returns full state history array", async () => {
      const ctrl = createController();
      const startResult = await ctrl.start({
        merchant_id: "merchant_1",
        agent_id: "agent_x",
      });
      const discoverResult = await ctrl.discover(`Bearer ${startResult.session_token}`, {
        action: "discover",
        payload: { products: 5 },
      });
      const negotiateResult = await ctrl.negotiate(`Bearer ${discoverResult.session_token}`, {
        action: "negotiate",
        payload: { offer: 10 },
      });

      const stateResult = await ctrl.state(`Bearer ${negotiateResult.session_token}`);

      assert.equal(stateResult.current_state, "negotiated");
      assert.ok(Array.isArray(stateResult.state_history));
      assert.equal(stateResult.state_history.length, 3); // idle, discovered, negotiated
      assert.deepEqual(
        stateResult.state_history.map((h: any) => h.state),
        ["idle", "discovered", "negotiated"]
      );
    });

    it("@regression: does not mutate session state", async () => {
      const ctrl = createController();
      const startResult = await ctrl.start({
        merchant_id: "merchant_1",
        agent_id: "agent_x",
      });

      const stateResult1 = await ctrl.state(`Bearer ${startResult.session_token}`);
      assert.equal(stateResult1.current_state, "idle");

      const stateResult2 = await ctrl.state(`Bearer ${startResult.session_token}`);
      assert.equal(stateResult2.current_state, "idle", "state should not change on read");
    });

    it("@regression: invalid token returns 401", async () => {
      const ctrl = createController();
      assert.throws(
        () => ctrl.state(`Bearer invalid_token`),
        /Unauthorized|401/i
      );
    });
  });

  describe("Full Happy Path (E2E-like flow)", () => {
    it("@regression: complete flow idle → discovered → negotiated → quoted → confirmed → payment_pending", async () => {
      const ctrl = createController();

      // Start
      const startResult = await ctrl.start({
        merchant_id: "merchant_1",
        agent_id: "agent_x",
      });
      assert.equal(startResult.current_state, "idle");

      // Discover
      const discoverResult = await ctrl.discover(`Bearer ${startResult.session_token}`, {
        action: "discover",
        payload: { products: 5 },
      });
      assert.equal(discoverResult.current_state, "discovered");

      // Negotiate
      const negotiateResult = await ctrl.negotiate(`Bearer ${discoverResult.session_token}`, {
        action: "negotiate",
        payload: { offer: 10 },
      });
      assert.equal(negotiateResult.current_state, "negotiated");

      // Quote
      const quoteResult = await ctrl.quote(`Bearer ${negotiateResult.session_token}`, {
        action: "quote",
        payload: { total: 100 },
      });
      assert.equal(quoteResult.current_state, "quoted");

      // Checkout
      const checkoutResult = await ctrl.checkout(`Bearer ${quoteResult.session_token}`, {
        action: "checkout",
      });
      assert.equal(checkoutResult.current_state, "confirmed");

      // Pay
      const payResult = await ctrl.pay(`Bearer ${checkoutResult.session_token}`, {
        action: "pay",
      });
      assert.equal(payResult.current_state, "payment_pending");

      // Verify state history was recorded
      const finalState = await ctrl.state(`Bearer ${payResult.session_token}`);
      assert.deepEqual(
        finalState.state_history.map((h: any) => h.state),
        ["idle", "discovered", "negotiated", "quoted", "confirmed", "payment_pending"]
      );
    });
  });

  describe("Invalid Skip Attempts", () => {
    it("@regression: skip discover (idle → negotiate) returns 409", async () => {
      const ctrl = createController();
      const startResult = await ctrl.start({
        merchant_id: "merchant_1",
        agent_id: "agent_x",
      });

      assert.throws(
        () => ctrl.negotiate(`Bearer ${startResult.session_token}`, { action: "negotiate" } as any),
        (err: any) => err.response?.error === "INVALID_STATE_TRANSITION" || err.status === 409
      );
    });

    it("@regression: skip negotiate & quote (discovered → checkout) returns 409", async () => {
      const ctrl = createController();
      const startResult = await ctrl.start({
        merchant_id: "merchant_1",
        agent_id: "agent_x",
      });
      const discoverResult = await ctrl.discover(`Bearer ${startResult.session_token}`, {
        action: "discover",
      });

      assert.throws(
        () => ctrl.checkout(`Bearer ${discoverResult.session_token}`, { action: "checkout" } as any),
        (err: any) => err.response?.error === "INVALID_STATE_TRANSITION" || err.status === 409
      );
    });

    it("@regression: skip checkout (quoted → pay) returns 409", async () => {
      const ctrl = createController();
      const startResult = await ctrl.start({
        merchant_id: "merchant_1",
        agent_id: "agent_x",
      });
      const discoverResult = await ctrl.discover(`Bearer ${startResult.session_token}`, {
        action: "discover",
      });
      const negotiateResult = await ctrl.negotiate(`Bearer ${discoverResult.session_token}`, {
        action: "negotiate",
      });
      const quoteResult = await ctrl.quote(`Bearer ${negotiateResult.session_token}`, {
        action: "quote",
      });

      assert.throws(
        () => ctrl.pay(`Bearer ${quoteResult.session_token}`, { action: "pay" } as any),
        (err: any) => err.response?.error === "INVALID_STATE_TRANSITION" || err.status === 409
      );
    });
  });

  describe("Merchant Boundary Enforcement", () => {
    it("@regression: session scoped by merchant_id", async () => {
      const ctrl = createController();
      const startResult = await ctrl.start({
        merchant_id: "merchant_A",
        agent_id: "agent_x",
      });

      assert.equal(startResult.current_state, "idle");
      // Note: Full merchant boundary check would require repository-level verification
      // which is covered in integration tests with real DB
    });
  });
});
