import { describe, expect, it } from "vitest";
import type { CheckoutSettings } from "@zyon/shared-types";
import { draftChangesToPatch, settingsToDraft } from "./checkout-settings/lib/draft.js";
import { agentIdentityChanges, agentConfigurationChanges, quickReplyChanges, stageConfigFromMap, type AgentConfigForm } from "./useAgentConfigPage.js";
import { storyEditorPatch, type StoryEditorState } from "./useStoriesPage.js";
import { changedFields } from "../lib/config-patch.js";

const settings: CheckoutSettings = {
  merchantId: "merchant-test", mode: "manual_only",
  widgetBehavior: { position: "bottom_right", startMinimized: false, openWidgetOnTrigger: false,
    initialDelaySeconds: 0, fabClickAction: "open_widget", showCartBadge: false, presentationMode: "fab" },
  interventionPolicy: { minimumAbandonmentScore: 0.7, cooldownSeconds: 120, maxInterventionsPerSession: 2 },
  triggerRules: [{ trigger: "payment_failed", enabled: false, priority: 17, message: "Mensagem da loja" },
    { trigger: "shipping_objection_detected", enabled: false, priority: 41, couponCode: "EXISTENTE" }],
  suppressionRules: { suppressAfterOfferAccepted: true, respectBuyerOptOut: true,
    minimumCartValue: 25, suppressedSteps: ["shipping"], blockedRegions: ["RJ"] },
  handoff: { enabled: false, message: "Atendimento da loja", channels: ["chat"] },
  advancedRules: [], createdAt: "2026-10-06T12:00:00Z", updatedAt: "2026-10-06T12:00:00Z",
};
describe("preserving merchant configuration when editing one field", () => {
  it("editing one assistance flag preserves other flags and the inactivity setting", () => {
    const saved = { ...settings, interventionPolicy: { ...settings.interventionPolicy, idleSeconds: 180,
      assistance: { pix: false, installments: true, unavailableProduct: true, humanHandoff: false } } };
    const draft = settingsToDraft(saved);
    expect(draft.assistance.pix).toBe(false);
    expect(draftChangesToPatch({ ...draft, assistance: { ...draft.assistance, installments: false } }, saved))
      .toEqual({ interventionPolicy: { assistance: { installments: false } } });
  });
  it("position-only save leaves incentives, absent triggers and commercial policy untouched", () => {
    const draft = { ...settingsToDraft(settings), position: "bottom_left" as const };
    expect(draftChangesToPatch(draft, settings)).toEqual({ widgetBehavior: { position: "bottom_left" } });
  });
  it("does not manufacture a write for displayed defaults", () => {
    expect(draftChangesToPatch(settingsToDraft(settings), settings)).toEqual({});
  });
  it("editing a visible trigger retains hidden rules, priority and absence of other triggers", () => {
    const draft = settingsToDraft(settings);
    draft.triggers.payment_failed = { ...draft.triggers.payment_failed, enabled: true };
    const patch = draftChangesToPatch(draft, settings);
    expect(patch.triggerRules).toHaveLength(2);
    expect(patch.triggerRules?.find(rule => rule.trigger === "shipping_objection_detected")).toEqual(settings.triggerRules[1]);
    expect(patch.triggerRules?.[0]).toMatchObject({ priority: 17, enabled: true, message: "Mensagem da loja" });
    expect(Object.keys(patch)).toEqual(["triggerRules"]);
  });
  it("adds an absent trigger only after its explicit activation", () => {
    const draft = settingsToDraft(settings);
    draft.triggers.exit_intent_detected = { enabled: true };
    expect(draftChangesToPatch(draft, settings).triggerRules?.map(rule => rule.trigger))
      .toEqual(["payment_failed", "shipping_objection_detected", "exit_intent_detected"]);
  });
  it("can explicitly remove the minimum cart requirement", () => {
    expect(draftChangesToPatch({ ...settingsToDraft(settings), minimumCartValue: 0 }, settings))
      .toEqual({ suppressionRules: { minimumCartValue: 0 } });
  });
  it("trust-badge edits never resend colors or a default color mode", () => {
    const initial = { accentColor: "#238636", mode: "dark", trustBadges: [] as string[] };
    expect(changedFields({ ...initial, trustBadges: ["Compra segura"] }, initial))
      .toEqual({ trustBadges: ["Compra segura"] });
  });
});
describe("agent writes reflect merchant intent", () => {
  const initial = { agentName: "Zion", persona: "", tone: "consultative", language: "pt-BR",
    greeting: "Olá", emptyCartGreeting: "", agentMode: "manual_only" } as AgentConfigForm;
  it("name-only edits do not introduce an empty-cart greeting", () => {
    expect(agentIdentityChanges({ ...initial, agentName: "Nome QA" }, initial)).toEqual({ agentName: "Nome QA" });
  });
  it("unmodified default replies do not become a merchant rules write", () => {
    expect(quickReplyChanges(stageConfigFromMap(undefined), stageConfigFromMap(undefined), undefined)).toBeUndefined();
  });
  it("one edited stage preserves custom stages and does not persist all presentation defaults", () => {
    const saved = { welcome: ["Original"], custom_stage: ["Resposta específica"] };
    const initialReplies = stageConfigFromMap(saved);
    const current = { ...initialReplies, stages: initialReplies.stages.map(stage =>
      stage.stage === "welcome" ? { ...stage, replies: ["Nova resposta"] } : stage) };
    expect(quickReplyChanges(current, initialReplies, saved))
      .toEqual({ welcome: ["Nova resposta"], custom_stage: ["Resposta específica"] });
  });
  it("unified name-only save retains the loaded revision, mode and exact saved replies", () => {
    const saved = { welcome: ["Da loja"], custom_stage: ["Personalizada"] };
    const replies = stageConfigFromMap(saved);
    expect(agentConfigurationChanges({ ...initial, agentName: "QA" }, initial, replies, replies, saved, "loaded-revision"))
      .toEqual({ revision: "loaded-revision", mode: "manual_only", quickReplies: saved, identity: { agentName: "QA" } });
  });
  it("unified mode-only save keeps an empty persisted replies map and does not write default identity", () => {
    const replies = stageConfigFromMap({});
    expect(agentConfigurationChanges({ ...initial, agentMode: "proactive" }, initial, replies, replies, {}, "revision"))
      .toEqual({ revision: "revision", mode: "proactive", quickReplies: {}, identity: {} });
  });
  it("unchanged unified draft does not prepare a persistence request", () => {
    const replies = stageConfigFromMap(undefined);
    expect(agentConfigurationChanges(initial, initial, replies, replies, undefined, "revision"))
      .toBeNull();
  });
});
describe("editing published stories", () => {
  const initial: StoryEditorState = { imageUrl: "https://example.com/story.png", imagePreview: "https://example.com/story.png",
    title: "Publicada", duration: 7, uploading: false, titleConfig: { font: "inter", fontSize: 16,
      color: "#ffffff", hasBg: true, bgColor: "#000000", bgOpacity: 0.6, positionX: 50, positionY: 80 } };
  it("duration-only edits preserve image, title and style", () => {
    expect(storyEditorPatch({ ...initial, duration: 10 }, initial)).toEqual({ duration: 10 });
  });
  it("clears a published title explicitly", () => {
    expect(storyEditorPatch({ ...initial, title: "" }, initial)).toEqual({ title: "" });
  });
  it("style edits send the full replacement style without rewriting the image/title", () => {
    const titleConfig = { ...initial.titleConfig, fontSize: 24 };
    expect(storyEditorPatch({ ...initial, titleConfig }, initial)).toEqual({ titleConfig });
  });
  it("adding a title to a story with no saved style persists the visible editor style", () => {
    const untitled = { ...initial, title: "" };
    expect(storyEditorPatch({ ...untitled, title: "Novo título" }, untitled, false))
      .toEqual({ title: "Novo título", titleConfig: initial.titleConfig });
    expect(storyEditorPatch({ ...untitled, duration: 10 }, untitled, false)).toEqual({ duration: 10 });
  });
});
