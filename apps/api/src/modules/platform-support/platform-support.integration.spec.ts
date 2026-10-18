import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { io, type Socket } from "socket.io-client";
import { createSupportFixture } from "../../../tests/platform-support-fixture.js";

test("technical support persists authorized conversations across two API nodes", { skip: !process.env.PLATFORM_SUPPORT_TEST_DATABASE_URL, timeout: 120_000 }, async t => {
  const fixture = await createSupportFixture();
  const { prisma, merchants: m, operators: o } = fixture;
  const sockets: Socket[] = [];
  const request = async (path: string, token: string, method = "GET", body?: unknown, node = fixture.first.url) => {
    const response = await fetch(node + "/v1" + path, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() as any };
  };
  const open = async (key: string, node = fixture.first.url) => {
    const result = await request("/merchants/me/platform-support", m[key]!.token, "POST", { subject: `Erro de publicação ${key}`, category: "bug", content: "O produto não apareceu depois de publicar.", clientRequestId: randomUUID() }, node);
    assert.equal(result.status, 201, JSON.stringify(result.body)); return result.body.ticket.id as string;
  };
  const connect = async (token: string, kind: "merchant" | "operator", node: string) => {
    const socket = io(node + "/platform-support", { transports: ["websocket"], auth: { kind, accessToken: token }, autoConnect: false, reconnection: false }); sockets.push(socket);
    await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(new Error("socket_auth_timeout")), 5000); socket.once("authenticated", () => { clearTimeout(timer); resolve(); }); socket.once("connect_error", error => { clearTimeout(timer); reject(error); }); socket.connect(); });
    return socket;
  };
  let growth = "", scale = "", child = "";
  try {
    await t.test("plan permissions resolve the paying account under real tenant middleware", async () => {
      for (const [key, expected] of [["growth", "standard"], ["scale", "priority"], ["child", "priority"]]) {
        const result = await request("/merchants/me/platform-support/capabilities", m[key!]!.token);
        assert.equal(result.status, 200, JSON.stringify(result.body)); assert.equal(result.body.canOpen, true); assert.equal(result.body.tier, expected);
      }
      const denied = await request("/merchants/me/platform-support", m.starter179!.token, "POST", { subject: "Tentativa sem plano", category: "bug", content: "Uma descrição válida de problema.", clientRequestId: randomUUID() });
      assert.equal(denied.status, 403); assert.equal(denied.body.code, "support_plan_required");
      growth = await open("growth"); scale = await open("scale"); child = await open("child");
    });
    await t.test("queue uses current plan, severity and aging without starving Growth", async () => {
      let queue = await request("/platform/support", o.support!.token);
      assert.equal(queue.status, 200); assert.ok(queue.body.items.findIndex((x: any) => x.id === scale) < queue.body.items.findIndex((x: any) => x.id === growth));
      await prisma.platformSupportTicket.update({ where: { id: growth }, data: { waitingSince: new Date(Date.now() - 25 * 3_600_000) } });
      queue = await request("/platform/support", o.support!.token); assert.equal(queue.body.items[0].id, growth);
      await request(`/platform/support/${scale}`, o.support!.token, "PATCH", { severity: "critical" });
      queue = await request("/platform/support", o.support!.token); assert.equal(queue.body.items[0].id, scale);
      await prisma.merchantBillingSubscription.update({ where: { merchantId: m.scale!.id }, data: { planKey: "growth" } });
      assert.equal((await request(`/platform/support/${child}`, o.support!.token)).body.ticket.tier, "standard");
      await prisma.merchantBillingSubscription.update({ where: { merchantId: m.scale!.id }, data: { planKey: "scale" } });
    });
    await t.test("cross-tenant reads/writes and unauthorized operator roles are rejected", async () => {
      assert.equal((await request(`/merchants/me/platform-support/${growth}`, m.other!.token)).status, 404);
      assert.equal((await request(`/merchants/me/platform-support/${growth}/messages`, m.other!.token, "POST", { content: "Acesso indevido", clientMessageId: randomUUID() })).status, 404);
      for (const role of ["billing", "auditor"]) assert.equal((await request("/platform/support", o[role]!.token)).status, 403);
      assert.equal((await request(`/merchants/me/platform-support/${growth}/notes`, m.growth!.token)).status, 404);
      assert.equal((await request("/merchants/me/platform-support", m.growth!.token, "POST", { merchantId: m.other!.id })).status, 403);
    });
    await t.test("concurrent retries create one ticket and one message and reject key reuse", async () => {
      const input = { subject: "Mesmo chamado em duas abas", category: "bug", content: "A mesma ação foi repetida por perda de conexão.", clientRequestId: randomUUID() };
      const opened = await Promise.all([request("/merchants/me/platform-support", m.growth!.token, "POST", input), request("/merchants/me/platform-support", m.growth!.token, "POST", input, fixture.second.url)]);
      assert.equal(opened[0]!.status, 201); assert.equal(opened[0]!.body.ticket.id, opened[1]!.body.ticket.id);
      const payload = { content: "Mensagem única mesmo com duas tentativas", clientMessageId: randomUUID() };
      const responses = await Promise.all([request(`/merchants/me/platform-support/${growth}/messages`, m.growth!.token, "POST", payload), request(`/merchants/me/platform-support/${growth}/messages`, m.growth!.token, "POST", payload, fixture.second.url)]);
      assert.equal(responses[0]!.status, 201); assert.equal(responses[0]!.body.id, responses[1]!.body.id);
      assert.equal(await prisma.platformSupportMessage.count({ where: { ticketId: growth, clientMessageId: payload.clientMessageId } }), 1);
      assert.equal((await request(`/merchants/me/platform-support/${growth}/messages`, m.growth!.token, "POST", { ...payload, content: "Conteúdo diferente" })).status, 409);
    });
    await t.test("notes never appear in public history or outbox payloads", async () => {
      const privateText = "Nota restrita sobre a investigação interna";
      const note = await request(`/platform/support/${growth}/notes`, o.support!.token, "POST", { content: privateText, clientRequestId: randomUUID() }); assert.equal(note.status, 201);
      const publicHistory = await request(`/merchants/me/platform-support/${growth}`, m.growth!.token);
      assert.equal(JSON.stringify(publicHistory.body).includes(privateText), false); assert.equal("notes" in publicHistory.body, false);
      const outbox = await prisma.outboxMessage.findMany({ where: { merchantId: m.growth!.id, eventType: "platform.support.changed" } });
      assert.ok(outbox.length); assert.equal(JSON.stringify(outbox).includes(privateText), false);
      assert.ok(await prisma.platformAuditEvent.count({ where: { actorOperatorId: o.support!.id, action: "support.note.added", targetId: growth } }));
    });
    await t.test("operator assignment is fenced and replies can finish after downgrade", async () => {
      assert.equal((await request(`/platform/support/${growth}`, o.support!.token, "PATCH", { assignedOperatorId: o.support!.id, status: "in_progress" })).status, 200);
      assert.equal((await request(`/platform/support/${growth}`, o.second!.token, "PATCH", { assignedOperatorId: o.second!.id })).status, 409);
      assert.equal((await request(`/platform/support/${growth}`, o.support!.token, "PATCH", { assignedOperatorId: o.second!.id })).status, 403);
      await prisma.merchantBillingSubscription.update({ where: { merchantId: m.growth!.id }, data: { planKey: "starter179" } });
      assert.equal((await request(`/merchants/me/platform-support/${growth}/messages`, m.growth!.token, "POST", { content: "Continuo o chamado existente", clientMessageId: randomUUID() })).status, 201);
      await prisma.merchantBillingSubscription.update({ where: { merchantId: m.growth!.id }, data: { planKey: "growth" } });
    });
    await t.test("websocket delivery crosses Redis nodes and acknowledgement follows commit", async () => {
      const merchant = await connect(m.growth!.token, "merchant", fixture.first.url);
      const operator = await connect(o.support!.token, "operator", fixture.second.url);
      const other = await connect(m.other!.token, "merchant", fixture.second.url);
      let leaked = false; other.on("support_changed", event => { if (event.ticketId === growth) leaked = true; });
      const updated = new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(new Error("cross_node_notification_timeout")), 7000); operator.on("support_changed", event => { if (event.ticketId === growth) { clearTimeout(timer); resolve(); } }); });
      const clientMessageId = randomUUID();
      const ack = await merchant.timeout(5000).emitWithAck("send_message", { ticketId: growth, content: "Mensagem pelo WebSocket", clientMessageId });
      assert.equal(ack.success, true); assert.ok(await prisma.platformSupportMessage.findUnique({ where: { id: ack.message.id } }));
      const fallback = await request(`/merchants/me/platform-support/${growth}/messages`, m.growth!.token, "POST", { content: "Mensagem pelo WebSocket", clientMessageId });
      assert.equal(fallback.status, 201); assert.equal(fallback.body.id, ack.message.id);
      assert.equal(await prisma.platformSupportMessage.count({ where: { ticketId: growth, clientMessageId } }), 1);
      await updated; assert.equal(leaked, false);
      merchant.disconnect();
      await request(`/platform/support/${growth}/messages`, o.support!.token, "POST", { content: "Resposta salva enquanto o lojista estava desconectado", clientMessageId: randomUUID() });
      const recovered = await request(`/merchants/me/platform-support/${growth}`, m.growth!.token, "GET", undefined, fixture.second.url);
      assert.ok(recovered.body.messages.some((message: any) => message.content.includes("desconectado")));
      await request(`/merchants/me/platform-support/${growth}/read`, m.growth!.token, "POST", { sequence: recovered.body.ticket.lastMessageSequence });
      const read = await request(`/platform/support/${growth}`, o.support!.token);
      assert.equal(read.body.peerReadSequence, recovered.body.ticket.lastMessageSequence);
    });
    await t.test("revoked sessions stop inbound commands and outbound socket notifications", async () => {
      const socket = await connect(m.other!.token, "merchant", fixture.second.url);
      await fixture.merchantJwt.revoke(m.other!.token);
      const disconnected = new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(new Error("revocation_disconnect_timeout")), 5000); socket.once("disconnect", () => { clearTimeout(timer); resolve(); }); });
      socket.emit("send_message", { ticketId: growth, content: "Tentativa após logout", clientMessageId: randomUUID() });
      await disconnected;
      assert.equal((await request("/merchants/me/platform-support", m.other!.token)).status, 401);
      await fixture.operatorJwt.revoke(o.second!.token);
      assert.equal((await request("/platform/support", o.second!.token)).status, 401);
      const outgoing = await connect(o.billing!.token, "operator", fixture.second.url).then(() => false, () => true);
      assert.equal(outgoing, true, "an unauthorized operator cannot open the support socket");
    });
    await t.test("history is paginated without losing messages older than the latest page", async () => {
      const historyTicket = await open("child");
      await prisma.platformSupportMessage.createMany({ data: Array.from({ length: 120 }, (_, index) => ({ ticketId: historyTicket, sequence: index + 2, authorKey: `merchant:${m.child!.userId}`, sender: "merchant", content: `Mensagem histórica ${index + 2}`, clientMessageId: randomUUID() })) });
      await prisma.platformSupportTicket.update({ where: { id: historyTicket }, data: { lastMessageSequence: 121 } });
      const latest = await request(`/merchants/me/platform-support/${historyTicket}`, m.child!.token);
      assert.equal(latest.body.messages.length, 100); assert.equal(latest.body.hasMore, true); assert.equal(latest.body.messages[0].sequence, 22);
      const older = await request(`/merchants/me/platform-support/${historyTicket}?before=22`, m.child!.token);
      assert.equal(older.body.messages.length, 21); assert.equal(older.body.hasMore, false); assert.equal(older.body.messages[0].sequence, 1);
    });
    await t.test("resolution, reopen and history survive a fresh API instance", async () => {
      assert.equal((await request(`/platform/support/${growth}`, o.support!.token, "PATCH", { status: "resolved" })).status, 200);
      assert.equal((await request(`/merchants/me/platform-support/${growth}/messages`, m.growth!.token, "POST", { content: "Resolvido", clientMessageId: randomUUID() })).status, 409);
      assert.equal((await request(`/merchants/me/platform-support/${growth}/reopen`, m.growth!.token, "POST", {})).status, 201);
      const third = await fixture.start();
      const result = await request(`/merchants/me/platform-support/${growth}`, m.growth!.token, "GET", undefined, third.url);
      assert.equal(result.status, 200); assert.equal(result.body.ticket.status, "open"); assert.ok(result.body.messages.length >= 5);
    });
  } finally { for (const socket of sockets) socket.disconnect(); await fixture.close(); }
});
