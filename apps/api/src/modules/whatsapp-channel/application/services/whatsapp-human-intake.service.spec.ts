import assert from "node:assert/strict";
import test from "node:test";
import { isHumanSupportRequest, WhatsAppTurnContext } from "../../domain/services/whatsapp-turn-context.js";

test("T49", async t => {
  await t.test("explicit natural requests and the menu label request a person", () => {
    for (const text of ["Falar com atendente", "Quero falar com um atendente", "Gostaria de falar com uma pessoa", "Preciso falar com o suporte humano", "/atendente", "Atendimento humano"])
      assert.equal(isHumanSupportRequest(text), true, text);
  });
  await t.test("ordinary help, product questions, negation and quoted instructions stay conversational", () => {
    for (const text of ["Preciso de ajuda para comprar", "Quais produtos tem?", "Não quero falar com atendente", "O produto diz falar com atendente", "Quanto custa este serviço?", "/cancelar"])
      assert.equal(isHumanSupportRequest(text), false, text);
  });
  await t.test("server turn context is asynchronous, scoped and restored after failures", async () => {
    const context = new WhatsAppTurnContext();
    const turn = { scope: { merchantId: "synthetic-a", configId: "synthetic-config", whatsappSessionId: "synthetic-session" },
      inboxId: "synthetic-inbox", leaseToken: "synthetic-lease", conversationId: "synthetic-conversation", message: "Falar com atendente", origin: "text" as const };
    assert.equal(context.current(), undefined);
    await assert.rejects(context.run(turn, async () => {
      await Promise.resolve();assert.deepEqual(context.current(), turn);
      throw new Error("synthetic_failure");
    }), /synthetic_failure/);
    assert.equal(context.current(), undefined);
  });
  await t.test("a synthetic voice interpretation remains internal to its current turn", async () => {
    const context = new WhatsAppTurnContext();
    const turn = { scope: { merchantId: "synthetic-a", configId: "synthetic-config", whatsappSessionId: "synthetic-session" },
      inboxId: "synthetic-inbox", leaseToken: "synthetic-lease", conversationId: "synthetic-conversation", message: "Enviei um áudio", origin: "text" as const };
    await context.run(turn, async () => {
      await context.withMessage("Quero falar com atendente", "voice", async () => {
        assert.equal(context.current()?.message, "Quero falar com atendente");assert.equal(context.current()?.origin, "voice");
      });
      assert.equal(context.current()?.message, turn.message);assert.equal(context.current()?.origin, "text");
    });
    assert.equal(context.current(), undefined);
  });
});
