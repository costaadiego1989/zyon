import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  initWidgetTriggerDetection,
  type WidgetTriggerName,
  type WidgetTriggerConfig,
} from "../lib/trigger-detection.js";
import {
  getInterventionCount,
  incrementIntervention,
  canFireTrigger,
  recordTriggerFired,
} from "../lib/intervention-tracker.js";

describe("trigger-detection", () => {
  beforeEach(() => {
    // Clear all event listeners
    vi.clearAllMocks();
  });

  it("initializes and returns a cleanup function", () => {
    const config: WidgetTriggerConfig = {
      enabledTriggers: ["idle_30_seconds"],
    };
    const onTrigger = vi.fn();
    const cleanup = initWidgetTriggerDetection(config, onTrigger);
    expect(typeof cleanup).toBe("function");
    cleanup();
  });

  it("handles exit_intent_detected on desktop", () => {
    const isTouchDevice =
      "ontouchstart" in window || (navigator.maxTouchPoints ?? 0) > 0;
    if (isTouchDevice) {
      // Skip on touch devices
      return;
    }

    const config: WidgetTriggerConfig = {
      enabledTriggers: ["exit_intent_detected"],
    };
    const onTrigger = vi.fn();
    const cleanup = initWidgetTriggerDetection(config, onTrigger);

    // Simulate mouseleave at top of viewport (clientY <= 0)
    const event = new MouseEvent("mouseleave", { clientY: -10 } as MouseEventInit);
    document.dispatchEvent(event);

    expect(onTrigger).toHaveBeenCalledWith("exit_intent_detected");
    cleanup();
  });

  it("does not fire exit_intent when clientY > 0", () => {
    const isTouchDevice =
      "ontouchstart" in window || (navigator.maxTouchPoints ?? 0) > 0;
    if (isTouchDevice) {
      // Skip on touch devices
      return;
    }

    const config: WidgetTriggerConfig = {
      enabledTriggers: ["exit_intent_detected"],
    };
    const onTrigger = vi.fn();
    const cleanup = initWidgetTriggerDetection(config, onTrigger);

    // Simulate mouseleave with clientY > 0
    const event = new MouseEvent("mouseleave", {
      clientY: 100,
    } as MouseEventInit);
    document.dispatchEvent(event);

    expect(onTrigger).not.toHaveBeenCalled();
    cleanup();
  });

  it("handles custom events from host site", () => {
    const config: WidgetTriggerConfig = {
      enabledTriggers: [
        "payment_failed",
        "coupon_field_clicked",
        "shipping_objection_detected",
      ],
    };
    const onTrigger = vi.fn();
    const cleanup = initWidgetTriggerDetection(config, onTrigger);

    // Dispatch custom event
    window.dispatchEvent(new CustomEvent("zyon:payment-failed"));
    expect(onTrigger).toHaveBeenCalledWith("payment_failed");

    window.dispatchEvent(new CustomEvent("zyon:coupon-opened"));
    expect(onTrigger).toHaveBeenCalledWith("coupon_field_clicked");

    window.dispatchEvent(new CustomEvent("zyon:shipping-objection"));
    expect(onTrigger).toHaveBeenCalledWith("shipping_objection_detected");

    cleanup();
  });

  it("fires each trigger only once per session", () => {
    const config: WidgetTriggerConfig = {
      enabledTriggers: ["payment_failed"],
    };
    const onTrigger = vi.fn();
    const cleanup = initWidgetTriggerDetection(config, onTrigger);

    // First dispatch
    window.dispatchEvent(new CustomEvent("zyon:payment-failed"));
    expect(onTrigger).toHaveBeenCalledTimes(1);

    // Second dispatch should not fire
    window.dispatchEvent(new CustomEvent("zyon:payment-failed"));
    expect(onTrigger).toHaveBeenCalledTimes(1);

    cleanup();
  });

  it("ignores unknown triggers", () => {
    const config: WidgetTriggerConfig = {
      enabledTriggers: [], // No triggers enabled
    };
    const onTrigger = vi.fn();
    const cleanup = initWidgetTriggerDetection(config, onTrigger);

    window.dispatchEvent(new CustomEvent("zyon:payment-failed"));
    expect(onTrigger).not.toHaveBeenCalled();

    cleanup();
  });
});

describe("intervention-tracker", () => {
  beforeEach(() => {
    // Clear sessionStorage
    sessionStorage.clear();
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  it("gets initial intervention count as 0", () => {
    const count = getInterventionCount("merchant_123");
    expect(count).toBe(0);
  });

  it("increments intervention count", () => {
    incrementIntervention("merchant_123");
    expect(getInterventionCount("merchant_123")).toBe(1);

    incrementIntervention("merchant_123");
    expect(getInterventionCount("merchant_123")).toBe(2);
  });

  it("tracks interventions per merchant", () => {
    incrementIntervention("merchant_123");
    incrementIntervention("merchant_123");

    incrementIntervention("merchant_456");
    incrementIntervention("merchant_456");
    incrementIntervention("merchant_456");

    expect(getInterventionCount("merchant_123")).toBe(2);
    expect(getInterventionCount("merchant_456")).toBe(3);
  });

  it("checks trigger cooldown correctly", () => {
    const merchantId = "merchant_123";
    const trigger = "exit_intent_detected";
    const cooldownMs = 1000;

    // Initially, can fire
    expect(canFireTrigger(merchantId, trigger, cooldownMs)).toBe(true);

    // Record firing
    recordTriggerFired(merchantId, trigger);

    // Cannot fire immediately (cooldown active)
    expect(canFireTrigger(merchantId, trigger, cooldownMs)).toBe(false);
  });

  it("respects cooldown per trigger", () => {
    const merchantId = "merchant_123";
    const cooldownMs = 1000;

    recordTriggerFired(merchantId, "payment_failed");
    recordTriggerFired(merchantId, "idle_30_seconds");

    // payment_failed is on cooldown
    expect(canFireTrigger(merchantId, "payment_failed", cooldownMs)).toBe(false);

    // idle_30_seconds is on cooldown
    expect(canFireTrigger(merchantId, "idle_30_seconds", cooldownMs)).toBe(false);

    // different trigger is not on cooldown
    expect(canFireTrigger(merchantId, "exit_intent_detected", cooldownMs)).toBe(true);
  });

  it("gracefully handles sessionStorage unavailability", () => {
    const originalGetItem = sessionStorage.getItem;
    const originalSetItem = sessionStorage.setItem;

    try {
      // Mock sessionStorage to throw
      sessionStorage.getItem = () => {
        throw new Error("sessionStorage blocked");
      };
      sessionStorage.setItem = () => {
        throw new Error("sessionStorage blocked");
      };

      // Should not throw, but return defaults
      expect(getInterventionCount("merchant_123")).toBe(0);
      expect(() => incrementIntervention("merchant_123")).not.toThrow();
      expect(canFireTrigger("merchant_123", "payment_failed", 1000)).toBe(true);
      expect(() =>
        recordTriggerFired("merchant_123", "payment_failed")
      ).not.toThrow();
    } finally {
      sessionStorage.getItem = originalGetItem;
      sessionStorage.setItem = originalSetItem;
    }
  });
});
