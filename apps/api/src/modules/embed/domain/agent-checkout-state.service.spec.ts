import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AgentCheckoutStateService } from "./agent-checkout-state.service.js";

const createService = () => new AgentCheckoutStateService();

describe("AgentCheckoutStateService — State Machine Validation", () => {
  describe("Valid Transitions (8 tests)", () => {
    it("@regression: idle → discovered is allowed", () => {
      const svc = createService();
      assert.doesNotThrow(() => svc.validateTransition("idle", "discovered", "discover"));
    });

    it("@regression: discovered → negotiated is allowed", () => {
      const svc = createService();
      assert.doesNotThrow(() => svc.validateTransition("discovered", "negotiated", "negotiate"));
    });

    it("@regression: negotiated → quoted is allowed", () => {
      const svc = createService();
      assert.doesNotThrow(() => svc.validateTransition("negotiated", "quoted", "quote"));
    });

    it("@regression: quoted → confirmed (checkout) is allowed", () => {
      const svc = createService();
      assert.doesNotThrow(() => svc.validateTransition("quoted", "confirmed", "checkout"));
    });

    it("@regression: confirmed → payment_pending is allowed", () => {
      const svc = createService();
      assert.doesNotThrow(() => svc.validateTransition("confirmed", "payment_pending", "pay"));
    });

    it("@regression: payment_pending → paid is allowed", () => {
      const svc = createService();
      assert.doesNotThrow(() => svc.validateTransition("payment_pending", "paid", "payment_confirm"));
    });

    it("@regression: paid → tracking is allowed (terminal)", () => {
      const svc = createService();
      assert.doesNotThrow(() => svc.validateTransition("paid", "tracking", "track"));
    });

    it("@regression: tracking state is terminal", () => {
      const svc = createService();
      assert.equal(svc.isTerminal("tracking"), true);
    });
  });

  describe("Invalid Skip Transitions (409 Conflict)", () => {
    it("@regression: idle → quoted (skip discovered, negotiated) throws INVALID_STATE_TRANSITION", () => {
      const svc = createService();
      assert.throws(
        () => svc.validateTransition("idle", "quoted", "quote"),
        (err: any) => err.response?.error === "INVALID_STATE_TRANSITION"
      );
    });

    it("@regression: idle → negotiated (skip discovered) throws INVALID_STATE_TRANSITION", () => {
      const svc = createService();
      assert.throws(
        () => svc.validateTransition("idle", "negotiated", "negotiate"),
        (err: any) => err.response?.error === "INVALID_STATE_TRANSITION"
      );
    });

    it("@regression: idle → confirmed (skip all) throws INVALID_STATE_TRANSITION", () => {
      const svc = createService();
      assert.throws(
        () => svc.validateTransition("idle", "confirmed", "checkout"),
        (err: any) => err.response?.error === "INVALID_STATE_TRANSITION"
      );
    });

    it("@regression: discovered → confirmed (skip negotiated, quoted) throws INVALID_STATE_TRANSITION", () => {
      const svc = createService();
      assert.throws(
        () => svc.validateTransition("discovered", "confirmed", "checkout"),
        (err: any) => err.response?.error === "INVALID_STATE_TRANSITION"
      );
    });

    it("@regression: discovered → quoted (skip negotiated) throws INVALID_STATE_TRANSITION", () => {
      const svc = createService();
      assert.throws(
        () => svc.validateTransition("discovered", "quoted", "quote"),
        (err: any) => err.response?.error === "INVALID_STATE_TRANSITION"
      );
    });

    it("@regression: negotiated → confirmed (skip quoted) throws INVALID_STATE_TRANSITION", () => {
      const svc = createService();
      assert.throws(
        () => svc.validateTransition("negotiated", "confirmed", "checkout"),
        (err: any) => err.response?.error === "INVALID_STATE_TRANSITION"
      );
    });

    it("@regression: quoted → payment_pending (skip confirmed) throws INVALID_STATE_TRANSITION", () => {
      const svc = createService();
      assert.throws(
        () => svc.validateTransition("quoted", "payment_pending", "pay"),
        (err: any) => err.response?.error === "INVALID_STATE_TRANSITION"
      );
    });

    it("@regression: confirmed → paid (skip payment_pending) throws INVALID_STATE_TRANSITION", () => {
      const svc = createService();
      assert.throws(
        () => svc.validateTransition("confirmed", "paid", "payment_confirm"),
        (err: any) => err.response?.error === "INVALID_STATE_TRANSITION"
      );
    });
  });

  describe("Reverse Transitions (invalid)", () => {
    it("@regression: negotiated → discovered (back) throws INVALID_STATE_TRANSITION", () => {
      const svc = createService();
      assert.throws(
        () => svc.validateTransition("negotiated", "idle", "restart"),
        (err: any) => err.response?.error === "INVALID_STATE_TRANSITION"
      );
    });

    it("@regression: quoted → idle throws INVALID_STATE_TRANSITION", () => {
      const svc = createService();
      assert.throws(
        () => svc.validateTransition("quoted", "idle", "restart"),
        (err: any) => err.response?.error === "INVALID_STATE_TRANSITION"
      );
    });

    it("@regression: confirmed → idle throws INVALID_STATE_TRANSITION", () => {
      const svc = createService();
      assert.throws(
        () => svc.validateTransition("confirmed", "idle", "restart"),
        (err: any) => err.response?.error === "INVALID_STATE_TRANSITION"
      );
    });

    it("@regression: payment_pending → idle throws INVALID_STATE_TRANSITION", () => {
      const svc = createService();
      assert.throws(
        () => svc.validateTransition("payment_pending", "idle", "restart"),
        (err: any) => err.response?.error === "INVALID_STATE_TRANSITION"
      );
    });

    it("@regression: paid → idle throws INVALID_STATE_TRANSITION", () => {
      const svc = createService();
      assert.throws(
        () => svc.validateTransition("paid", "idle", "restart"),
        (err: any) => err.response?.error === "INVALID_STATE_TRANSITION"
      );
    });
  });

  describe("Terminal State (tracking) — No Further Transitions", () => {
    it("@regression: tracking → discover throws INVALID_STATE_TRANSITION", () => {
      const svc = createService();
      assert.throws(
        () => svc.validateTransition("tracking", "idle", "restart"),
        (err: any) => err.response?.error === "INVALID_STATE_TRANSITION"
      );
    });

    it("@regression: tracking → negotiated throws INVALID_STATE_TRANSITION", () => {
      const svc = createService();
      assert.throws(
        () => svc.validateTransition("tracking", "negotiated", "negotiate"),
        (err: any) => err.response?.error === "INVALID_STATE_TRANSITION"
      );
    });

    it("@regression: tracking → any state throws INVALID_STATE_TRANSITION", () => {
      const svc = createService();
      const states = ["idle", "discovered", "negotiated", "quoted", "confirmed", "payment_pending", "paid"];
      states.forEach((state) => {
        assert.throws(
          () => svc.validateTransition("tracking", state, "action"),
          (err: any) => err.response?.error === "INVALID_STATE_TRANSITION"
        );
      });
    });
  });

  describe("Error Payload Structure", () => {
    it("@regression: error includes current_state, attempted_action, required_state, message", () => {
      const svc = createService();
      try {
        svc.validateTransition("idle", "quoted", "quote");
        assert.fail("Should have thrown");
      } catch (err: unknown) {
        const response = (err as any).response;
        assert.ok(response, "Error should have response");
        assert.equal(response.error, "INVALID_STATE_TRANSITION");
        assert.equal(response.current_state, "idle");
        assert.equal(response.attempted_action, "quote");
        assert.ok(response.required_state, "required_state should be present");
        assert.ok(response.message, "message should be present");
      }
    });

    it("@regression: required_state shows next allowed state from current", () => {
      const svc = createService();
      try {
        svc.validateTransition("discovered", "confirmed", "checkout");
        assert.fail("Should have thrown");
      } catch (err: unknown) {
        const response = (err as any).response;
        assert.equal(response.required_state, "negotiated", "Should show next allowed state");
      }
    });
  });
});

