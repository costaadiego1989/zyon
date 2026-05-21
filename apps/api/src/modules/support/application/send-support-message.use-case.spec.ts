import test from "node:test";
import assert from "node:assert/strict";
import { InMemorySupportTicketRepository } from "../infrastructure/in-memory-support-ticket.repository.js";
import { SendSupportMessageUseCase } from "./send-support-message.use-case.js";

test("SendSupportMessageUseCase answers matching FAQ without creating ticket", async (t) => {
  const previousApiKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  t.after(() => {
    if (previousApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousApiKey;
  });

  const tickets = new InMemorySupportTicketRepository();
  const useCase = new SendSupportMessageUseCase(tickets);

  const output = await useCase.execute(
    {
      merchant_id: "mrc_1",
      session_id: "chk_1",
      message: "Como rastrear meu pedido?"
    },
    {
      faqItems: [
        {
          id: "faq_1",
          question: "Como rastrear meu pedido?",
          answer: "Use o codigo enviado por e-mail quando a transportadora liberar o rastreio."
        }
      ]
    }
  );

  assert.equal(output.reply, "Use o codigo enviado por e-mail quando a transportadora liberar o rastreio.");
  assert.equal(output.handoff, undefined);
  assert.deepEqual(await tickets.list("mrc_1"), []);
});

test("SendSupportMessageUseCase creates handoff ticket when support is unresolved", async (t) => {
  const previousApiKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  t.after(() => {
    if (previousApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousApiKey;
  });

  const tickets = new InMemorySupportTicketRepository();
  const useCase = new SendSupportMessageUseCase(tickets);

  const output = await useCase.execute({
    merchant_id: "mrc_1",
    session_id: "chk_1",
    message: "Meu pedido veio com uma situacao estranha"
  });
  const stored = await tickets.list("mrc_1");

  assert.equal(output.safe, true);
  assert.equal(output.handoff?.status, "open");
  assert.match(output.reply, /Protocolo: sup_/);
  assert.equal(stored.length, 1);
  assert.equal(stored[0]?.id, output.handoff?.ticketId);
  assert.equal(stored[0]?.sessionId, "chk_1");
  assert.equal(stored[0]?.buyerMessage, "Meu pedido veio com uma situacao estranha");
});
