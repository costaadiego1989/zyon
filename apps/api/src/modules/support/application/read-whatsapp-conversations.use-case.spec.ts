// UNEXECUTED query/DTO contracts; authenticated HTTP/PG isolation remains mandatory.
import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import type { TenantPrincipal } from "../../../shared/auth/tenant-principal.js";
import { ReadWhatsAppConversationsUseCase } from "./read-whatsapp-conversations.use-case.js";
const actor = { kind: "human", tenantId: "merchant-a", userId: "operator-a", role: "staff" } as TenantPrincipal;
const ticket = { id: "ticket-a", status: "in_progress", buyerMessage: "Synthetic request", createdAt: new Date("2026-11-16T12:00:00Z"), updatedAt: new Date("2026-11-16T12:01:00Z") };
function fixture() {
  const calls: Array<{ table: string; query: unknown }> = [];
  const record = (table: string, result: unknown) => async (query: unknown) => { calls.push({ table, query }); return result; };
  const prisma = {
    $transaction: async (work: (tx: unknown) => Promise<unknown>): Promise<unknown> => work(prisma),
    supportTicket: { findMany: record("tickets.list", [ticket]), findFirst: record("tickets.detail", ticket) },
    whatsAppHandoffBinding: { findMany: record("bindings.list", []), findFirst: record("bindings.detail", null) },
    whatsAppChannelConfig: { findFirst: record("config", { credentials: "private-canary" }) },
    supportTicketMessage: { findMany: record("messages", []) },
  };
  return { calls, prisma, reader: new ReadWhatsAppConversationsUseCase(prisma as unknown as PrismaClient) };
}
test("T58 channel-scoped queue contracts", async t => {
  await t.test("tenant and source are server filters, never caller override fields", async () => {
    const f = fixture();const result = await f.reader.list(actor, { limit: "25" });
    assert.equal(result.data.length, 1);assert.deepEqual(f.calls[0], { table: "tickets.list", query: { where: { merchantId: "merchant-a", source: "whatsapp", mergedIntoId: null }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: 26 } });
    for (const input of [{ merchantId: "foreign" }, { source: "widget" }, { configId: "foreign" }]) await assert.rejects(f.reader.list(actor, input), /invalid_whatsapp_queue_query/);
    assert.equal(f.calls.length, 2, "only the first valid tickets+bindings reads execute");
  });
  await t.test("no binding is reported as null, never an invented AI/waiting state", async () => {
    const f = fixture();assert.equal((await f.reader.list(actor, {})).data[0].binding, null);
    const detail = await f.reader.detail(actor, "ticket-a", {});assert.equal(detail.binding, null);assert.equal(detail.channel, null);
    assert.equal(f.calls.some(call => call.table === "config"), false);
    const query = f.calls.find(call => call.table === "messages")!.query as { where: unknown };
    assert.deepEqual(query.where, { ticketId: "ticket-a", ticket: { merchantId: "merchant-a", source: "whatsapp", mergedIntoId: null } });
  });
  await t.test("invalid limits/cursors fail before a database read", async () => {
    const f = fixture();
    for (const input of [{ limit: "0" }, { limit: "201" }, { limit: "1.5" }, { limit: ["25"] }, { cursor: "unreadable" }, { cursor: "" }, { status: "made-up" }])
      await assert.rejects(f.reader.list(actor, input), /invalid_whatsapp_queue/);
    assert.equal(f.calls.length, 0);
  });
  await t.test("machine and unknown roles cannot reach queue or message reads", async () => {
    const f = fixture();
    for (const principal of [{ ...actor, kind: "m2m" }, { ...actor, role: "unknown" }]) {
      await assert.rejects(f.reader.list(principal as TenantPrincipal, {}), /human_operator_required/);
      await assert.rejects(f.reader.detail(principal as TenantPrincipal, "ticket-a", {}), /human_operator_required/);
    }
    assert.equal(f.calls.length, 0);
  });
  await t.test("a failed read rejects and does not masquerade as an empty success", async () => {
    const f = fixture();f.prisma.supportTicket.findMany = async () => { throw new Error("synthetic_database_unavailable"); };
    await assert.rejects(f.reader.list(actor, {}), /synthetic_database_unavailable/);
  });
});
