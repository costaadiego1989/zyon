import test from "node:test";
import assert from "node:assert/strict";
import { GetSupportSettingsUseCase } from "../../application/get-support-settings.use-case.js";
import { ListSupportTicketsUseCase } from "../../application/list-support-tickets.use-case.js";
import { SendSupportMessageUseCase } from "../../application/send-support-message.use-case.js";
import { UpdateSupportSettingsUseCase } from "../../application/update-support-settings.use-case.js";
import { UpdateSupportTicketStatusUseCase } from "../../application/update-support-ticket-status.use-case.js";
import { CreateSupportTicketUseCase } from "../../application/create-support-ticket.use-case.js";
import { SupportTicketEventPublisher } from "../../application/support-ticket-event.publisher.js";
import { SupportHandoffService } from "../../application/support-handoff.service.js";
import { InMemorySupportSettingsRepository } from "../../infrastructure/in-memory-support-settings.repository.js";
import { InMemorySupportTicketRepository } from "../../infrastructure/in-memory-support-ticket.repository.js";
import type { ChatCompletionPort } from "../../domain/ports/chat-completion.port.js";
import { SupportController } from "./support.controller.js";
import { RealtimeCapabilityService } from "../../../../shared/auth/realtime-capability.js";

class NullChatAdapter implements ChatCompletionPort {
  async complete(): Promise<string | null> { return null; }
}

test("SupportController opens handoff ticket and lets merchant update status", async (t) => {
  const previousApiKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  t.after(() => {
    if (previousApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousApiKey;
  });

  const settings = new InMemorySupportSettingsRepository();
  const tickets = new InMemorySupportTicketRepository();
  const publisher = new SupportTicketEventPublisher();
  const handoff = new SupportHandoffService(tickets, publisher);
  const chatAdapter = new NullChatAdapter();
  const capabilities = new RealtimeCapabilityService("test-realtime-secret-at-least-32-characters");
  const controller = new SupportController(
    new SendSupportMessageUseCase(chatAdapter, handoff),
    new GetSupportSettingsUseCase(settings),
    new UpdateSupportSettingsUseCase(settings),
    new ListSupportTicketsUseCase(tickets),
    new UpdateSupportTicketStatusUseCase(tickets),
    new CreateSupportTicketUseCase(tickets, publisher),
    capabilities,
  );

  const chat = await controller.chat(
    { embedClaims: { merchantId: "mrc_1" } } as never,
    {
      session_id: "chk_1",
      message: "Meu pedido precisa de atendimento humano"
    }
  );
  const request = {
    tenantPrincipal: {
      kind: "human" as const,
      userId: "usr_1",
      tenantId: "mrc_1",
      email: "ops@example.com",
      role: "owner" as const
    }
  };
  const listed = await controller.getTickets(request);
  const updated = await controller.updateTicket(request, listed.data[0]!.id, { status: "resolved" });
  const created = await controller.createTicket_(request, {
    message: "Contato iniciado pelo painel",
  });

  assert.equal(chat.handoff?.ticketId, listed.data[0]?.id);
  assert.equal(listed.data.length, 1);
  assert.equal(listed.data[0]?.sessionId, "chk_1");
  assert.equal(updated.status, "resolved");
  assert.ok(updated.resolvedAt);
  assert.equal(created.source, "dashboard");
  assert.equal(created.merchantId, "mrc_1");

  assert.ok(chat.handoff && "accessToken" in chat.handoff);
  const firstAccess = capabilities.verify(chat.handoff.accessToken, "support-ticket");
  assert.equal(firstAccess.resourceId, listed.data[0]?.id);
  assert.equal(firstAccess.merchantId, "mrc_1");

  // Reusing another caller's public session ID creates a distinct ticket and never grants access to theirs.
  const second = await controller.chat(
    { embedClaims: { merchantId: "mrc_1" }, headers: { origin: "https://store.example" } } as never,
    { session_id: "chk_1", message: "Preciso de atendimento humano" },
  );
  assert.ok(second.handoff && "accessToken" in second.handoff);
  const secondAccess = capabilities.verify(second.handoff.accessToken, "support-ticket", "https://store.example");
  assert.notEqual(secondAccess.resourceId, firstAccess.resourceId);
  const secondToken = second.handoff.accessToken;
  assert.throws(() => capabilities.verify(secondToken, "support-ticket", "https://other.example"));
});
