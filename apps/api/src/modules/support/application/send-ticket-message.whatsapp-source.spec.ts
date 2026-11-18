import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import type { HumanTenantPrincipal } from "../../../shared/auth/tenant-principal.js";
import type { PrismaWhatsAppHandoffRepository } from "../../whatsapp-channel/infrastructure/repositories/prisma-whatsapp-handoff.repository.js";
import { WhatsAppConversationsController } from "../presentation/http/whatsapp-conversations.controller.js";
import { SendTicketMessageUseCase } from "./send-ticket-message.use-case.js";

const principal: HumanTenantPrincipal = { kind: "human", tenantId: "tenant-a", userId: "operator-a", email: "synthetic@example.test", role: "staff" };
const context = { principal, requiredSource: "whatsapp" as const };
const command = { ticketId: "ticket-a", merchantId: principal.tenantId, senderType: "merchant" as const, content: "Synthetic reply", clientMessageId: "source_boundary_123" };

test("T58 dedicated WhatsApp purpose rejects ordinary and alias tickets before legacy writes", async () => {
  for (const mergedIntoId of [null, "another-whatsapp-ticket"]) {
    let transactions = 0;
    const reads: unknown[] = [];
    const prisma = {
      supportTicket: { findFirst: async (query: unknown) => { reads.push(query); return { id: command.ticketId, merchantId: principal.tenantId, source: "widget", mergedIntoId }; } },
      $transaction: async () => { transactions += 1; throw new Error("legacy_write_path_entered"); },
    } as unknown as PrismaClient;
    await assert.rejects(new SendTicketMessageUseCase(prisma).execute(command, context), { message: "whatsapp_case_not_found" });
    assert.deepEqual(reads, [{ where: { id: command.ticketId, merchantId: principal.tenantId } }]);
    assert.equal(transactions, 0);
  }
});

test("T58 a changed source under the canonical WhatsApp lock still cannot persist", async () => {
  let locks = 0;
  let writes = 0;
  const binding = { id: "binding-a", merchantId: principal.tenantId, configId: "config-a", whatsappSessionId: "session-a", ticketId: command.ticketId, mode: "human", epoch: 2, assignedOperatorId: principal.userId };
  const tx = {
    $queryRaw: async () => [],
    supportTicket: { findFirst: async () => ({ id: command.ticketId, merchantId: principal.tenantId, sessionId: "session-a", source: "widget", status: "in_progress", mergedIntoId: null, assignedTo: principal.userId }) },
    supportTicketMessage: { create: async () => { writes += 1; throw new Error("source_race_must_not_write"); } },
  };
  const prisma = {
    supportTicket: { findFirst: async () => ({ id: command.ticketId, merchantId: principal.tenantId, source: "whatsapp" }) },
    whatsAppHandoffBinding: { findFirst: async () => binding },
  } as unknown as PrismaClient;
  const handoffs = { withReadLock: async (_scope: unknown, work: (db: unknown, locked: unknown) => Promise<unknown>) => { locks += 1; return work(tx, { binding }); } } as unknown as PrismaWhatsAppHandoffRepository;
  await assert.rejects(new SendTicketMessageUseCase(prisma, handoffs).execute(command, context), { message: "whatsapp_case_not_found" });
  assert.equal(locks, 1);
  assert.equal(writes, 0);
});

test("T58 dedicated controller supplies its source purpose from the server", async () => {
  let actualContext: unknown;
  const controller = new WhatsAppConversationsController({} as never, {} as never, {
    execute: async (_input: unknown, serverContext: unknown) => {
      actualContext = serverContext;
      return { id: "message-a", ticketId: command.ticketId, senderType: "merchant", content: command.content, createdAt: new Date().toISOString(), metadata: { kind: "whatsapp_outgoing", schemaVersion: 1, clientMessageId: command.clientMessageId, delivery: { status: "queued", revision: 0 } } };
    },
  } as never, {} as never);
  await controller.sendMessage({ tenantPrincipal: principal }, command.ticketId, { content: command.content, clientMessageId: command.clientMessageId });
  assert.deepEqual(actualContext, { principal, requiredSource: "whatsapp" });
});
