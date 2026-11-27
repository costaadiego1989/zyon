import { test } from "node:test";
import assert from "node:assert/strict";
import { marketingHttpFixture } from "../marketing-http.fixture.js";

test("MKT-07/2 opening a contact shows observed interactions purchases money time and channel permission", async () => {
  const f = await marketingHttpFixture();
  try {
    const at = new Date(Date.now() - 3 * 3600000).toISOString();
    const incoming = await f.contacts.inbound({
      merchantId: f.merchantId,
      channel: "whatsapp",
      conversationKey: "profile-proof",
      messageId: "profile-proof",
      text: "quero receber",
      verifiedPhone: "5511987654321",
      receivedAt: at,
    });
    await f.contacts.recordPurchase(
      f.merchantId,
      incoming.contactId!,
      "profile-order-1",
      12300,
      new Date(Date.now() - 4 * 3600000).toISOString()
    );
    await f.contacts.recordPurchase(
      f.merchantId,
      incoming.contactId!,
      "profile-order-2",
      45,
      new Date(Date.now() - 4 * 3600000).toISOString()
    );
    const browser = await marketingBrowserFixture(f);
    try {
      await browser.page.goto(browser.url);
      await browser.page
        .getByRole("button", { name: "Ver contato", exact: true })
        .click();
      const fact = (label: string) =>
        browser.page
          .locator("dl > div")
          .filter({ has: browser.page.locator("dt", { hasText: label }) })
          .locator("dd");
      await expect(fact("Tempo nesta etapa")).toHaveText("3 horas");
      await expect(fact("Compras confirmadas")).toHaveText("2");
      await expect(fact("Valor comprado na loja")).toHaveText("R$\u00a0123,45");
      await expect(fact("Conversas conhecidas")).toHaveText("1");
      await expect(fact("Mensagens conhecidas")).toHaveText("1");
      await expect(
        browser.page.getByText(/Recebimento autorizado/)
      ).toBeVisible();
      await browser.page
        .getByRole("button", {
          name: "Registrar pedido de descadastro",
          exact: true,
        })
        .click();
      await expect(
        browser.page.getByText(/Recebimento não autorizado/)
      ).toBeVisible();
      assert.equal(
        (await f.contacts.detail(f.merchantId, incoming.contactId!)).consent
          ?.status,
        "revoked"
      );
      assert.deepEqual(browser.errors, []);
    } finally {
      await browser.close();
    }
  } finally {
    await f.cleanup();
  }
});
import {
  marketingBrowserFixture,
  expect,
} from "../../../../../dashboard/tests/marketing-browser.fixture.mjs";

test("MKT-07/1 real contact screen searches the entire tenant base and saves an audited stage through clicks", async () => {
  const api = await marketingHttpFixture();
  try {
    const target = api.contact({
      name: "Contato procurado fora da página",
      origin: "site",
      channels: ["site"],
    });
    await api.repository.transaction(api.merchantId, "seed", async (tx) => {
      await tx.saveContact(target);
      for (let i = 0; i < 60; i++)
        await tx.saveContact(
          api.contact({
            name: `Contato ${i}`,
            lastSeenAt: "2026-11-28T00:00:00.000Z",
          })
        );
    });
    await api.contacts.inbound({
      merchantId: api.merchantId,
      channel: "site",
      conversationKey: "anonymous",
      messageId: "anonymous-first",
      text: "Olá",
      receivedAt: api.now,
    });
    const browser = await marketingBrowserFixture(api);
    try {
      await browser.page.goto(browser.url);
      await expect(
        browser.page.getByRole("heading", { name: "Funil de relacionamento" })
      ).toBeVisible();
      await expect(
        browser.page.getByText("61 contatos identificados", { exact: false })
      ).toBeVisible();
      await expect(
        browser.page.getByRole("button", { name: "Próxima página" })
      ).toBeEnabled();
      await browser.page
        .getByPlaceholder("Nome, telefone ou e-mail")
        .fill("fora da página");
      await expect(
        browser.page.getByRole("button", { name: "Ver contato", exact: true })
      ).toHaveCount(1);
      await browser.page
        .getByRole("button", { name: "Ver contato", exact: true })
        .click();
      await expect(
        browser.page.getByRole("heading", { name: target.name!, exact: true })
      ).toBeVisible();
      await browser.page.getByLabel("Nova etapa").selectOption("interested");
      await browser.page
        .getByLabel("Motivo", { exact: true })
        .fill("Pediu detalhes do produto no atendimento");
      await browser.page
        .getByRole("button", { name: "Salvar etapa", exact: true })
        .click();
      await expect(
        browser.page.getByText("Novo contato → Interessado", { exact: true })
      ).toBeVisible();
      const detail = await api.contacts.detail(api.merchantId, target.id);
      assert.equal(detail.contact.stage, "interested");
      assert.equal(
        detail.history[0].reason,
        "Pediu detalhes do produto no atendimento"
      );
      assert.equal(detail.history[0].authorId, api.users.owner.id);
      assert.equal((await api.contacts.funnel(api.merchantId)).total, 61);
      assert.deepEqual(browser.errors, []);
    } finally {
      await browser.close();
    }
  } finally {
    await api.cleanup();
  }
});

test("MKT-07/3 funnel counts identified stage and origin across the whole store and excludes anonymous sessions", async () => {
  const api = await marketingHttpFixture();
  try {
    await api.repository.transaction(api.merchantId, "seed", async (tx) => {
      await tx.saveContact(
        api.contact({ origin: "site", stage: "interested" })
      );
      await tx.saveContact(
        api.contact({ origin: "whatsapp", stage: "interested" })
      );
      await tx.saveContact(
        api.contact({
          origin: "whatsapp",
          stage: "purchased",
          purchaseCount: 2,
          totalSpentCents: 5000,
        })
      );
    });
    await api.contacts.inbound({
      merchantId: api.merchantId,
      channel: "site",
      conversationKey: "visitor",
      messageId: "visitor",
      text: "Olá",
      receivedAt: api.now,
    });
    const response = await api.request("/funnel");
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.total, 3);
    assert.deepEqual(
      result.rows.sort(
        (
          a: { origin: string; stage: string },
          b: { origin: string; stage: string }
        ) => `${a.stage}${a.origin}`.localeCompare(`${b.stage}${b.origin}`)
      ),
      [
        { stage: "interested", origin: "site", total: 1 },
        { stage: "interested", origin: "whatsapp", total: 1 },
        { stage: "purchased", origin: "whatsapp", total: 1 },
      ]
    );
  } finally {
    await api.cleanup();
  }
});
