import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaReturnNoticeRepository } from "./prisma-return-notice.repository.js";
import { enqueueReturnNotice } from "../../application/return-notice-persistence.js";

test("PostgreSQL notification claims are exclusive; decisions deduplicate both channels and unknown sends never requeue", { skip: !process.env.RETURNS_DATABASE_TEST }, async t => {
  const database = new URL(process.env.DATABASE_URL!);
  assert.equal(database.hostname, "127.0.0.1"); assert.equal(database.port, "56526"); assert.equal(database.pathname, "/returns_qa");
  const prisma = new PrismaClient(); const merchantId = `qa_notice_${randomUUID()}`;
  t.after(async () => { await prisma.return.deleteMany({ where: { merchantId } }); await prisma.$disconnect(); });
  const ret = await prisma.return.create({ data: { merchantId, orderId: `qa_order_${randomUUID()}`, buyerId: "qa_buyer", reason: "OTHER",
    imageUrls: [], status: "REJECTED", kind: "exchange", orderSnapshot: { items: [{ variantId: "selected", name: "Item selecionado" }, { variantId: "other", name: "Outro item" }] },
    items: { create: [{ variantId: "selected", quantity: 1 }] } }, include: { items: true } });
  await Promise.all(Array.from({ length: 6 }, (_, index) => prisma.$transaction(tx => enqueueReturnNotice(tx, {
    merchantId, ticketId: "qa_ticket", messageId: `qa_message_${index}`, type: "return_rejected", explanation: "Motivo registrado pelo atendente.", ret,
  }))));
  assert.equal(await prisma.returnNoticeDelivery.count({ where: { merchantId } }), 2);
  const row = await prisma.returnNoticeDelivery.findFirstOrThrow({ where: { merchantId } });
  assert.deepEqual((row.payload as any).items, [{ quantity: 1, name: "Item selecionado" }]);
  // Isolate this database-backed queue test from prior local browser fixtures.
  const scoped = { returnNoticeDelivery: {
    findFirst: (input: any) => prisma.returnNoticeDelivery.findFirst({ ...input, where: { ...input.where, merchantId } }),
    updateMany: (input: any) => prisma.returnNoticeDelivery.updateMany({ ...input, where: { ...input.where, merchantId } }),
  } };
  const repository = new PrismaReturnNoticeRepository(scoped as any);
  const now = new Date();
  const claims = (await Promise.all(Array.from({ length: 8 }, () => repository.claim(now)))).filter(claim => claim !== null);
  assert.equal(claims.length, 2); assert.equal(new Set(claims.map(claim => claim.id)).size, 2);
  const [first, second] = claims;
  assert.equal(await repository.begin(first!, now), true);
  assert.equal(await repository.begin(first!, now), false);
  const expired = new Date(now.getTime() + 91_000);
  assert.equal(await repository.expireSending(expired), 1);
  assert.equal(await repository.finish(first!, { status: "accepted", providerMessageId: "late_provider_id" }, expired), false);
  assert.equal((await prisma.returnNoticeDelivery.findUniqueOrThrow({ where: { id: first!.id } })).status, "unknown");
  // Preparing before a provider send is recoverable; an uncertain sending row is not.
  const recovered = await repository.claim(expired);
  assert.equal(recovered?.id, second!.id); assert.ok(recovered);
  assert.equal(await repository.finish(recovered, { status: "waiting_template", reason: "approval_pending" }, expired), true);
  assert.equal(await repository.claim(expired), null);
  const waiting = await repository.claim(new Date(expired.getTime() + 5 * 60_000));
  assert.equal(waiting?.id, second!.id);
  assert.equal(await repository.begin(waiting!, new Date(expired.getTime() + 5 * 60_000)), true);
  assert.equal(await repository.finish(waiting!, { status: "accepted", providerMessageId: "wamid.ack" }, new Date(expired.getTime() + 5 * 60_000)), true);
  assert.equal(await repository.claim(new Date(expired.getTime() + 86400000)), null);
});
