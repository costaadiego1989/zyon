import { describe, expect, it } from "vitest";
import {
  ALL_TRIGGERS,
  TRIGGER_LABELS,
  TRIGGER_HELP,
  MODE_OPTIONS,
  ALLOWED_SUPPRESSED_STEPS,
  BRAZILIAN_UF_CODES,
} from "./constants.js";

describe("constants", () => {
  it("ALL_TRIGGERS contains exactly 5 known trigger names", () => {
    expect(ALL_TRIGGERS).toHaveLength(5);
    expect(ALL_TRIGGERS).toContain("shipping_objection_detected");
    expect(ALL_TRIGGERS).toContain("coupon_field_clicked");
    expect(ALL_TRIGGERS).toContain("payment_failed");
    expect(ALL_TRIGGERS).toContain("exit_intent_detected");
    expect(ALL_TRIGGERS).toContain("idle_30_seconds");
  });

  it("TRIGGER_LABELS has an entry for every trigger in ALL_TRIGGERS", () => {
    for (const trigger of ALL_TRIGGERS) {
      expect(TRIGGER_LABELS[trigger]).toBeDefined();
      expect(typeof TRIGGER_LABELS[trigger]).toBe("string");
      expect(TRIGGER_LABELS[trigger].length).toBeGreaterThan(0);
    }
  });

  it("TRIGGER_HELP has an entry for every trigger in ALL_TRIGGERS", () => {
    for (const trigger of ALL_TRIGGERS) {
      expect(TRIGGER_HELP[trigger]).toBeDefined();
      expect(typeof TRIGGER_HELP[trigger]).toBe("string");
      expect(TRIGGER_HELP[trigger].length).toBeGreaterThan(0);
    }
  });

  it("MODE_OPTIONS has exactly 3 entries with correct value fields", () => {
    expect(MODE_OPTIONS).toHaveLength(3);
    const values = MODE_OPTIONS.map((o) => o.value);
    expect(values).toContain("silent_until_trigger");
    expect(values).toContain("proactive");
    expect(values).toContain("manual_only");
  });

  it("ALLOWED_SUPPRESSED_STEPS is a non-empty array of strings", () => {
    expect(ALLOWED_SUPPRESSED_STEPS.length).toBeGreaterThan(0);
    for (const step of ALLOWED_SUPPRESSED_STEPS) {
      expect(typeof step).toBe("string");
    }
    expect(ALLOWED_SUPPRESSED_STEPS).toContain("payment");
    expect(ALLOWED_SUPPRESSED_STEPS).toContain("review");
    expect(ALLOWED_SUPPRESSED_STEPS).toContain("shipping");
    expect(ALLOWED_SUPPRESSED_STEPS).toContain("identification");
  });

  it("BRAZILIAN_UF_CODES has exactly 27 entries", () => {
    expect(BRAZILIAN_UF_CODES).toHaveLength(27);
    expect(BRAZILIAN_UF_CODES).toContain("SP");
    expect(BRAZILIAN_UF_CODES).toContain("RJ");
    expect(BRAZILIAN_UF_CODES).toContain("AM");
    expect(BRAZILIAN_UF_CODES).toContain("DF");
  });
});
