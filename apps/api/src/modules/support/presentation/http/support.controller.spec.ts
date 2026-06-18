import test from "node:test";
import assert from "node:assert/strict";
import { GetSupportSettingsUseCase } from "../../application/get-support-settings.use-case.js";
import { ListSupportTicketsUseCase } from "../../application/list-support-tickets.use-case.js";
import { SendSupportMessageUseCase } from "../../application/send-support-message.use-case.js";
import { UpdateSupportSettingsUseCase } from "../../application/update-support-settings.use-case.js";
import { UpdateSupportTicketStatusUseCase } from "../../application/update-support-ticket-status.use-case.js";
import { CreateSupportTicketUseCase } from "../../application/create-support-ticket.use-case.js";
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
    new UpdateSupportTicketStatusUseCase(tickets),
    new CreateSupportTicketUseCase(tickets),
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
});
