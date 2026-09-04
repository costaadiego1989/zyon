import test from "node:test";
import assert from "node:assert/strict";
import { SupportHandoffService } from "./support-handoff.service.js";
import { SupportTicketEventPublisher } from "./support-ticket-event.publisher.js";
import { InMemorySupportTicketRepository } from "../infrastructure/in-memory-support-ticket.repository.js";
import { InMemoryIntegrationsRepository } from "../../integrations/infrastructure/in-memory-integrations.repository.js";
import { TenantWebhookPublisher, UpsertWebhookEndpointUseCase } from "../../integrations/application/integrations.use-cases.js";
import type { SupportTicket } from "@zyon/shared-types";

function build(overrides?: {
  integrations?: InMemoryIntegrationsRepository;
}) {
  const tickets = new InMemorySupportTicketRepository();
  const integrations = overrides?.integrations ?? new InMemoryIntegrationsRepository();
  const publisher = new SupportTicketEventPublisher(new TenantWebhookPublisher(integrations));
  const handoff = new SupportHandoffService(tickets, publisher);
  return { tickets, integrations, publisher, handoff };
}

test("SupportHandoffService persists a new ticket via SupportTicketEntity.create", async () => {
  const { tickets, handoff } = build();

  const result = await handoff.createHandoff({
    merchantId: "mrc_1",
    sessionId: "chk_1",
    buyerMessage: "Preciso falar com a loja"
  });

  const stored = await tickets.list("mrc_1");
  assert.equal(stored.length, 1);
  assert.equal(stored[0]?.id, result.ticketId);
  assert.equal(stored[0]?.status, "open");
  assert.equal(stored[0]?.source, "widget");
  assert.equal(stored[0]?.buyerMessage, "Preciso falar com a loja");
  assert.equal(stored[0]?.sessionId, "chk_1");
});

test("SupportHandoffService formats reply with a 6-char uppercase reference", async () => {
  const { handoff } = build();

  const result = await handoff.createHandoff({
    merchantId: "mrc_1",
    buyerMessage: "Ajuda"
  });

  assert.match(result.reply, /Referência: [A-Z0-9]{6}/);
});

test("SupportHandoffService prefixes the fallback context when provided", async () => {
  const { handoff } = build();

  const result = await handoff.createHandoff(
    { merchantId: "mrc_1", buyerMessage: "Ajuda" },
    "Para dúvidas sobre frete, consulte o rastreamento."
  );

  assert.ok(result.reply.startsWith("Para dúvidas sobre frete"));
  assert.match(result.reply, /Referência: /);
});

test("SupportHandoffService publishes ticket.created without the buyer message body", async () => {
  const { integrations, handoff } = build();

  await new UpsertWebhookEndpointUseCase(integrations).execute({
    merchantId: "mrc_1",
    url: "https://example.com/webhooks",
    events: ["support.ticket.created"]
  });

  const result = await handoff.createHandoff({
    merchantId: "mrc_1",
    sessionId: "chk_1",
    buyerMessage: "Mensagem sigilosa do comprador"
  });

  const deliveries = await integrations.listWebhookDeliveries("mrc_1");
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0]?.eventType, "support.ticket.created");
  assert.equal(
    JSON.stringify(deliveries[0]?.envelope).includes("Mensagem sigilosa"),
    false
  );
  const ticket = deliveries[0]?.envelope.data.ticket as SupportTicket | undefined;
  assert.equal(ticket?.id, result.ticketId);
  assert.equal(ticket?.status, "open");
  assert.equal(ticket?.source, "widget");
});

test("SupportHandoffService isolates tickets per merchant", async () => {
  const { tickets, handoff } = build();

  const first = await handoff.createHandoff({ merchantId: "mrc_1", buyerMessage: "A" });
  const second = await handoff.createHandoff({ merchantId: "mrc_2", buyerMessage: "B" });

  assert.equal((await tickets.list("mrc_1")).length, 1);
  assert.equal((await tickets.list("mrc_2")).length, 1);
  assert.equal((await tickets.get("mrc_1", second.ticketId)), null);
  assert.equal((await tickets.get("mrc_2", first.ticketId)), null);
});

test("SupportHandoffService publishes ticket.created without persisting when no webhooks", async () => {
  // No integrations repo wired in → publisher is a no-op. Should still create the ticket.
  const tickets = new InMemorySupportTicketRepository();
  const publisher = new SupportTicketEventPublisher(); // no webhooks configured
  const handoff = new SupportHandoffService(tickets, publisher);

  const result = await handoff.createHandoff({
    merchantId: "mrc_1",
    buyerMessage: "Sem integração"
  });

  assert.equal((await tickets.list("mrc_1")).length, 1);
  assert.match(result.reply, /Referência: /);
});
