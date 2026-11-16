import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { io, type Socket } from "socket.io-client";
import { createSupportFixture } from "../../../tests/platform-support-fixture.js";
import { supportMonth } from "./domain/platform-support.js";

test("support plan contracts hold over real HTTP, PostgreSQL and two API nodes", { skip: !process.env.PLATFORM_SUPPORT_TEST_DATABASE_URL, timeout: 120_000 }, async t => {
  const fixture = await createSupportFixture();
  const { prisma, merchants, operators } = fixture;
  const sockets: Socket[] = [];
  const request = async (path: string, token: string, method = "GET", body?: unknown, url = fixture.first.url) => {
    const response = await fetch(url + "/v1" + path, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() as any };
  };
  const capabilities = (key: string) => request("/merchants/me/platform-support/capabilities", merchants[key]!.token);
  const open = (key: string, mode: "ticket" | "realtime", id = randomUUID(), url?: string) => request("/merchants/me/platform-support", merchants[key]!.token, "POST", { subject: "Erro ao publicar produto", category: "bug", content: "O produto publicado não aparece no catálogo.", mode, clientRequestId: id }, url);
  try {
    await t.test("both reported routes are registered and Basic can create, list and follow tickets", async () => {
      const access = await capabilities("starter179");
      assert.equal(access.status, 200);
      assert.equal(access.body.canOpen, true); assert.equal(access.body.canRealtime, false); assert.equal(access.body.realtimeLimit, 0);
      const ticket = await open("starter179", "ticket");
      assert.equal(ticket.status, 201);
      const list = await request("/merchants/me/platform-support?mine=false", merchants.starter179!.token);
      assert.equal(list.status, 200); assert.equal(list.body.items[0].id, ticket.body.ticket.id);
      const reply = await request(`/platform/support/${ticket.body.ticket.id}/messages`, operators.support!.token, "POST", { content: "Recebemos o chamado e estamos verificando.", clientMessageId: randomUUID() });
      assert.equal(reply.status, 201);
      const history = await request(`/merchants/me/platform-support/${ticket.body.ticket.id}`, merchants.starter179!.token);
      assert.equal(history.body.messages.length, 2);
      const live = await open("starter179", "realtime");
      assert.equal(live.status, 403); assert.equal(live.body.code, "support_realtime_plan_required");
      const socket = io(fixture.first.url + "/platform-support", { transports: ["websocket"], auth: { kind: "merchant", accessToken: merchants.starter179!.token }, reconnection: false, autoConnect: false }); sockets.push(socket);
      const rejected = new Promise<string>((resolve, reject) => { const timer = setTimeout(() => reject(new Error("basic_socket_rejection_timeout")), 5000); socket.once("support_error", value => { clearTimeout(timer); resolve(value.code); }); });
      socket.connect(); assert.equal(await rejected, "unauthorized");
    });
    await t.test("a retry across nodes consumes once and a sixth live request is rejected without blocking tickets", async () => {
      const id = randomUUID();
      const retry = await Promise.all([open("growth", "realtime", id), open("growth", "realtime", id, fixture.second.url)]);
      assert.equal(retry[0]!.status, 201); assert.equal(retry[1]!.status, 201); assert.equal(retry[0]!.body.ticket.id, retry[1]!.body.ticket.id);
      assert.equal((await capabilities("growth")).body.realtimeUsed, 1);
      const admission = await Promise.all(Array.from({ length: 5 }, (_, index) => open("growth", "realtime", randomUUID(), index % 2 ? fixture.first.url : fixture.second.url)));
      assert.equal(admission.filter(result => result.status === 201).length, 4);
      const denied = admission.find(result => result.status === 409)!;
      assert.equal(denied.body.code, "support_realtime_limit_reached");
      const access = await capabilities("growth");
      assert.equal(access.body.realtimeUsed, 5); assert.equal(access.body.realtimeRemaining, 0); assert.equal(access.body.canRealtime, false); assert.equal(access.body.canOpen, true);
      assert.equal((await open("growth", "ticket")).status, 201);
      assert.equal((await open("growth", "realtime", id)).body.ticket.id, retry[0]!.body.ticket.id);
      assert.equal((await capabilities("growth")).body.realtimeUsed, 5);
      assert.equal((await capabilities("other")).body.realtimeUsed, 0);
      // Reopening and continuing the same live conversation do not consume again.
      const ticketId = retry[0]!.body.ticket.id;
      await request(`/platform/support/${ticketId}`, operators.support!.token, "PATCH", { status: "resolved" });
      assert.equal((await request(`/merchants/me/platform-support/${ticketId}/reopen`, merchants.growth!.token, "POST")).status, 201);
      assert.equal((await request(`/merchants/me/platform-support/${ticketId}/messages`, merchants.growth!.token, "POST", { content: "Mais detalhes do mesmo problema.", clientMessageId: randomUUID() })).status, 201);
      assert.equal((await capabilities("growth")).body.realtimeUsed, 5);
    });
    await t.test("Escala exceeds five live conversations and child stores share the paying account", async () => {
      for (let i = 0; i < 6; i++) assert.equal((await open(i % 2 ? "child" : "scale", "realtime")).status, 201);
      const access = await capabilities("child");
      assert.equal(access.body.realtimeLimit, null); assert.equal(access.body.realtimeRemaining, null); assert.equal(access.body.realtimeUsed, 6);
      assert.equal((await capabilities("scale")).body.realtimeUsed, 6);
      await prisma.merchantBillingSubscription.update({ where: { merchantId: merchants.scale!.id }, data: { planKey: "growth" } });
      const downgraded = await capabilities("child");
      assert.equal(downgraded.body.realtimeLimit, 5); assert.equal(downgraded.body.realtimeRemaining, 0);
      assert.equal((await open("child", "ticket")).status, 201);
      assert.equal((await open("child", "realtime")).body.code, "support_realtime_limit_reached");
    });
    await t.test("previous months do not consume the new month's allowance", async () => {
      await prisma.platformSupportMonthlyUsage.create({ data: { accountId: merchants.other!.id, month: "2020-01", used: 5 } });
      assert.equal((await capabilities("other")).body.realtimeUsed, 0);
      assert.equal((await open("other", "realtime")).status, 201);
      assert.equal((await capabilities("other")).body.realtimeUsed, 1);
      assert.equal(await prisma.platformSupportMonthlyUsage.count({ where: { accountId: merchants.other!.id, month: supportMonth() } }), 1);
    });
    await t.test("a persistence failure rolls back the live quota reservation", async () => {
      const content = "rollback_" + randomUUID().replaceAll("-", "");
      const constraint = "support_rollback_" + randomUUID().slice(0, 8);
      // Dedicated local DB only; this constraint simulates failure after admission.
      await prisma.$executeRawUnsafe(`ALTER TABLE platform_support_messages ADD CONSTRAINT ${constraint} CHECK (content <> '${content}') NOT VALID`);
      try {
        const failed = await request("/merchants/me/platform-support", merchants.other!.token, "POST", { subject: "Falha controlada de persistência", category: "bug", mode: "realtime", content, clientRequestId: randomUUID() });
        assert.equal(failed.status, 500);
        assert.equal((await capabilities("other")).body.realtimeUsed, 1);
        assert.equal(await prisma.platformSupportMessage.count({ where: { content } }), 0);
      } finally { await prisma.$executeRawUnsafe(`ALTER TABLE platform_support_messages DROP CONSTRAINT ${constraint}`); }
    });
  } finally { sockets.forEach(socket => socket.disconnect()); await fixture.close(); }
});
