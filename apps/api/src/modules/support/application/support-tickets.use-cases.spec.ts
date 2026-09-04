import test from "node:test";
import assert from "node:assert/strict";
import { SupportTicketEntity } from "../domain/entities/support-ticket.entity.js";
import { InMemorySupportTicketRepository } from "../infrastructure/in-memory-support-ticket.repository.js";
import { ListSupportTicketsUseCase } from "./list-support-tickets.use-case.js";
import { UpdateSupportTicketStatusUseCase } from "./update-support-ticket-status.use-case.js";
import { CreateSupportTicketUseCase } from "./create-support-ticket.use-case.js";
import { SupportTicketEventPublisher } from "./support-ticket-event.publisher.js";
import {
  TenantWebhookPublisher,
  UpsertWebhookEndpointUseCase,
} from "../../integrations/application/integrations.use-cases.js";
import { InMemoryIntegrationsRepository } from "../../integrations/infrastructure/in-memory-integrations.repository.js";

test("support ticket list is tenant-scoped and can filter by status", async () => {
  const repository = new InMemorySupportTicketRepository();
  const first = await repository.save(
    SupportTicketEntity.create({
      merchantId: "mrc_1",
      sessionId: "chk_1",
      buyerMessage: "Preciso de ajuda"
    }).snapshot()
  );
  await repository.save(
    SupportTicketEntity.create({
      merchantId: "mrc_2",
      sessionId: "chk_2",
      buyerMessage: "Outro tenant"
    }).snapshot()
  );
  const update = new UpdateSupportTicketStatusUseCase(repository);
  await update.execute("mrc_1", first.id, "in_progress");

  const list = new ListSupportTicketsUseCase(repository);
  const all = await list.execute("mrc_1");
  const filtered = await list.execute("mrc_1", "in_progress");

  assert.equal(all.data.length, 1);
  assert.equal(all.data[0]?.merchantId, "mrc_1");
  assert.equal(filtered.data.length, 1);
  assert.equal(filtered.data[0]?.status, "in_progress");
});

test("support ticket status update rejects invalid status and missing tickets", async () => {
  const repository = new InMemorySupportTicketRepository();
  const update = new UpdateSupportTicketStatusUseCase(repository);

  await assert.rejects(() => update.execute("mrc_1", "sup_missing", "waiting"), /support_ticket_invalid_status/);
  await assert.rejects(() => update.execute("mrc_1", "sup_missing", "resolved"), /support_ticket_not_found/);
});

test("support ticket creation publishes metadata without the buyer message", async () => {
  const tickets = new InMemorySupportTicketRepository();
  const integrations = new InMemoryIntegrationsRepository();
  await new UpsertWebhookEndpointUseCase(integrations).execute({
    merchantId: "mrc_1",
    url: "https://example.com/webhooks",
    events: ["support.ticket.created"],
  });
  const publisher = new SupportTicketEventPublisher(new TenantWebhookPublisher(integrations));
  const create = new CreateSupportTicketUseCase(
    tickets,
    publisher,
  );

  const ticket = await create.execute({
    merchantId: "mrc_1",
    sessionId: "chk_1",
    message: "Mensagem privada do comprador",
  });
  const [delivery] = await integrations.listWebhookDeliveries("mrc_1");

  assert.equal(delivery?.eventType, "support.ticket.created");
  assert.equal(
    JSON.stringify(delivery?.envelope).includes("Mensagem privada"),
    false,
  );
  assert.equal(
    (delivery?.envelope.data.ticket as { id?: string } | undefined)?.id,
    ticket.id,
  );
});