describe("AgentCheckoutStateService — Allowed Next Actions", () => {
  describe("getAllowedNextActions for each state", () => {
    it("@regression: idle → [discover]", () => {
      const svc = createService();
      assert.deepEqual(svc.getAllowedNextActions("idle"), ["discover"]);
    });

    it("@regression: discovered → [negotiate]", () => {
      const svc = createService();
      assert.deepEqual(svc.getAllowedNextActions("discovered"), ["negotiate"]);
    });

    it("@regression: negotiated → [quote]", () => {
      const svc = createService();
      assert.deepEqual(svc.getAllowedNextActions("negotiated"), ["quote"]);
    });

    it("@regression: quoted → [checkout]", () => {
      const svc = createService();
      assert.deepEqual(svc.getAllowedNextActions("quoted"), ["checkout"]);
    });

    it("@regression: confirmed → [pay]", () => {
      const svc = createService();
      assert.deepEqual(svc.getAllowedNextActions("confirmed"), ["pay"]);
    });

    it("@regression: payment_pending → [payment_confirm]", () => {
      const svc = createService();
      assert.deepEqual(svc.getAllowedNextActions("payment_pending"), ["payment_confirm"]);
    });

    it("@regression: paid → [track]", () => {
      const svc = createService();
      assert.deepEqual(svc.getAllowedNextActions("paid"), ["track"]);
    });

    it("@regression: tracking → [] (terminal)", () => {
      const svc = createService();
      assert.deepEqual(svc.getAllowedNextActions("tracking"), []);
    });

    it("unknown state → []", () => {
      const svc = createService();
      assert.deepEqual(svc.getAllowedNextActions("unknown_state"), []);
    });
  });
});

