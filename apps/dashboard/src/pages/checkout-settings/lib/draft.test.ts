import { describe, expect, it } from "vitest";
import type { CheckoutSettings } from "@zyon/shared-types";
import { settingsToDraft, draftToPatch, draftsEqual, DEFAULT_DRAFT } from "./draft.js";
import { validate } from "./validation.js";

const FULL_SETTINGS: CheckoutSettings = {
  merchantId: "mrc_demo",
  mode: "silent_until_trigger",
  widgetBehavior: {
    openWidgetOnTrigger: true,
    startMinimized: false,
    position: "bottom_left",
    initialDelaySeconds: 5,
  },
  interventionPolicy: {
    minimumAbandonmentScore: 0.7,
    cooldownSeconds: 60,
    maxInterventionsPerSession: 2,
  },
  triggerRules: [
    { trigger: "shipping_objection_detected", enabled: true, priority: 80 },
    { trigger: "coupon_field_clicked", enabled: false, priority: 40 },
    { trigger: "payment_failed", enabled: true, priority: 95 },
    { trigger: "exit_intent_detected", enabled: true, priority: 55 },
    { trigger: "idle_30_seconds", enabled: false, priority: 20 },
  ],
  suppressionRules: {
    suppressAfterOfferAccepted: true,
    respectBuyerOptOut: false,
    minimumCartValue: 50,
    suppressedSteps: ["payment", "review"],
    blockedRegions: ["AM", "RR"],
  },
  handoff: {
    enabled: true,
    message: "Transferindo para atendente.",
    channels: ["email", "whatsapp"],
  },
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-06-01T00:00:00Z",
};

describe("settingsToDraft", () => {
  it("maps a full CheckoutSettings object to correct Draft", () => {
    const draft = settingsToDraft(FULL_SETTINGS);

    expect(draft.mode).toBe("silent_until_trigger");
    expect(draft.openWidgetOnTrigger).toBe(true);
    expect(draft.startMinimized).toBe(false);
    expect(draft.position).toBe("bottom_left");
    expect(draft.initialDelaySeconds).toBe(5);
    expect(draft.minimumAbandonmentScore).toBe(0.7);
    expect(draft.cooldownSeconds).toBe(60);
    expect(draft.maxInterventionsPerSession).toBe(2);
    expect(draft.suppressAfterOfferAccepted).toBe(true);
    expect(draft.respectBuyerOptOut).toBe(false);
    expect(draft.minimumCartValue).toBe(50);
    expect(draft.suppressedSteps).toEqual(["payment", "review"]);
    expect(draft.blockedRegions).toEqual(["AM", "RR"]);
    expect(draft.handoffEnabled).toBe(true);
    expect(draft.handoffMessage).toBe("Transferindo para atendente.");
    expect(draft.handoffChannels).toEqual(["email", "whatsapp"]);
  });

  it("handles missing optional fields (minimumCartValue undefined → 0)", () => {
    const settings: CheckoutSettings = {
      ...FULL_SETTINGS,
      suppressionRules: {
        ...FULL_SETTINGS.suppressionRules,
        minimumCartValue: undefined,
      },
    };
    const draft = settingsToDraft(settings);
    expect(draft.minimumCartValue).toBe(0);
  });

  it("maps trigger rules to Draft triggers map (enabled + priority)", () => {
    const draft = settingsToDraft(FULL_SETTINGS);

    expect(draft.triggers.shipping_objection_detected).toEqual({ enabled: true, priority: 80 });
    expect(draft.triggers.coupon_field_clicked).toEqual({ enabled: false, priority: 40 });
    expect(draft.triggers.payment_failed).toEqual({ enabled: true, priority: 95 });
    expect(draft.triggers.exit_intent_detected).toEqual({ enabled: true, priority: 55 });
    expect(draft.triggers.idle_30_seconds).toEqual({ enabled: false, priority: 20 });
  });

  it("handles triggers missing from API response (defaults to disabled, priority 50)", () => {
    const settings: CheckoutSettings = {
      ...FULL_SETTINGS,
      triggerRules: [
        { trigger: "shipping_objection_detected", enabled: true, priority: 80 },
      ],
    };
    const draft = settingsToDraft(settings);

    expect(draft.triggers.shipping_objection_detected).toEqual({ enabled: true, priority: 80 });
    expect(draft.triggers.coupon_field_clicked).toEqual({ enabled: false, priority: 50 });
    expect(draft.triggers.payment_failed).toEqual({ enabled: false, priority: 50 });
    expect(draft.triggers.exit_intent_detected).toEqual({ enabled: false, priority: 50 });
    expect(draft.triggers.idle_30_seconds).toEqual({ enabled: false, priority: 50 });
  });
});

describe("draftToPatch", () => {
  it("produces a valid CheckoutSettingsPatch from a Draft", () => {
    const draft = settingsToDraft(FULL_SETTINGS);
    const patch = draftToPatch(draft);

    expect(patch.mode).toBe("silent_until_trigger");
    expect(patch.widgetBehavior!.openWidgetOnTrigger).toBe(true);
    expect(patch.widgetBehavior!.startMinimized).toBe(false);
    expect(patch.widgetBehavior!.position).toBe("bottom_left");
    expect(patch.widgetBehavior!.initialDelaySeconds).toBe(5);
    expect(patch.interventionPolicy!.minimumAbandonmentScore).toBe(0.7);
    expect(patch.interventionPolicy!.cooldownSeconds).toBe(60);
    expect(patch.interventionPolicy!.maxInterventionsPerSession).toBe(2);
    expect(patch.triggerRules).toHaveLength(5);
    expect(patch.handoff!.enabled).toBe(true);
    expect(patch.handoff!.message).toBe("Transferindo para atendente.");
    expect(patch.handoff!.channels).toEqual(["email", "whatsapp"]);
  });

  it("converts suppressedSteps array to patch array", () => {
    const draft = settingsToDraft(FULL_SETTINGS);
    const patch = draftToPatch(draft);
    expect(patch.suppressionRules!.suppressedSteps).toEqual(["payment", "review"]);
  });

  it("converts blockedRegions array to patch array", () => {
    const draft = settingsToDraft(FULL_SETTINGS);
    const patch = draftToPatch(draft);
    expect(patch.suppressionRules!.blockedRegions).toEqual(["AM", "RR"]);
  });

  it("omits minimumCartValue when 0", () => {
    const draft = { ...settingsToDraft(FULL_SETTINGS), minimumCartValue: 0 };
    const patch = draftToPatch(draft);
    expect(patch.suppressionRules!.minimumCartValue).toBeUndefined();
  });
});

describe("draftsEqual", () => {
  it("returns true for identical drafts", () => {
    const a = settingsToDraft(FULL_SETTINGS);
    const b = settingsToDraft(FULL_SETTINGS);
    expect(draftsEqual(a, b)).toBe(true);
  });

  it("returns false when one field changes", () => {
    const a = settingsToDraft(FULL_SETTINGS);
    const b = { ...a, cooldownSeconds: 120 };
    expect(draftsEqual(a, b)).toBe(false);
  });

  it("returns false when a trigger priority differs", () => {
    const a = settingsToDraft(FULL_SETTINGS);
    const b = {
      ...a,
      triggers: {
        ...a.triggers,
        payment_failed: { enabled: true, priority: 99 },
      },
    };
    expect(draftsEqual(a, b)).toBe(false);
  });
});

describe("DEFAULT_DRAFT", () => {
  it("passes validate() with no errors", () => {
    const errors = validate(DEFAULT_DRAFT);
    expect(Object.keys(errors)).toHaveLength(0);
  });
});
