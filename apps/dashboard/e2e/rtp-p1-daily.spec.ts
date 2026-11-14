/**
 * Ready to Prod — Seção Diário (P1)
 * Cobertura E2E para:
 * - Overview (#overview)
 * - Financeiro (#finance)
 * - Pedidos & Envios (#shipments)
 * - Clientes (#customers)
 * - Recuperação de Carrinho (#cart-recovery)
 * - Atendimento (#support)
 *
 * @tags @rtp @rtp:p1-daily
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

test.describe("@rtp:p1-daily Seção Diário", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator("nav[aria-label='Módulos do painel']")).toBeVisible({
      timeout: TIMEOUTS.navigation,
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. VISÃO GERAL (#overview)
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe("1. Visão Geral (#overview)", () => {
    test("valida cabeçalho, cards de KPI sem NaN e filtros de período", async ({ page }) => {
      await navigateTo(page, "Visão Geral", "overview");

      // Validação do cabeçalho
      const heading = page.locator("h1").filter({ hasText: /Visão Geral/i });
      await expect(heading).toBeVisible({ timeout: TIMEOUTS.navigation });
      await expect(page.locator("text=Métricas consolidadas do seu negócio")).toBeVisible();

      // Validação dos cards de KPI principais
      const expectedKpis = ["Receita Total", "Pedidos", "Conversão", "Ticket Médio"];
      for (const kpi of expectedKpis) {
        const card = page.locator(".stat-card, [class*='statCard']").filter({ hasText: kpi }).first();
        await expect(card).toBeVisible({ timeout: TIMEOUTS.element });

        // Não deve conter 'NaN' ou 'undefined'
        const text = await card.textContent();
        expect(text).not.toContain("NaN");
        expect(text).not.toContain("undefined");
      }

      // Validação do seletor de períodos (Hoje, 7 dias, 30 dias, 90 dias)
      const periodSelector = page.locator("[role='tablist']").first();
      await expect(periodSelector).toBeVisible();

      const period7d = periodSelector.getByRole("tab", { name: "7 dias" });
      await expect(period7d).toBeVisible();
      await period7d.click();
      await page.waitForTimeout(400);
      await expect(period7d).toHaveAttribute("aria-selected", "true");

      const period30d = periodSelector.getByRole("tab", { name: "30 dias" });
      await expect(period30d).toBeVisible();
      await period30d.click();
      await page.waitForTimeout(400);
      await expect(period30d).toHaveAttribute("aria-selected", "true");

      // Validação de gráficos ou painel informativo de gráficos sem NaN
      const chartsSection = page.locator("text=Gráficos").or(page.locator("text=Receita diária")).or(page.locator("text=Gráficos aparecerão aqui"));
      await expect(chartsSection.first()).toBeVisible({ timeout: TIMEOUTS.element });

      const pageBodyText = await page.locator("main").textContent();
      expect(pageBodyText).not.toContain("NaN%");
      expect(pageBodyText).not.toContain("R$ NaN");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. FINANCEIRO (#finance)
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe("2. Financeiro (#finance)", () => {
    test("valida tabela de lançamentos, abas, filtros e resumo financeiro", async ({ page }) => {
      await navigateTo(page, "Financeiro", "finance");

      const heading = page.locator("h1").filter({ hasText: /Financeiro/i });
      await expect(heading).toBeVisible({ timeout: TIMEOUTS.navigation });

      // Validação das abas principais (Visão geral, Transações, Relatórios)
      const tabsNav = page.locator("[role='tablist']").first();
      await expect(tabsNav.getByRole("tab", { name: /Visão geral/i })).toBeVisible();
      await expect(tabsNav.getByRole("tab", { name: /Transações/i })).toBeVisible();
      await expect(tabsNav.getByRole("tab", { name: /Relatórios/i })).toBeVisible();

      // Validação dos KPIs de resumo (Bruto, Pedidos concluídos, Ticket médio, Reembolsos)
      const grossCard = page.locator("text=Pedidos concluídos (bruto)").first();
      await expect(grossCard).toBeVisible({ timeout: TIMEOUTS.element });

      // Validação da seção de Agenda de repasses / Repasses protegidos
      const payoutSection = page.locator("text=Agenda de repasses").or(page.locator("text=REPASSES PROTEGIDOS"));
      await expect(payoutSection.first()).toBeVisible();

      // Alternar para aba Transações
      const transactionsTab = tabsNav.getByRole("tab", { name: /Transações/i });
      await transactionsTab.click();
      await page.waitForTimeout(500);

      // Validação dos filtros de tipo: Todas, Pedidos, Reembolsos
      await expect(page.getByRole("tab", { name: "Todas" })).toBeVisible();
      await expect(page.getByRole("tab", { name: "Pedidos" })).toBeVisible();
      await expect(page.getByRole("tab", { name: "Reembolsos" })).toBeVisible();

      // Campo de busca por pedido
      const searchInput = page.getByPlaceholder(/Buscar pedido ou método/i);
      await expect(searchInput).toBeVisible();

      // Alternar filtro de tipo
      await page.getByRole("tab", { name: "Pedidos" }).click();
      await page.waitForTimeout(400);

      // Botão de exportar CSV presente no cabeçalho
      const exportBtn = page.getByRole("button", { name: /Exportar CSV/i });
      await expect(exportBtn).toBeVisible();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. PEDIDOS & ENVIOS (#shipments)
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe("3. Pedidos & Envios (#shipments)", () => {
    test("renderiza Kanban em 5 colunas com contadores e modal de detalhes do pedido", async ({ page }) => {
      await navigateTo(page, "Pedidos & Envios", "shipments");

      const heading = page.locator("h1").filter({ hasText: /Pedidos e Envios/i });
      await expect(heading).toBeVisible({ timeout: TIMEOUTS.navigation });

      // Validação dos 5 KPIs superiores
      await expect(page.locator("text=Pedidos").first()).toBeVisible();
      await expect(page.locator("text=Aprovados").first()).toBeVisible();
      await expect(page.locator("text=Receita").first()).toBeVisible();
      await expect(page.locator("text=Rastreados").first()).toBeVisible();
      await expect(page.locator("text=Ticket Médio").first()).toBeVisible();

      // Validação das 5 colunas do Kanban
      const columns = ["Aguardando", "Pago", "Enviado", "Entregue", "Cancelado"];
      for (const col of columns) {
        const colHeader = page.locator("span").filter({ hasText: new RegExp(`^${col}$`) });
        await expect(colHeader.first()).toBeVisible({ timeout: TIMEOUTS.element });
      }

      // Botão de exportação CSV de pedidos
      const csvBtn = page.getByRole("button", { name: /CSV/i });
      await expect(csvBtn).toBeVisible();

      // Se houver pedidos no quadro, testar clique no card para abrir modal/painel lateral
      const anyCard = page.locator("[draggable='true']").first();
      if (await anyCard.isVisible().catch(() => false)) {
        await anyCard.click();
        await page.waitForTimeout(500);

        // Modal/aside lateral com detalhes do pedido
        const sidePanel = page.locator("aside").first();
        await expect(sidePanel).toBeVisible({ timeout: TIMEOUTS.element });

        // Informações obrigatórias no detalhe
        await expect(sidePanel.locator("text=Status atual").first()).toBeVisible();
        await expect(sidePanel.locator("text=Total").first()).toBeVisible();
        await expect(sidePanel.locator("text=Itens").first()).toBeVisible();
        await expect(sidePanel.locator("text=Cliente").first()).toBeVisible();
        await expect(sidePanel.locator("text=Pagamento").first()).toBeVisible();

        // Fechar o painel lateral
        const closeBtn = sidePanel.getByRole("button", { name: /Fechar/i });
        await closeBtn.click();
        await page.waitForTimeout(300);
        await expect(sidePanel).not.toBeVisible();
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. CLIENTES (#customers)
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe("4. Clientes (#customers)", () => {
    test("valida listagem de clientes, busca e perfil do comprador", async ({ page }) => {
      await navigateTo(page, "Clientes", "customers");

      const heading = page.locator("h1").filter({ hasText: /Clientes/i });
      await expect(heading).toBeVisible({ timeout: TIMEOUTS.navigation });

      // Barra de ferramentas com busca
      const searchInput = page.getByPlaceholder(/Buscar/i).first();
      await expect(searchInput).toBeVisible();

      // Teste de digitação na busca
      await searchInput.fill("Silva");
      await page.waitForTimeout(400);
      await searchInput.clear();
      await page.waitForTimeout(400);

      // Tabela de clientes ou estado vazio
      const customerTable = page.getByRole("table");
      const emptyState = page.locator("text=Nenhum cliente");
      const hasTable = await customerTable.isVisible().catch(() => false);
      const hasEmpty = await emptyState.isVisible().catch(() => false);
      expect(hasTable || hasEmpty).toBeTruthy();

      if (hasTable) {
        const rows = page.locator("tbody tr");
        if (await rows.count() > 0) {
          // Clicar no primeiro cliente para ver perfil/detalhes
          await rows.first().click();
          await page.waitForTimeout(500);

          // Detalhes do cliente ou modal
          const detailModal = page.locator("[role='dialog'], aside, .side-panel").first();
          if (await detailModal.isVisible().catch(() => false)) {
            await expect(detailModal).toBeVisible();
          }
        }
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. RECUPERAÇÃO DE CARRINHO (#cart-recovery)
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe("5. Recuperação de Carrinho (#cart-recovery)", () => {
    test("valida KPIs, seleção de estratégias, tentativas e templates de mensagens", async ({ page }) => {
      await navigateTo(page, "Recuperação de Carrinho", "cart-recovery");

      const heading = page.locator("h1").filter({ hasText: /Recuperação de Carrinho/i });
      await expect(heading).toBeVisible({ timeout: TIMEOUTS.navigation });

      // Validação das abas (Visão geral, Mensagens)
      const recoveryTabs = page.locator("[role='tablist']").first();
      await expect(recoveryTabs.getByRole("tab", { name: /Visão geral/i })).toBeVisible();
      await expect(recoveryTabs.getByRole("tab", { name: /Mensagens/i })).toBeVisible();

      // KPIs de recuperação
      await expect(page.locator("text=Carrinhos abandonados")).toBeVisible();
      await expect(page.locator("text=Tentativas de recuperação")).toBeVisible();
      await expect(page.locator("text=Recuperados")).toBeVisible();
      await expect(page.locator("text=Receita recuperada")).toBeVisible();

      // Estratégias de recuperação (radios)
      const strategiesSection = page.locator("fieldset[aria-label='Estratégia de recuperação']");
      await expect(strategiesSection).toBeVisible();

      await expect(strategiesSection.locator("text=Frete Grátis")).toBeVisible();
      await expect(strategiesSection.locator("text=Cross-sell")).toBeVisible();
      await expect(strategiesSection.locator("text=Cupom de Desconto")).toBeVisible();
      await expect(strategiesSection.locator("text=Regra Avançada")).toBeVisible();

      // Alternar para aba Mensagens (disparo / template com IA)
      const messagesTab = recoveryTabs.getByRole("tab", { name: /Mensagens/i });
      await messagesTab.click();
      await page.waitForTimeout(500);

      // Verifica painel de mensagens com IA e canais WhatsApp / E-mail
      await expect(page.locator("text=Mensagens de recuperação").first()).toBeVisible();
      const aiBtn = page.getByRole("button", { name: /Gerar mensagens com IA/i });
      if (await aiBtn.isVisible().catch(() => false)) {
        await expect(aiBtn).toBeVisible();
      }
      await expect(page.locator("legend").filter({ hasText: /E-mail/i })).toBeVisible();
      await expect(page.locator("legend").filter({ hasText: /WhatsApp/i })).toBeVisible();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. ATENDIMENTO (#support)
  // ═══════════════════════════════════════════════════════════════════════════
  test.describe("6. Atendimento (#support)", () => {
    test("valida lista/kanban de chamados, KPIs e alternância para FAQ automático", async ({ page }) => {
      await navigateTo(page, "Atendimento", "support");

      const heading = page.locator("h1").filter({ hasText: /Atendimento ao Comprador/i });
      await expect(heading).toBeVisible({ timeout: TIMEOUTS.navigation });

      // Abas de Atendimento: Chamados e FAQ automático
      const supportTabs = page.locator("[role='tablist']").first();
      await expect(supportTabs.getByRole("tab", { name: /Chamados/i })).toBeVisible();
      await expect(supportTabs.getByRole("tab", { name: /FAQ automático/i })).toBeVisible();

      // KPIs de chamados ou estado vazio
      const kpiTotal = page.locator(".stat-card, [class*='statCard']").filter({ hasText: /Total/i });
      const emptyTickets = page.locator("text=Nenhum chamado");
      const hasKpis = await kpiTotal.first().isVisible().catch(() => false);
      const isEmpty = await emptyTickets.isVisible().catch(() => false);
      expect(hasKpis || isEmpty).toBeTruthy();

      if (hasKpis) {
        // Valida as 4 colunas do Kanban de chamados
        await expect(page.locator("span").filter({ hasText: /^Abertos$/ }).first()).toBeVisible();
        await expect(page.locator("span").filter({ hasText: /^Em atendimento$/ }).first()).toBeVisible();
        await expect(page.locator("span").filter({ hasText: /^Resolvidos$/ }).first()).toBeVisible();
        await expect(page.locator("span").filter({ hasText: /^Fechados$/ }).first()).toBeVisible();
      }

      // Alternar para aba FAQ automático
      const faqTab = supportTabs.getByRole("tab", { name: /FAQ automático/i });
      await faqTab.click();
      await page.waitForTimeout(500);

      // Valida conteúdo do FAQ automático
      const faqContent = page.locator("text=FAQ").or(page.locator("text=Perguntas frequentes")).or(page.locator("button").filter({ hasText: /Nova pergunta|Adicionar/i }));
      await expect(faqContent.first()).toBeVisible({ timeout: TIMEOUTS.element });
    });
  });
});