describe("AgentCheckoutStateService — State History", () => {
  it("@regression: recordStateTransition appends new entry to history", () => {
    const svc = createService();
    const history = [
      {
        state: "idle",
        entered_at: "2026-08-20T10:00:00Z",
      },
    ];

    const newHistory = svc.recordStateTransition(history, "discovered");

    assert.equal(newHistory.length, 2);
    assert.equal(newHistory[0].state, "idle");
    assert.equal(newHistory[1].state, "discovered");
    assert.ok(newHistory[1].entered_at);
  });

  it("@regression: recordStateTransition preserves chronological order", () => {
    const svc = createService();
    const history = [{ state: "idle", entered_at: "2026-08-20T10:00:00Z" }];

    const history2 = svc.recordStateTransition(history, "discovered");
    const history3 = svc.recordStateTransition(history2, "negotiated");
    const history4 = svc.recordStateTransition(history3, "quoted");

    assert.equal(history4.length, 4);
    assert.deepEqual(
      history4.map((h) => h.state),
      ["idle", "discovered", "negotiated", "quoted"]
    );
  });

  it("@regression: state history never loses entries", () => {
    const svc = createService();
    let history = [{ state: "idle", entered_at: "2026-08-20T10:00:00Z" }];

    const transitions = ["discovered", "negotiated", "quoted", "confirmed", "payment_pending", "paid"];
    transitions.forEach((state) => {
      history = svc.recordStateTransition(history, state);
    });

    assert.equal(history.length, 1 + transitions.length);
    transitions.forEach((state, idx) => {
      assert.equal(history[idx + 1].state, state);
    });
  });

  it("@regression: each state history entry has entered_at timestamp", () => {
    const svc = createService();
    const history = [{ state: "idle", entered_at: "2026-08-20T10:00:00Z" }];

    const history2 = svc.recordStateTransition(history, "discovered");
    const history3 = svc.recordStateTransition(history2, "negotiated");

    history3.forEach((entry) => {
      assert.ok(entry.entered_at);
      assert.ok(new Date(entry.entered_at).getTime() > 0, "entered_at should be valid ISO timestamp");
    });
  });

  it("@regression: timestamps maintain chronological order after rapid transitions", () => {
    const svc = createService();
    let history = [{ state: "idle", entered_at: "2026-08-20T10:00:00Z" }];

    const transitions = ["discovered", "negotiated", "quoted", "confirmed", "payment_pending", "paid"];
    transitions.forEach((state) => {
      history = svc.recordStateTransition(history, state);
    });

    for (let i = 1; i < history.length; i++) {
      const prev = new Date(history[i - 1].entered_at).getTime();
      const curr = new Date(history[i].entered_at).getTime();
      assert.ok(curr >= prev, `history[${i}] timestamp should be >= history[${i - 1}]`);
    }
  });
});

describe("AgentCheckoutStateService — Terminal State Detection", () => {
  it("isTerminal returns true for tracking", () => {
    const svc = createService();
    assert.equal(svc.isTerminal("tracking"), true);
  });

  it("isTerminal returns false for all non-terminal states", () => {
    const svc = createService();
    const nonTerminal = ["idle", "discovered", "negotiated", "quoted", "confirmed", "payment_pending", "paid"];
    nonTerminal.forEach((state) => {
      assert.equal(svc.isTerminal(state), false, `${state} should not be terminal`);
    });
  });

  it("isTerminal returns false for unknown state", () => {
    const svc = createService();
    assert.equal(svc.isTerminal("unknown"), false);
  });
});
