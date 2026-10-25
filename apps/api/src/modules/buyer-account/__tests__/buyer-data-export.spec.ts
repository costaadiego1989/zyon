import test from "node:test";
import assert from "node:assert/strict";
import { buildBuyerDataExport } from "../domain/services/build-buyer-data-export.service.js";
import { BuyerAddress } from "../domain/entities/buyer-address.entity.js";

test("buildBuyerDataExport includes profile, addresses, agent profile, conversations, purchases (LGPD)", () => {
  const exportPayload = buildBuyerDataExport({
    profile: {
      globalUserId: "guser_1",
      email: "Buyer@Example.com",
      displayName: "Maria",
      phone: "+5511999998888",
      cpf: "12345678901",
      createdAt: new Date("2026-01-01T00:00:00Z"),
    },
    addresses: [
      BuyerAddress.create({
        id: "addr_1",
        globalUserId: "guser_1",
        zip: "01310-100",
        street: "Avenida Paulista",
        number: "1000",
        complement: "Apto 12",
        neighborhood: "Bela Vista",
        city: "Sao Paulo",
        state: "SP",
        isDefault: true,
        createdAt: new Date("2026-01-15T00:00:00Z"),
      }),
    ],
    agentProfile: {
      globalUserId: "guser_1",
      name: "Agente Maria",
      personality: "balanced",
      maxRounds: 5,
      targetDiscountPercent: 5,
      minimumAcceptableDiscountPercent: 0,
      m2mEnabled: false,
    },
    conversations: [
      {
        id: "conv_1",
        globalUserId: "guser_1",
        sessionId: "session_1",
        merchantId: "mrc_1",
        startedAt: new Date("2026-06-10T12:00:00Z"),
        lastMessageAt: new Date("2026-06-10T12:00:30Z"),
        messages: [
          {
            id: "m1",
            role: "buyer",
            content: "Tem desconto?",
            createdAt: new Date("2026-06-10T12:00:00Z"),
            rating: null,
          },
        ],
      },
    ],
    purchases: [
      {
        merchantId: "mrc_1",
        orderId: "order_1",
        totalAmount: 199.9,
        currency: "BRL",
        completedAt: new Date("2026-05-20T12:00:00Z"),
        items: [{ sku: "sku_1", quantity: 1 }],
      },
    ],
  });

  // Top-level shape (LGPD expects machine-readable JSON, single file)
  assert.equal(exportPayload.schemaVersion, "1.0");
  assert.equal(exportPayload.generatedFor.globalUserId, "guser_1");
  assert.ok(exportPayload.generatedAt instanceof Date);
  assert.equal(exportPayload.sections.profile.email, "buyer@example.com"); // normalized lowercase
  assert.equal(exportPayload.sections.addresses.length, 1);
  assert.equal(exportPayload.sections.agentProfile?.name, "Agente Maria");
  assert.equal(exportPayload.sections.conversations.length, 1);
  assert.equal(exportPayload.sections.purchases.length, 1);
});

test("buildBuyerDataExport omits optional sections when absent", () => {
  const exportPayload = buildBuyerDataExport({
    profile: {
      globalUserId: "guser_2",
      email: "user2@example.com",
      displayName: "User2",
      phone: undefined,
      cpf: undefined,
      createdAt: new Date("2026-01-01T00:00:00Z"),
    },
    addresses: [],
    conversations: [],
    purchases: [],
  });

  assert.equal(exportPayload.sections.addresses.length, 0);
  assert.equal(exportPayload.sections.conversations.length, 0);
  assert.equal(exportPayload.sections.purchases.length, 0);
  // agentProfile is optional:
  assert.equal(exportPayload.sections.agentProfile, undefined);
});

test("buildBuyerDataExport normalizes profile PII (email lowercase, no whitespace)", () => {
  const exportPayload = buildBuyerDataExport({
    profile: {
      globalUserId: "guser_3",
      email: "  USER@Example.COM  ",
      displayName: "  John  ",
      createdAt: new Date(),
    },
    addresses: [],
    conversations: [],
    purchases: [],
  });
  assert.equal(exportPayload.sections.profile.email, "user@example.com");
  assert.equal(exportPayload.sections.profile.displayName, "John");
});
