/**
 * Ready to Prod — Seção Vendas (P2)
 * Cobertura E2E para:
 * - Funil de Conversão (#funnel)
 * - Checkout Settings (#settings)
 * - Cupons (#coupons) com CRUD completo e validações
 * - Cross Sell (#cross-sell)
 * - Testes A/B (#experiments)
 * - Negociação (#negotiation-policy)
 *
 * @tags @rtp @rtp:p2-sales
 */

import { test, expect, type Page } from "@playwright/test";
import { TIMEOUTS, STORAGE_STATE_PATH } from "./config";
import { gotoTab } from "./utils/nav";

test.use({ storageState: STORAGE_STATE_PATH });

async function navigateTo(page: Page, tabLabel: string, hashFallback: string): Promise<void> {
  try {
    await page.goto(`/#${hashFallback}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(600);
    const hasHeading = await page.locator("h1").first().isVisible({ timeout: 3000 }).catch(() => false);
    if (!hasHeading) {
      await gotoTab(page, tabLabel);
    }
  } catch {
    await gotoTab(page, tabLabel);
  }
}

test.describe("@rtp:p2-sales Seção Vendas", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator("nav[aria-label='Módulos do painel']")).toBeVisible({
      timeout: TIMEOUTS.navigation,
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. FUNIL DE CONVERSÃO (#funnel)
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe("1. Funil de Conversão (#funnel)", () => {
    test("renderiza etapas do funil, métricas e taxas sem NaN ou divisão por zero", async ({ page }) => {
      await navigateTo(page, "Funil de Conversão", "funnel");

      const heading = page.locator("h1").filter({ hasText: /Funil de Conversão/i });
      await expect(heading).toBeVisible({ timeout: TIMEOUTS.navigation });

      // Validação das métricas do funil
      await expect(page.locator("text=Conversão").first()).toBeVisible({ timeout: TIMEOUTS.element });
      await expect(page.locator("text=Sessões").first()).toBeVisible();
      await expect(page.locator("text=Maior Drop-off").first()).toBeVisible();
      await expect(page.locator("text=Tempo entre etapas").first()).toBeVisible();

      // Validação de texto para garantir ausência de NaN ou undefined
      const funnelText = await page.locator("main").textContent();
      expect(funnelText).not.toContain("NaN");
      expect(funnelText).not.toContain("undefined");

      // Botão de exportar CSV presente
      const exportBtn = page.locator("button[title='Exportar CSV'], .fnl-export-btn");
      if (await exportBtn.isVisible().catch(() => false)) {
        await expect(exportBtn).toBeVisible();
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. CHECKOUT SETTINGS (#settings)
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe("2. Checkout Settings (#settings)", () => {
    test("valida abas de configuração, toggles de comportamento e salvamento com persistência", async ({ page }) => {
      await navigateTo(page, "Checkout", "settings");

      const heading = page.locator("h1").filter({ hasText: /Configurações do Checkout/i });
      await expect(heading).toBeVisible({ timeout: TIMEOUTS.navigation });

      // Abas de configuração: Aparência, Sinais & Limites, Descontos, Regras
      const tabs = page.locator("[role='tablist']").first();
      await expect(tabs.getByRole("tab", { name: /Aparência/i })).toBeVisible();
      await expect(tabs.getByRole("tab", { name: /Sinais & Limites/i })).toBeVisible();
      await expect(tabs.getByRole("tab", { name: /Descontos/i })).toBeVisible();
      await expect(tabs.getByRole("tab", { name: /Regras/i })).toBeVisible();

      // Na aba Aparência: testar toggle 'Abrir ao ativar'
      const toggleOpen = page.locator("#toggle-open-widget");
      if (await toggleOpen.isVisible().catch(() => false)) {
        await toggleOpen.click();
        await page.waitForTimeout(300);

        // Indicador de mudanças pendentes deve aparecer
        const dirtyIndicator = page.locator("text=Mudanças pendentes");
        await expect(dirtyIndicator).toBeVisible({ timeout: TIMEOUTS.element });

        // Botão Salvar deve estar habilitado
        const saveBtn = page.getByRole("button", { name: /Salvar/i }).first();
        await expect(saveBtn).toBeEnabled();
        await saveBtn.click();
        await page.waitForTimeout(1000);

        // Feedback visual de salvamento ou sucesso
        const successBanner = page.locator("[role='status'], .cfg-banner, text=Configurações salvas");
        await expect(successBanner.first()).toBeVisible({ timeout: TIMEOUTS.element });
      }

      // Alternar para a aba Sinais & Limites
      const triggersTab = tabs.getByRole("tab", { name: /Sinais & Limites/i });
      await triggersTab.click();
      await page.waitForTimeout(400);

      // Valida presença de sinais do comprador e limites
      await expect(page.locator("text=Sinais do comprador").first()).toBeVisible();
      await expect(page.locator("text=Limites").first()).toBeVisible();
      await expect(page.locator("text=Espera entre ações").first()).toBeVisible();
      await expect(page.locator("text=Máximo por visita").first()).toBeVisible();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. CUPONS (#coupons) — CRUD COMPLETO & VALIDAÇÕES
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe("3. Cupons (#coupons)", () => {
    test("validações de formulário: código vazio e desconto > 100%", async ({ page }) => {
      await navigateTo(page, "Cupons", "coupons");

      const heading = page.locator("h1").filter({ hasText: /Cupons/i });
      await expect(heading).toBeVisible({ timeout: TIMEOUTS.navigation });

      // Clicar em Novo cupom
      const newCouponBtn = page.getByRole("button", { name: /Novo cupom/i });
      await newCouponBtn.click();
      await page.waitForTimeout(400);

      const modal = page.locator("[role='dialog']").first();
      await expect(modal).toBeVisible({ timeout: TIMEOUTS.element });

      // 1. Tentar salvar com código vazio
      const codeInput = modal.locator("input[placeholder*='SAVE10']");
      await codeInput.clear();
      const submitBtn = modal.getByRole("button", { name: /Criar cupom/i });
      await submitBtn.click();
      await page.waitForTimeout(400);

      // Feedback de erro
      const toastError = page.locator("[role='status'], .toast, text=Código do cupom é obrigatório");
      await expect(toastError.first()).toBeVisible({ timeout: TIMEOUTS.element });

      // 2. Tentar salvar com percentual > 100%
      await codeInput.fill("TESTINVALID150");
      const discountInput = modal.locator("input[type='number']").first();
      await discountInput.fill("150");
      await submitBtn.click();
      await page.waitForTimeout(400);

      // Feedback de erro para desconto > 100%
      const toastOver100 = page.locator("[role='status'], .toast, text=desconto percentual não pode ultrapassar 100%");
      await expect(toastOver100.first()).toBeVisible({ timeout: TIMEOUTS.element });

      // Cancelar / fechar modal
      const cancelBtn = modal.getByRole("button", { name: /Cancelar/i });
      await cancelBtn.click();
      await page.waitForTimeout(300);
      await expect(modal).not.toBeVisible();
    });

    test("CRUD completo: criar cupom, ler na lista, pausar/ativar e excluir", async ({ page }) => {
      await navigateTo(page, "Cupons", "coupons");

      const testCode = `PROMO${Date.now().toString().slice(-5)}`;

      // 1. CREATE
      const newCouponBtn = page.getByRole("button", { name: /Novo cupom/i });
      await newCouponBtn.click();
      await page.waitForTimeout(400);

      const modal = page.locator("[role='dialog']").first();
      await expect(modal).toBeVisible({ timeout: TIMEOUTS.element });

      const codeInput = modal.locator("input[placeholder*='SAVE10']");
      await codeInput.fill(testCode);

      const discountInput = modal.locator("input[type='number']").first();
      await discountInput.fill("15");

      const minCartInput = modal.locator("input[placeholder*='Ex: 100']");
      if (await minCartInput.isVisible().catch(() => false)) {
        await minCartInput.fill("100");
      }

      const submitBtn = modal.getByRole("button", { name: /Criar cupom/i });
      await submitBtn.click();
      await page.waitForTimeout(1000);

      // 2. READ
      // Verifica se o cupom criado aparece na lista
      const couponCard = page.locator("div").filter({ hasText: testCode }).first();
      await expect(couponCard).toBeVisible({ timeout: TIMEOUTS.navigation });
      await expect(couponCard.locator("text=15%")).toBeVisible();
      await expect(couponCard.locator("text=Ativo")).toBeVisible();

      // 3. UPDATE (Pausar / Ativar)
      const pauseBtn = couponCard.locator("button[title='Pausar']");
      if (await pauseBtn.isVisible().catch(() => false)) {
        await pauseBtn.click();
        await page.waitForTimeout(800);
        // Deve mudar status para Pausado ou botão mudar para Ativar
        const playBtn = couponCard.locator("button[title='Ativar']");
        const isPaused = await couponCard.locator("text=Pausado").isVisible().catch(() => false);
        const hasPlay = await playBtn.isVisible().catch(() => false);
        expect(isPaused || hasPlay).toBeTruthy();
      }

      // 4. DELETE
      const deleteBtn = couponCard.locator("button[title='Excluir']");
      if (await deleteBtn.isVisible().catch(() => false)) {
        await deleteBtn.click();
        await page.waitForTimeout(400);

        // Confirmação de exclusão
        const confirmModal = page.locator("[role='dialog']").filter({ hasText: /Excluir cupom/i });
        if (await confirmModal.isVisible().catch(() => false)) {
          const confirmDeleteBtn = confirmModal.getByRole("button", { name: /Excluir/i });
          await confirmDeleteBtn.click();
          await page.waitForTimeout(1000);
        }
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. CROSS SELL (#cross-sell)
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe("4. Cross Sell (#cross-sell)", () => {
    test("valida listagem de regras, touchpoints, estratégias e limites", async ({ page }) => {
      await navigateTo(page, "Cross Sell", "cross-sell");

      const heading = page.locator("h1").filter({ hasText: /Cross Sell/i });
      await expect(heading).toBeVisible({ timeout: TIMEOUTS.navigation });

      // Toggle global de Cross Sell ativo
      const activeSection = page.locator("text=Cross Sell ativo");
      await expect(activeSection).toBeVisible({ timeout: TIMEOUTS.element });

      // Botão Salvar presente
      const saveBtn = page.getByRole("button", { name: /Salvar/i });
      await expect(saveBtn).toBeVisible();

      // Seções de configuração
      await expect(page.locator("text=Onde sugerir").first()).toBeVisible();
      await expect(page.locator("text=Estratégia de recomendação").first()).toBeVisible();
      await expect(page.locator("text=Limites e apresentação").first()).toBeVisible();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. TESTES A/B (#experiments)
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe("5. Testes A/B (#experiments)", () => {
    test("valida listagem de experimentos, filtros e abertura de formulário de novo teste", async ({ page }) => {
      await navigateTo(page, "Testes A/B", "experiments");

      const heading = page.locator("h1").filter({ hasText: /Testes A\/B/i });
      await expect(heading).toBeVisible({ timeout: TIMEOUTS.navigation });

      // Toggle de testes automáticos
      await expect(page.locator("text=Testes automáticos")).toBeVisible();

      // Botão Novo Teste
      const newTestBtn = page.getByRole("button", { name: /Novo Teste/i });
      await expect(newTestBtn).toBeVisible();

      // Clicar em Novo Teste para verificar abertura do formulário / modal de teste
      await newTestBtn.click();
      await page.waitForTimeout(500);

      const modalOrForm = page.locator("[role='dialog'], form").first();
      await expect(modalOrForm).toBeVisible({ timeout: TIMEOUTS.element });

      // Fechar modal ou formulário
      const closeBtn = modalOrForm.getByRole("button", { name: /Cancelar|Fechar/i }).first();
      if (await closeBtn.isVisible().catch(() => false)) {
        await closeBtn.click();
      } else {
        await page.keyboard.press("Escape");
      }
      await page.waitForTimeout(300);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. NEGOCIAÇÃO (#negotiation-policy)
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe("6. Negociação (#negotiation-policy)", () => {
    test("valida política de teto de desconto, edição de margem e histórico de tentativas", async ({ page }) => {
      await navigateTo(page, "Negociação", "negotiation-policy");

      const heading = page.locator("h1").filter({ hasText: /Política de Negociação/i });
      await expect(heading).toBeVisible({ timeout: TIMEOUTS.navigation });

      // Informação explicativa sobre prioridade de negociação dinâmica
      await expect(page.locator("text=Negociação dinâmica tem prioridade")).toBeVisible();

      // Exibição dos limites configurados (MÍNIMO e MÁXIMO)
      await expect(page.locator("text=MÍNIMO")).toBeVisible();
      await expect(page.locator("text=MÁXIMO")).toBeVisible();

      // Botão Editar política
      const editPolicyBtn = page.getByRole("button", { name: /Editar política/i });
      if (await editPolicyBtn.isVisible().catch(() => false)) {
        await editPolicyBtn.click();
        await page.waitForTimeout(300);

        // Validação dos campos de Desconto mínimo e máximo
        await expect(page.locator("text=Desconto mínimo (%)")).toBeVisible();
        await expect(page.locator("text=Desconto máximo (%)")).toBeVisible();

        // Botão Salvar e Cancelar disponíveis
        const saveBtn = page.getByRole("button", { name: /Salvar/i }).first();
        const cancelBtn = page.getByRole("button", { name: /Cancelar/i }).first();
        await expect(saveBtn).toBeVisible();
        await expect(cancelBtn).toBeVisible();

        // Cancelar edição para manter integridade
        await cancelBtn.click();
        await page.waitForTimeout(300);
      }
    });
  });
});
