import { describe, expect, it } from "vitest";
import { validate } from "./validation.js";
import { DEFAULT_DRAFT, type Draft } from "./draft.js";

function makeDraft(overrides: Partial<Draft> = {}): Draft {
  return { ...DEFAULT_DRAFT, ...overrides };
}

describe("validate", () => {
  it("valid draft → empty errors object", () => {
    const errors = validate(DEFAULT_DRAFT);
    expect(Object.keys(errors)).toHaveLength(0);
  });

  describe("cooldownSeconds", () => {
    it("cooldownSeconds = 29 → error", () => {
      const errors = validate(makeDraft({ cooldownSeconds: 29 }));
      expect(errors.cooldownSeconds).toBe("Mínimo: 30 segundos.");
    });

    it("cooldownSeconds = 30 → no error", () => {
      const errors = validate(makeDraft({ cooldownSeconds: 30 }));
      expect(errors.cooldownSeconds).toBeUndefined();
    });
  });

  describe("maxInterventionsPerSession", () => {
    it("maxInterventionsPerSession = 0 → error", () => {
      const errors = validate(makeDraft({ maxInterventionsPerSession: 0 }));
      expect(errors.maxInterventionsPerSession).toBe("Entre 1 e 10.");
    });

    it("maxInterventionsPerSession = 11 → error", () => {
      const errors = validate(makeDraft({ maxInterventionsPerSession: 11 }));
      expect(errors.maxInterventionsPerSession).toBe("Entre 1 e 10.");
    });

    it("maxInterventionsPerSession = 5 → no error", () => {
      const errors = validate(makeDraft({ maxInterventionsPerSession: 5 }));
      expect(errors.maxInterventionsPerSession).toBeUndefined();
    });
  });

  describe("minimumAbandonmentScore", () => {
    it("minimumAbandonmentScore = -0.1 → error", () => {
      const errors = validate(makeDraft({ minimumAbandonmentScore: -0.1 }));
      expect(errors.minimumAbandonmentScore).toBe("Entre 0.0 e 1.0.");
    });

    it("minimumAbandonmentScore = 1.1 → error", () => {
      const errors = validate(makeDraft({ minimumAbandonmentScore: 1.1 }));
      expect(errors.minimumAbandonmentScore).toBe("Entre 0.0 e 1.0.");
    });

    it("minimumAbandonmentScore = 0.7 → no error", () => {
      const errors = validate(makeDraft({ minimumAbandonmentScore: 0.7 }));
      expect(errors.minimumAbandonmentScore).toBeUndefined();
    });
  });

  describe("suppressedSteps", () => {
    it("valid values → no error", () => {
      const errors = validate(makeDraft({ suppressedSteps: ["payment", "review"] }));
      expect(errors.suppressedSteps).toBeUndefined();
    });

    it("invalid value → error", () => {
      const errors = validate(makeDraft({ suppressedSteps: ["invalid"] }));
      expect(errors.suppressedSteps).toContain("invalid");
    });
  });

  describe("blockedRegions", () => {
    it("valid UF codes → no error", () => {
      const errors = validate(makeDraft({ blockedRegions: ["SP", "RJ"] }));
      expect(errors.blockedRegions).toBeUndefined();
    });

    it("invalid UF code → error", () => {
      const errors = validate(makeDraft({ blockedRegions: ["XX"] }));
      expect(errors.blockedRegions).toContain("XX");
    });
  });

  describe("handoffMessage", () => {
    it("empty when handoffEnabled = true → error", () => {
      const errors = validate(makeDraft({ handoffEnabled: true, handoffMessage: "" }));
      expect(errors.handoffMessage).toBeDefined();
    });

    it("empty when handoffEnabled = false → no error", () => {
      const errors = validate(makeDraft({ handoffEnabled: false, handoffMessage: "" }));
      expect(errors.handoffMessage).toBeUndefined();
    });

    it("non-empty when handoffEnabled = true → no error", () => {
      const errors = validate(makeDraft({ handoffEnabled: true, handoffMessage: "Transferindo." }));
      expect(errors.handoffMessage).toBeUndefined();
    });
  });
});
