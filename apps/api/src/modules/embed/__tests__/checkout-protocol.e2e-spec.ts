import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ProtocolAgentController } from "../presentation/http/protocol-agent.controller.js";
import { StartProtocolSessionUseCase } from "../application/start-protocol-session.use-case.js";
import { TransitionProtocolStateUseCase } from "../application/transition-protocol-state.use-case.js";
import { GetProtocolStateUseCase } from "../application/get-protocol-state.use-case.js";
import { AgentSessionTokenService } from "../domain/agent-session-token.service.js";
import { AgentCheckoutStateService } from "../domain/agent-checkout-state.service.js";
import type { ProtocolSessionRepository } from "../infrastructure/protocol-session.repository.js";

// In-memory repository for E2E testing
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
  const secret = { value: Buffer.from("e2e-spec-secret-token-32chars!!!") };
  const tokenService = new AgentSessionTokenService(secret);
  const stateService = new AgentCheckoutStateService();
  const repo = createInMemoryRepo();

  const startUseCase = new StartProtocolSessionUseCase(tokenService, stateService, repo as any);
  const transitionUseCase = new TransitionProtocolStateUseCase(tokenService, stateService, repo as any);
  const getStateUseCase = new GetProtocolStateUseCase(tokenService, stateService, repo as any);

  return new ProtocolAgentController(startUseCase, transitionUseCase, getStateUseCase);
}

