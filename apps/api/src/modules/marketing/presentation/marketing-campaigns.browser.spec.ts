import { test } from "node:test";
import assert from "node:assert/strict";
import { marketingHttpFixture } from "../marketing-http.fixture.js";
import {
  marketingBrowserFixture,
  expect,
} from "../../../../../dashboard/tests/marketing-browser.fixture.mjs";
import {
  MERCHANT_MARKETING_MESSAGING,
  type MerchantMarketingMessaging,
} from "../../../shared/contracts/marketing.js";
import { MarketingCampaignWorker } from "../infrastructure/marketing-campaign.worker.js";
import { MarketingCampaignsService } from "../application/marketing-campaigns.service.js";

test("MKT-05/3 merchant gestures configure, draft, approve, edit, schedule, pause and dispatch the exact approved audience", async () => {
  const api = await marketingHttpFixture();
  try {
    const submissions: string[] = [];
    let sends = 0;
    const messaging = api.app.get<MerchantMarketingMessaging>(
      MERCHANT_MARKETING_MESSAGING
    );
    messaging.submitTemplate = async (input) => {
      submissions.push(input.name);
      return { name: input.name, status: "pending", wabaId: "local-waba" };
    };
    messaging.inspectTemplate = async (input) => ({
      name: input.name,
      status: "approved",
      wabaId: "local-waba",
    });
    messaging.checkTemplate = async () => true;
    messaging.sendCampaign = async () => {
      sends++;
      return { status: "accepted", messageId: "local-campaign-accepted" };
    };
    const now = new Date().toISOString();
    await api.contacts.inbound({
      merchantId: api.merchantId,
      channel: "whatsapp",
      conversationKey: "eligible",
      messageId: "grant",
      text: "Quero receber",
      receivedAt: now,
      verifiedPhone: "5511988881111",
    });
    await api.contacts.inbound({
      merchantId: api.merchantId,
      channel: "whatsapp",
      conversationKey: "declined",
      messageId: "decline",
      text: "Agora não",
      receivedAt: now,
      verifiedPhone: "5511988882222",
    });
    await api.repository.transaction(api.merchantId, "seed", (tx) =>
      tx.saveContact(api.contact({ origin: "site", channels: ["site"] }))
    );
    const browser = await marketingBrowserFixture(api);
    try {
      await browser.page.goto(
        `${browser.url}&view=marketing&user=${api.users.owner.id}`
      );
      await browser.page
        .getByRole("tab", { name: "Configurações", exact: true })
        .click();
      await browser.page
        .getByLabel("Fuso horário", { exact: true })
        .fill("UTC");
      await browser.page.getByLabel("Hora inicial", { exact: true }).fill("0");
      await browser.page.getByLabel("Hora final", { exact: true }).fill("24");
      await browser.page
        .getByLabel("Intervalo mínimo entre comunicações (horas)", {
          exact: true,
        })
        .fill("1");
      await browser.page
        .getByLabel("Máximo de mensagens comerciais por contato em 24 horas", {
          exact: true,
        })
        .fill("1");
      await browser.page
        .getByLabel("Retenção de leads inativos (dias)", { exact: true })
        .fill("30");
      await browser.page
        .getByRole("button", { name: "Salvar configurações", exact: true })
        .click();
      await expect(browser.page.getByRole("status")).toHaveText(
        "Configurações salvas."
      );
      await browser.page
        .getByRole("tab", { name: "Campanhas", exact: true })
        .click();
      await browser.page
        .getByRole("button", { name: "Criar campanha", exact: true })
        .click();
      await browser.page
        .getByLabel("Nome da campanha", { exact: true })
        .fill("Novidades locais");
      await browser.page
        .getByLabel("Mensagem", { exact: true })
        .fill("Novidades da loja. Para não receber promoções, responda PARAR.");
      await browser.page
        .getByLabel("Orçamento da campanha (R$)", { exact: true })
        .fill("10,00");
      await browser.page
        .getByLabel("Reserva estimada por mensagem (R$)", { exact: true })
        .fill("0,50");
      await browser.page
        .getByRole("button", { name: "Salvar rascunho", exact: true })
        .click();
      await expect(
        browser.page.getByRole("heading", {
          name: "Novidades locais",
          exact: true,
        })
      ).toBeVisible();
      const approve = async () => {
        await browser.page
          .getByRole("button", {
            name: "Enviar template para aprovação",
            exact: true,
          })
          .click();
        await expect(
          browser.page.getByText("Em análise pela Meta", { exact: true })
        ).toBeVisible();
        await browser.page
          .getByRole("button", {
            name: "Verificar aprovação na Meta",
            exact: true,
          })
          .click();
        await expect(
          browser.page.getByText("Aprovado pela Meta", { exact: true })
        ).toBeVisible();
        await browser.page
          .getByRole("button", {
            name: "Revisar e aprovar campanha",
            exact: true,
          })
          .click();
        await browser.page
          .getByRole("dialog")
          .getByRole("button", { name: "Aprovar campanha", exact: true })
          .click();
        await expect(
          browser.page.getByText(/Aprovada pelo lojista · Versão/)
        ).toBeVisible();
      };
      await approve();
      const campaigns = api.app.get(MarketingCampaignsService);
      let saved = (await campaigns.list(api.merchantId))[0];
      assert.equal(saved.budgetCents, 1000);
      assert.equal(saved.maxUnitCostCents, 50);
      assert.equal(saved.approvedBy, api.users.owner.id);
      assert.deepEqual(saved.audience, {
        selected: 3,
        eligible: 1,
        excluded: { no_phone: 1, no_consent: 1 },
      });
      await browser.page
        .getByRole("button", { name: "Editar rascunho", exact: true })
        .click();
      await browser.page
        .getByLabel("Mensagem", { exact: true })
        .fill(
          "Outra novidade da loja. Para não receber promoções, responda PARAR."
        );
      await browser.page
        .getByRole("button", { name: "Salvar rascunho", exact: true })
        .click();
      await expect(
        browser.page.getByText("Rascunho · Versão 2", { exact: true })
      ).toBeVisible();
      saved = await campaigns.get(api.merchantId, saved.id);
      assert.equal(saved.approvedVersion, null);
      assert.equal(
        (
          await api.repository.transaction(api.merchantId, "read", (tx) =>
            tx.recipients(saved.id)
          )
        ).length,
        0
      );
      await approve();
      assert.equal(submissions.length, 2);
      assert.notEqual(submissions[0], submissions[1]);
      const date = await browser.page.evaluate(() => {
        const value = new Date(Date.now() + 86400000);
        return new Date(value.getTime() - value.getTimezoneOffset() * 60000)
          .toISOString()
          .slice(0, 16);
      });
      await browser.page.getByLabel(/Agendar no seu fuso/).fill(date);
      await browser.page
        .getByRole("button", { name: "Agendar campanha", exact: true })
        .click();
      await expect(browser.page.getByText(/Agendada · Versão 2/)).toBeVisible();
      assert.equal(sends, 0);
      await browser.page
        .getByRole("button", { name: "Pausar campanha", exact: true })
        .click();
      await expect(browser.page.getByText(/Pausada · Versão 2/)).toBeVisible();
      await browser.page
        .getByRole("button", { name: "Liberar envio agora", exact: true })
        .click();
      await browser.page
        .getByRole("dialog")
        .getByRole("button", { name: "Iniciar envios", exact: true })
        .click();
      await expect(browser.page.getByText(/Em envio · Versão 2/)).toBeVisible();
      await api.app
        .get(MarketingCampaignWorker)
        .runCampaign(api.merchantId, saved.id);
      await browser.page
        .getByRole("button", { name: "Atualizar resultados", exact: true })
        .click();
      await expect(
        browser.page.getByText(/Finalizada · Versão 2/)
      ).toBeVisible();
      const report = await campaigns.report(api.merchantId, saved.id);
      assert.equal(sends, 1);
      assert.equal(report.counts.accepted, 1);
      assert.equal(report.counts.delivered, 0);
      assert.equal(report.counts.read, 0);
      assert.equal(report.reservedCents, 50);
      assert.equal(report.attributedRevenueCents, null);
      await expect(
        browser.page.getByText(/Receita atribuída indisponível/)
      ).toBeVisible();
      await browser.page.setViewportSize({ width: 320, height: 800 });
      assert.equal(
        await browser.page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth
        ),
        false
      );
      assert.deepEqual(browser.errors, []);
    } catch (error) {
      console.error(
        "marketing_campaign_browser_failure",
        browser.errors,
        await browser.page.locator("main").innerText()
      );
      throw error;
    } finally {
      await browser.close();
    }
  } finally {
    await api.cleanup();
  }
});
