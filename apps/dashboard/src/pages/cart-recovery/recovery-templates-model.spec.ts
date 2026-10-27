import { describe, expect, it } from "vitest";
import type { RecoveryTemplates } from "../../api/endpoints/cart-recovery-templates.js";
import { EMPTY_TEMPLATES_EDITOR, hasTemplateChanges, receiveTemplates, templateDraft, validateTemplates, TEMPLATE_STATUS_LABELS } from "./recovery-templates-model.js";

function saved(): RecoveryTemplates {
  return { email: { subject: "Seu carrinho", body: "Olá {{buyerName}}, retorne: {{link}}" },
    whatsapp: { body: "Seu carrinho está aqui: {{link}}", revision: 1, status: "submitted", rejectionReason: null },
    whatsappConnected: true, effectiveChannel: "email" };
}

describe("recovery templates editor", () => {
  it("loads persisted content without inventing an approved state", () => {
    const state = receiveTemplates(EMPTY_TEMPLATES_EDITOR, saved());
    expect(state.saved?.effectiveChannel).toBe("email");
    expect(state.saved?.whatsapp.status).toBe("submitted");
    expect(hasTemplateChanges(state)).toBe(false);
  });

  it("polls approval without overwriting unsaved changes or changing their base revision", () => {
    const initial = receiveTemplates(EMPTY_TEMPLATES_EDITOR, saved());
    const draft = { ...initial.draft!, email: { ...initial.draft!.email, subject: "Assunto que estou editando" } };
    const next = receiveTemplates({ ...initial, draft }, { ...saved(), effectiveChannel: "whatsapp_template",
      whatsapp: { ...saved().whatsapp, status: "approved" } });
    expect(next.draft).toBe(draft);
    expect(next.saved?.whatsapp.status).toBe("approved");
    expect(next.conflict).toBe(false);
    expect(hasTemplateChanges(next)).toBe(true);
  });

  it("detects another session's revision and preserves the draft", () => {
    const initial = receiveTemplates(EMPTY_TEMPLATES_EDITOR, saved());
    const draft = { ...initial.draft!, whatsapp: { body: "Meu novo texto {{link}}", revision: 1 } };
    const remote = { ...saved(), whatsapp: { ...saved().whatsapp, revision: 2, body: "Texto de outra sessão {{link}}" } };
    const next = receiveTemplates({ ...initial, draft }, remote);
    expect(next.conflict).toBe(true);
    expect(next.draft?.whatsapp).toEqual(draft.whatsapp);
    expect(next.saved?.whatsapp.body).toBe(remote.whatsapp.body);
    expect(receiveTemplates(next, remote).conflict).toBe(true);
  });

  it("detects remotely changed email even if a legacy server reused a revision", () => {
    const initial = receiveTemplates(EMPTY_TEMPLATES_EDITOR, saved());
    const draft = { ...initial.draft!, whatsapp: { body: "Texto local {{link}}", revision: 1 } };
    expect(receiveTemplates({ ...initial, draft }, { ...saved(), email: { ...saved().email, subject: "Alterado remotamente" } }).conflict).toBe(true);
  });

  it("refreshes a pristine form when another session changes content", () => {
    const remote = { ...saved(), whatsapp: { ...saved().whatsapp, revision: 2, body: "Outro texto {{link}}" } };
    const next = receiveTemplates(receiveTemplates(EMPTY_TEMPLATES_EDITOR, saved()), remote);
    expect(next.draft?.whatsapp.revision).toBe(2);
    expect(next.draft?.whatsapp.body).toBe(remote.whatsapp.body);
    expect(next.conflict).toBe(false);
  });

  it("reconciles a save whose response was lost when polling confirms the exact content", () => {
    const initial = receiveTemplates(EMPTY_TEMPLATES_EDITOR, saved());
    const draft = { ...initial.draft!, email: { ...initial.draft!.email, subject: "Assunto salvo" } };
    const remote = { ...saved(), email: draft.email, whatsapp: { ...saved().whatsapp, revision: 2 } };
    const next = receiveTemplates({ ...initial, draft }, remote);
    expect(next.conflict).toBe(false);
    expect(next.draft?.whatsapp.revision).toBe(2);
    expect(hasTemplateChanges(next)).toBe(false);
  });

  it("does not share mutable email fields with the saved version", () => {
    const remote = saved();
    const draft = templateDraft(remote);
    draft.email.subject = "Local";
    expect(remote.email.subject).toBe("Seu carrinho");
  });

  it.each(Object.keys(TEMPLATE_STATUS_LABELS))("has a readable status for %s", (status) => {
    expect(TEMPLATE_STATUS_LABELS[status as keyof typeof TEMPLATE_STATUS_LABELS]).not.toContain("_");
  });
});

describe("recovery templates validation", () => {
  it("accepts the two supported named variables", () => expect(validateTemplates(templateDraft(saved()))).toBeNull());
  it.each(["{{coupon}}", "{{1}}", "{{ buyerName }}", "{{link}", "{link}"])("rejects unsupported or malformed variable %s", (variable) => {
    const draft = templateDraft(saved());
    draft.whatsapp.body += variable;
    expect(validateTemplates(draft)).toContain("somente");
  });
  it.each(["email", "whatsapp"] as const)("requires a return link in %s", (channel) => {
    const draft = templateDraft(saved());
    draft[channel].body = "Olá {{buyerName}}";
    expect(validateTemplates(draft)).toContain("Inclua {{link}}");
  });
  it.each(["\n", "\r", "a".repeat(151)])("rejects header injection or an oversized subject", (subject) => {
    const draft = templateDraft(saved());
    draft.email.subject = `Assunto${subject}`;
    expect(validateTemplates(draft)).toContain("150");
  });
  it.each([["email", 10_001], ["whatsapp", 1_025]] as const)("rejects oversized %s body", (channel, size) => {
    const draft = templateDraft(saved());
    draft[channel].body = "{{link}}" + "a".repeat(size);
    expect(validateTemplates(draft)).toContain("caracteres");
  });
  it("rejects whitespace-only content", () => {
    const draft = templateDraft(saved());
    draft.email.subject = " ";
    expect(validateTemplates(draft)).toContain("Preencha");
  });
});
