import test from "node:test";
import assert from "node:assert/strict";
import { SupportTicketEventPublisher } from "./support-ticket-event.publisher.js";
import { InMemoryIntegrationsRepository } from "../../integrations/infrastructure/in-memory-integrations.repository.js";
import { TenantWebhookPublisher, UpsertWebhookEndpointUseCase } from "../../integrations/application/integrations.use-cases.js";
import type { SupportTicket } from "@zyon/shared-types";

const ticket: SupportTicket = {
  id: "sup_abc123",
  merchantId: "mrc_1",
  sessionId: "chk_1",
  buyerMessage: "Preciso de ajuda",
  status: "open",
  source: "widget",
  createdAt: "2026-07-01T12:00:00.000Z",
  updatedAt: "2026-07-01T12:00:00.000Z"
};

test("SupportTicketEventPublisher publishes support.ticket.created with minimal payload", async () => {
  const integrations = new InMemoryIntegrationsRepository();
  await new UpsertWebhookEndpointUseCase(integrations).execute({
    merchantId: "mrc_1",
    url: "https://example.com/webhooks",
    events: ["support.ticket.created"]
  });
  const publisher = new SupportTicketEventPublisher(new TenantWebhookPublisher(integrations));

  publisher.publishCreated(ticket);

  // fire-and-forget → give event loop a tick for async publish
  await new Promise((r) => setTimeout(r, 10));
  const [delivery] = await integrations.listWebhookDeliveries("mrc_1");

  assert.equal(delivery?.eventType, "support.ticket.created");
  const data = delivery?.envelope.data.ticket as { id: string; session_id: string | null; status: string; source: string };
  assert.equal(data.id, "sup_abc123");
  assert.equal(data.session_id, "chk_1");
  assert.equal(data.status, "open");
  assert.equal(data.source, "widget");
  // buyerMessage must NOT appear in the webhook payload
  assert.equal(JSON.stringify(delivery?.envelope).includes("Preciso de ajuda"), false);
});

test("SupportTicketEventPublisher is a no-op when webhook publisher is absent", () => {
  const publisher = new SupportTicketEventPublisher();

  // Must not throw even with no TenantWebhookPublisher injected.
  assert.doesNotThrow(() => publisher.publishCreated(ticket));
});

test("SupportTicketEventPublisher swallows publish errors", async () => {
  // Simulate a broken publisher that always rejects.
  const brokenPublisher = {
    publish: () => Promise.reject(new Error("Network failure"))
  } as never;
  const publisher = new SupportTicketEventPublisher(brokenPublisher);

  assert.doesNotThrow(() => publisher.publishCreated(ticket));
  await new Promise((r) => setTimeout(r, 10));
  // no unhandled rejection
});

test("SupportTicketEventPublisher sends null for sessionId when missing", async () => {
  const integrations = new InMemoryIntegrationsRepository();
  await new UpsertWebhookEndpointUseCase(integrations).execute({
    merchantId: "mrc_1",
    url: "https://example.com/webhooks",
    events: ["support.ticket.created"]
  });
  const publisher = new SupportTicketEventPublisher(new TenantWebhookPublisher(integrations));

  publisher.publishCreated({ ...ticket, sessionId: undefined });

  await new Promise((r) => setTimeout(r, 10));
  const [delivery] = await integrations.listWebhookDeliveries("mrc_1");
  const data = delivery?.envelope.data.ticket as { session_id: string | null };
  assert.equal(data.session_id, null);
});
