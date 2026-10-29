import type { PrismaClient } from "@prisma/client";
import type { SupportTicketRepository } from "../domain/ports/support-ticket-repository.port.js";

/** Transaction fixture for controller contracts; database concurrency is tested separately. */
export function supportPrismaFixture(repository: SupportTicketRepository) {
  const messages: any[] = [], events: any[] = [];
  const tickets = new Map<string, any>();
  const tx: any = {
    $queryRaw: async () => [],
    supportTicket: {
      findFirst: async ({ where }: any) => {
        const item = await repository.get(where.merchantId, where.id);
        if (item) tickets.set(item.id, item);
        return item;
      },
      update: async ({ where, data }: any) => {
        const item = tickets.get(where.id);
        if (data.status) { const updated = await repository.updateStatus(item.merchantId, item.id, data.status); tickets.set(item.id, updated); return updated; }
        return item;
      },
    },
    return: { findFirst: async () => null },
    supportTicketMessage: {
      findFirst: async ({ where }: any) => messages.filter(item => item.ticketId === where.ticketId).at(-1) ?? null,
      create: async ({ data }: any) => { const item = { ...data, id: `msg_${messages.length + 1}` }; messages.push(item); return item; },
    },
    outboxMessage: { upsert: async ({ create }: any) => { events.push(create); return create; } },
  };
  return { prisma: { $transaction: async (work: any) => work(tx) } as PrismaClient, messages, events };
}
