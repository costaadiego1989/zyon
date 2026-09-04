import test from "node:test";
import assert from "node:assert/strict";
import { InMemorySupportTicketRepository } from "../infrastructure/in-memory-support-ticket.repository.js";
import { SendSupportMessageUseCase } from "./send-support-message.use-case.js";
import { SupportHandoffService } from "./support-handoff.service.js";
import { SupportTicketEventPublisher } from "./support-ticket-event.publisher.js";
import type { ChatCompletionPort } from "../domain/ports/chat-completion.port.js";

/** Test double: always returns null (simulates unconfigured OpenAI) */
class NullChatAdapter implements ChatCompletionPort {
  async complete(): Promise<string | null> {
    return null;
  }
}

function buildUseCase(tickets: InMemorySupportTicketRepository) {
  const publisher = new SupportTicketEventPublisher();
  const handoff = new SupportHandoffService(tickets, publisher);
  const chat = new NullChatAdapter();
  return new SendSupportMessageUseCase(chat, handoff);
}

test("SendSupportMessageUseCase answers matching FAQ without creating ticket", async () => {
  const tickets = new InMemorySupportTicketRepository();
  const useCase = buildUseCase(tickets);

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

test("SendSupportMessageUseCase creates handoff ticket when OpenAI unconfigured", async () => {
  const tickets = new InMemorySupportTicketRepository();
  const useCase = buildUseCase(tickets);

  const output = await useCase.execute({
    merchant_id: "mrc_1",
    session_id: "chk_1",
    message: "Meu pedido veio com uma situacao estranha"
  });
  const stored = await tickets.list("mrc_1");

  assert.equal(output.handoff?.status, "open");
  assert.match(output.reply, /Referência:/);
  assert.equal(stored.length, 1);
  assert.equal(stored[0]?.id, output.handoff?.ticketId);
  assert.equal(stored[0]?.sessionId, "chk_1");
  assert.equal(stored[0]?.buyerMessage, "Meu pedido veio com uma situacao estranha");
});
