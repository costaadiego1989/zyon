import test from "node:test";
import assert from "node:assert/strict";
import { GetSupportSettingsUseCase } from "../../application/get-support-settings.use-case.js";
import { ListSupportTicketsUseCase } from "../../application/list-support-tickets.use-case.js";
import { SendSupportMessageUseCase } from "../../application/send-support-message.use-case.js";
import { UpdateSupportSettingsUseCase } from "../../application/update-support-settings.use-case.js";
import { UpdateSupportTicketStatusUseCase } from "../../application/update-support-ticket-status.use-case.js";
import { InMemorySupportSettingsRepository } from "../../infrastructure/in-memory-support-settings.repository.js";
import { InMemorySupportTicketRepository } from "../../infrastructure/in-memory-support-ticket.repository.js";
import { SupportController } from "./support.controller.js";

test("SupportController opens handoff ticket and lets merchant update status", async (t) => {
  const previousApiKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  t.after(() => {
    if (previousApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousApiKey;
  });

  const settings = new InMemorySupportSettingsRepository();
  const tickets = new InMemorySupportTicketRepository();
  const controller = new SupportController(
    new SendSupportMessageUseCase(tickets),
    new GetSupportSettingsUseCase(settings),
    new UpdateSupportSettingsUseCase(settings),
    new ListSupportTicketsUseCase(tickets),
    new UpdateSupportTicketStatusUseCase(tickets)
  );

  const chat = await controller.chat({
    merchant_id: "mrc_1",
    session_id: "chk_1",
    message: "Meu pedido precisa de atendimento humano"
  });
  const request = {
    user: {
      userId: "usr_1",
      merchantId: "mrc_1",
      email: "ops@example.com",
      role: "owner" as const
    }
  };
  const listed = await controller.getTickets(request);
  const updated = await controller.updateTicket(request, listed[0]!.id, { status: "resolved" });

  assert.equal(chat.handoff?.ticketId, listed[0]?.id);
  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.sessionId, "chk_1");
  assert.equal(updated.status, "resolved");
  assert.ok(updated.resolvedAt);
});