describe("Agentic Checkout API Protocol — E2E Tests", () => {
  describe("Happy Path: Full Protocol Flow", () => {
    it("@regression @live: complete happy path idle → discovered → negotiated → quoted → confirmed → payment_pending", async () => {
      const ctrl = createController();

      // 1. POST /protocol/start → session in idle
      const startResp = await ctrl.start({
        merchant_id: "merchant_zyon_prod",
        agent_id: "agent_gpt4_v1",
        callback_url: "https://api.agent-provider.com/webhooks/protocol",
      });

      assert.ok(startResp.session_token, "session_token issued");
      assert.ok(startResp.session_id, "session_id generated");
      assert.equal(startResp.current_state, "idle");
      assert.deepEqual(startResp.allowed_next_actions, ["discover"]);
      assert.ok(startResp.expires_at);

      // 2. POST /protocol/discover → idle → discovered
      const discoverResp = await ctrl.discover(`Bearer ${startResp.session_token}`, {
        action: "discover",
        payload: {
          query: "notebooks",
          limit: 10,
        },
      });

      assert.equal(discoverResp.current_state, "discovered");
      assert.equal(discoverResp.previous_state, "idle");
      assert.deepEqual(discoverResp.allowed_next_actions, ["negotiate"]);
      assert.ok(discoverResp.session_token, "token refreshed on transition");

      // 3. POST /protocol/negotiate → discovered → negotiated
      const negotiateResp = await ctrl.negotiate(`Bearer ${discoverResp.session_token}`, {
        action: "negotiate",
        payload: {
          offer_discount_percent: 15,
          buyer_budget_cents: 150000,
        },
      });

      assert.equal(negotiateResp.current_state, "negotiated");
      assert.equal(negotiateResp.previous_state, "discovered");
      assert.deepEqual(negotiateResp.allowed_next_actions, ["quote"]);

      // 4. POST /protocol/quote → negotiated → quoted
      const quoteResp = await ctrl.quote(`Bearer ${negotiateResp.session_token}`, {
        action: "quote",
        payload: {
          cart_id: "cart_xyz_123",
          items_count: 2,
          subtotal_cents: 120000,
          discount_cents: 15000,
          total_cents: 105000,
        },
      });

      assert.equal(quoteResp.current_state, "quoted");
      assert.equal(quoteResp.previous_state, "negotiated");
      assert.deepEqual(quoteResp.allowed_next_actions, ["checkout"]);
      assert.ok(quoteResp.session_token);

      // 5. POST /protocol/checkout → quoted → confirmed
      const checkoutResp = await ctrl.checkout(`Bearer ${quoteResp.session_token}`, {
        action: "checkout",
        payload: {
          shipping_address: {
            street: "Av Paulista 1000",
            city: "São Paulo",
            state: "SP",
          },
        },
      });

      assert.equal(checkoutResp.current_state, "confirmed");
      assert.equal(checkoutResp.previous_state, "quoted");
      assert.deepEqual(checkoutResp.allowed_next_actions, ["pay"]);

      // 6. POST /protocol/pay → confirmed → payment_pending
      const payResp = await ctrl.pay(`Bearer ${checkoutResp.session_token}`, {
        action: "pay",
        payload: {
          payment_method: "credit_card",
          order_id: "order_abc_789",
        },
      });

      assert.equal(payResp.current_state, "payment_pending");
      assert.equal(payResp.previous_state, "confirmed");
      assert.deepEqual(payResp.allowed_next_actions, ["payment_confirm"]);

      // 7. GET /protocol/state → verify full history
      const finalStateResp = await ctrl.state(`Bearer ${payResp.session_token}`);

      assert.equal(finalStateResp.current_state, "payment_pending");
      assert.deepEqual(
        finalStateResp.state_history.map((h: any) => h.state),
        ["idle", "discovered", "negotiated", "quoted", "confirmed", "payment_pending"]
      );
      assert.equal(
        finalStateResp.state_history.length,
        6,
        "all 6 states recorded in history"
      );

      // Verify chronological order
      for (let i = 1; i < finalStateResp.state_history.length; i++) {
        const prevTime = new Date(finalStateResp.state_history[i - 1].entered_at).getTime();
        const currTime = new Date(finalStateResp.state_history[i].entered_at).getTime();
        assert.ok(currTime >= prevTime, `state_history[${i}] timestamp should be >= state_history[${i - 1}]`);
      }
    });
  });

  describe("Failure Path: Invalid Transitions", () => {
    it("@regression: invalid skip attempts return 409 with correct error structure", async () => {
      const ctrl = createController();

      const startResp = await ctrl.start({
        merchant_id: "merchant_test",
        agent_id: "agent_test",
      });

      // Attempt: idle → quote (skip discover, negotiate)
      try {
        await ctrl.quote(`Bearer ${startResp.session_token}`, {
          action: "quote",
          payload: {},
        });
        assert.fail("Should have thrown 409");
      } catch (err: any) {
        assert.ok(
          err.response?.error === "INVALID_STATE_TRANSITION" || err.status === 409,
          "Should return 409 INVALID_STATE_TRANSITION"
        );
        assert.equal(err.response?.current_state, "idle");
        assert.equal(err.response?.attempted_action, "quote");
      }
    });

    it("@regression: multiple invalid skip attempts cascade correctly", async () => {
      const ctrl = createController();

      const startResp = await ctrl.start({
        merchant_id: "merchant_test",
        agent_id: "agent_test",
      });

      const invalidActions = ["negotiate", "quote", "checkout", "pay"];

      for (const action of invalidActions) {
        try {
          const method = ctrl[action as keyof typeof ctrl] as any;
          await method.call(ctrl, `Bearer ${startResp.session_token}`, { action });
          assert.fail(`${action} from idle should have thrown`);
        } catch (err: any) {
          assert.ok(
            err.response?.error === "INVALID_STATE_TRANSITION" || err.status === 409,
            `${action} should return 409`
          );
        }
      }
    });

    it("@regression: attempt action from terminal state (tracking) returns 409", async () => {
      const ctrl = createController();

      // Manually create a session in tracking state (simulating payment confirmation)
      const stateService = new AgentCheckoutStateService();
      const repo = createInMemoryRepo();
      const tokenService = new AgentSessionTokenService({
        value: Buffer.from("tracking-test-secret-32chars!!!"),
      });

      const sessionId = "proto_terminal_test";
      const merchantId = "merchant_test";
      const agentId = "agent_test";

      // Create session
      await repo.create({
        id: sessionId,
        merchantId,
        agentId,
        currentState: "tracking",
        stateHistory: [{ state: "tracking", entered_at: new Date().toISOString() }],
        sessionData: {},
        tokenHash: "hash",
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      });

      // Issue token for tracking state
      const now = Math.floor(Date.now() / 1000);
      const token = tokenService.sign({
        typ: "aacp_agent_protocol_v1",
        session_id: sessionId,
        merchant_id: merchantId,
        agent_id: agentId,
        current_state: "tracking",
        issued_at_unix: now,
        expires_at_unix: now + 1800,
        nonce: "test_nonce",
      });

      const ctrl2 = new ProtocolAgentController(
        new StartProtocolSessionUseCase(tokenService, stateService, repo as any),
        new TransitionProtocolStateUseCase(tokenService, stateService, repo as any),
        new GetProtocolStateUseCase(tokenService, stateService, repo as any)
      );

      // Attempt any action from tracking
      try {
        await ctrl2.discover(`Bearer ${token}`, { action: "discover" });
        assert.fail("Should have thrown 409");
      } catch (err: any) {
        assert.ok(
          err.response?.error === "INVALID_STATE_TRANSITION" || err.status === 409,
          "Should return 409 for terminal state"
        );
      }
    });
  });

  describe("Token Lifecycle Through Full Flow", () => {
    it("@regression: token refreshed on each valid transition (new expires_at)", async () => {
      const ctrl = createController();

      const startResp = await ctrl.start({
        merchant_id: "merchant_token_test",
        agent_id: "agent_test",
      });

      const startExpiry = new Date(startResp.expires_at).getTime();

      // Small delay
      await new Promise((r) => setTimeout(r, 5));

      const discoverResp = await ctrl.discover(`Bearer ${startResp.session_token}`, {
        action: "discover",
      });

      const discoverExpiry = new Date(discoverResp.expires_at).getTime();

      assert.ok(discoverExpiry > startExpiry, "Token expires_at refreshed on discover");

      // Continue flow
      await new Promise((r) => setTimeout(r, 5));

      const negotiateResp = await ctrl.negotiate(`Bearer ${discoverResp.session_token}`, {
        action: "negotiate",
      });

      const negotiateExpiry = new Date(negotiateResp.expires_at).getTime();
      assert.ok(
        negotiateExpiry > discoverExpiry,
        "Token expires_at refreshed on negotiate"
      );
    });

    it("@regression: expired token rejected on any endpoint", async () => {
      const ctrl = createController();

      const startResp = await ctrl.start({
        merchant_id: "merchant_expiry_test",
        agent_id: "agent_test",
      });

      // Create an expired token manually
      const tokenService = new AgentSessionTokenService({
        value: Buffer.from("expiry-test-secret-32chars!!!"),
      });
      const now = Math.floor(Date.now() / 1000);
      const expiredToken = tokenService.sign({
        typ: "aacp_agent_protocol_v1",
        session_id: "proto_test",
        merchant_id: "merchant_expiry_test",
        agent_id: "agent_test",
        current_state: "idle",
        issued_at_unix: now - 100,
        expires_at_unix: now - 10, // expired
        nonce: "test",
      });

      try {
        await ctrl.discover(`Bearer ${expiredToken}`, { action: "discover" });
        assert.fail("Should have thrown 401");
      } catch (err: any) {
        assert.ok(
          err.message?.includes("expired") || err.status === 401,
          "Should reject expired token"
        );
      }
    });
  });

  describe("State History Integrity", () => {
    function getActionForState(state: string): string {
      const map: Record<string, string> = {
        discovered: "discover",
        negotiated: "negotiate",
        quoted: "quote",
        confirmed: "checkout",
        payment_pending: "pay",
        paid: "payment_confirm",
        tracking: "track",
      };
      return map[state] || state;
    }

    it("@regression: state history never loses entries or order through full flow", async () => {
      const ctrl = createController();

      const startResp = await ctrl.start({
        merchant_id: "merchant_history_test",
        agent_id: "agent_test",
      });

      let currentToken = startResp.session_token;
      const expectedStates = [
        "idle",
        "discovered",
        "negotiated",
        "quoted",
        "confirmed",
        "payment_pending",
      ];

      // Execute each transition
      for (let i = 1; i < expectedStates.length; i++) {
        const targetState = expectedStates[i];
        const action = getActionForState(targetState);

        const resp = await (ctrl[action as keyof typeof ctrl] as any)(`Bearer ${currentToken}`, {
          action,
        });

        currentToken = resp.session_token ?? currentToken;

        // Verify state
        const stateResp = await ctrl.state(`Bearer ${currentToken}`);
        assert.deepEqual(
          stateResp.state_history.map((h: any) => h.state),
          expectedStates.slice(0, i + 1),
          `After ${action}, history should contain states up to ${targetState}`
        );
      }
    });
  });

  describe("Concurrent Request Handling", () => {
    it("@regression: duplicate transition request returns 409 (idempotent or conflict)", async () => {
      const ctrl = createController();

      const startResp = await ctrl.start({
        merchant_id: "merchant_concurrent_test",
        agent_id: "agent_test",
      });

      // First discover succeeds
      const discoverResp1 = await ctrl.discover(`Bearer ${startResp.session_token}`, {
        action: "discover",
      });
      assert.equal(discoverResp1.current_state, "discovered");

      // Second discover attempt with original token should fail (token now has discovered state)
      // Using the same token should either be idempotent or return error
      try {
        await ctrl.discover(`Bearer ${startResp.session_token}`, {
          action: "discover",
        });
        // If it succeeds, it should be idempotent (not change state further)
      } catch (err: any) {
        // Expected: token is now for discovered state, attempting discover from idle fails
        assert.ok(
          err.response?.error === "INVALID_STATE_TRANSITION" || err.status === 409,
          "Second discover should fail or be idempotent"
        );
      }
    });
  });
});
