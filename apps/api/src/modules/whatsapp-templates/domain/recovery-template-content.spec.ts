import test from "node:test";
import assert from "node:assert/strict";
import { BadRequestException } from "@nestjs/common";
import { RECOVERY_TEMPLATE_DEFAULTS, validateRecoveryTemplateEdit, prepareRecoveryWhatsApp, renderRecoveryText } from "./recovery-template-content.js";

function edit() {
  return { email: { ...RECOVERY_TEMPLATE_DEFAULTS.email }, whatsapp: { ...RECOVERY_TEMPLATE_DEFAULTS.whatsapp, revision: 1 } };
}

test("default content is valid without invented offers and requires the recovery link", () => {
  const result = validateRecoveryTemplateEdit(edit());
  assert.equal(result.whatsapp.revision, 1);
  assert.ok(result.email.body.includes("{{link}}"));
  assert.ok(result.whatsapp.body.includes("{{link}}"));
  assert.doesNotMatch(JSON.stringify(result), /coupon|discount|frete grátis|%/i);
});
for (const invalid of [null, undefined, false, "text", 1, [], {}, { email: null }, { whatsapp: null }]) {
  test(`rejects malformed payload ${JSON.stringify(invalid)}`, () => {
    assert.throws(() => validateRecoveryTemplateEdit(invalid), BadRequestException);
  });
}
for (const [field, max] of [["subject", 150], ["email", 10000], ["whatsapp", 1024]] as const) {
  test(`${field} rejects missing, blank, non-string and oversized content`, () => {
    for (const value of ["", " \n ", null, 42, "x".repeat(max + 1)]) {
      const input = edit();
      if (field === "subject") Object.assign(input.email, { subject: value });
      else if (field === "email") Object.assign(input.email, { body: value });
      else Object.assign(input.whatsapp, { body: value });
      assert.throws(() => validateRecoveryTemplateEdit(input), BadRequestException);
    }
  });
}
test("exact content limits are accepted", () => {
  const input = edit();
  input.email.subject = "x".repeat(150);
  input.email.body = "x".repeat(10000 - 8) + "{{link}}";
  input.whatsapp.body = "x".repeat(1024 - 8) + "{{link}}";
  assert.doesNotThrow(() => validateRecoveryTemplateEdit(input));
});
for (const value of ["Olá {{coupon}} {{link}}", "{{1}} {{link}}", "{{ buyerName }} {{link}}", "{{link}} {", "{{link}} }}"]) {
  test(`unknown or malformed variables rejected: ${value}`, () => {
    const input = edit(); input.whatsapp.body = value;
    assert.throws(() => validateRecoveryTemplateEdit(input), /unsupported_template_variable/);
  });
}
test("both channel bodies need a link even if the subject has one", () => {
  for (const channel of ["email", "whatsapp"] as const) {
    const input = edit(); input.email.subject = "{{link}}"; input[channel].body = "Olá {{buyerName}}";
    assert.throws(() => validateRecoveryTemplateEdit(input), /recovery_link_required/);
  }
});
test("email subject rejects header injection", () => {
  for (const subject of ["Lembrete\rBcc: other@example.test", "Lembrete\nReply-To: other@example.test"]) {
    const input = edit(); input.email.subject = subject;
    assert.throws(() => validateRecoveryTemplateEdit(input), /invalid_email_subject/);
  }
});
for (const revision of [undefined, null, 0, -1, 1.5, "1", NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
  test(`revision requires positive safe integer: ${String(revision)}`, () => {
    const input = edit(); Object.assign(input.whatsapp, { revision });
    assert.throws(() => validateRecoveryTemplateEdit(input), /invalid_template_revision/);
  });
}
test("Meta positions follow first appearance and repeated names reuse their slot", () => {
  assert.deepEqual(prepareRecoveryWhatsApp("Retome {{link}}, {{buyerName}}. Link: {{link}}"), {
    metaBody: "Retome {{1}}, {{2}}. Link: {{1}}",
    variableMap: { "1": "link", "2": "buyerName" },
    sampleVariables: { "1": "https://loja.example/carrinho", "2": "Ana" },
  });
});
test("rendered values are not recursively interpreted as template instructions", () => {
  assert.equal(renderRecoveryText("Olá {{buyerName}} {{link}}", { buyerName: "{{link}}", link: "https://shop.example/resume" }), "Olá {{link}} https://shop.example/resume");
  assert.equal(renderRecoveryText("Olá {{buyerName}}", {}), "Olá Cliente");
});
