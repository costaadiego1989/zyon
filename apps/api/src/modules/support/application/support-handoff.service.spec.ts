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

test("reusing an owned open case preserves new intake text once and emits its message event without another case", async () => {
  const now = new Date();
  const ticket = { id: "owned-ticket", merchantId: "merchant-a", sessionId: "conversation-a", buyerId: "buyer-a", buyerMessage: "Solicitação de atendimento humano", status: "open", createdAt: now, updatedAt: now };
  const messages: any[] = [{ id: "first", ticketId: ticket.id, content: "Falar com Humano", senderType: "buyer", createdAt: now }];
  const events: any[] = [];
  const tx = {
    $queryRaw: async () => [],
    supportTicket: { findFirst: async ({ where }: any) => { assert.equal(where.merchantId, "merchant-a"); assert.deepEqual(where.OR, [{ buyerId: "buyer-a" }, { sessionId: "conversation-a", buyerId: null }]); return ticket; },
      create: async () => assert.fail("must not create another ticket"), update: async () => ticket },
    supportTicketMessage: {
      findFirst: async ({ where, orderBy }: any) => messages.filter(message => message.ticketId === where.ticketId && (!where.content || where.content === message.content)).at(orderBy ? -1 : 0) ?? null,
      create: async ({ data }: any) => { const message = { id: `message-${messages.length}`, ...data }; messages.push(message); return message; },
    },
    outboxMessage: { upsert: async ({ create }: any) => { events.push(create); return create; } },
  };
  const handoff = new SupportHandoffService({} as any, { publishCreated: () => assert.fail("must not republish ticket creation") } as any, { $transaction: async (work: any) => work(tx) } as any);
  const request = { merchantId: "merchant-a", sessionId: "conversation-a", buyerId: "buyer-a", buyerMessage: "O pedido não chegou", initialMessage: "O pedido não chegou" };
  for (let retry = 0; retry < 2; retry++) assert.equal((await handoff.createHandoff(request)).ticketId, ticket.id);
  assert.equal(messages.length, 2); assert.equal(messages[1].content, request.initialMessage);
  assert.equal(events.length, 1); assert.equal(events[0].eventType, "support.case.changed");
  assert.equal(events[0].merchantId, "merchant-a"); assert.equal(events[0].payload.event, "message");
});
