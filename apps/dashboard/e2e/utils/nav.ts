/**
 * Canonical dashboard navigation helper.
 *
 * The sidebar (nav[aria-label="Módulos do painel"]) is a collapsible tree:
 * section headers render as `<Label>(<count>)` buttons; items render as
 * plain-label buttons. Advanced sections default collapsed, so an item is
 * only clickable after its section is expanded.
 *
 * This helper is the single source of truth for e2e navigation. Specs must
 * NOT click nav labels directly — the taxonomy changes and direct clicks rot.
 */

import { type Page, expect } from "@playwright/test";
import { TIMEOUTS } from "../config";

/** Section id → visible sidebar header label (must match nav-config NAV_SECTIONS). */
const SECTION_LABEL: Record<string, string> = {
  daily: "Diário",
  sales: "Vendas",
  catalog: "Catálogo",
  channels: "Canais",
  integrations: "Integrações",
  intelligence: "Inteligência IA",
  settings: "Configurações",
};

/**
 * Item label → owning section id (mirrors nav-config NAV_ITEMS).
 * Keyed by the exact visible label rendered in the sidebar.
 */
export const ITEM_SECTION: Record<string, string> = {
  "Primeiros passos": "daily",
  "Visão Geral": "daily",
  "Pedidos & Envios": "daily",
  Clientes: "daily",
  "Recuperação de Carrinho": "daily",
  Atendimento: "daily",
  "Funil de Conversão": "sales",
  Checkout: "sales",
  Cupons: "sales",
  "Cross Sell": "sales",
  "Testes A/B": "sales",
  Negociação: "sales",
  Automações: "sales",
  Produtos: "catalog",
  Categorias: "catalog",
  Estoque: "catalog",
  "Frete & Entregas": "catalog",
  Stories: "catalog",
  "Agente IA": "channels",
  "Tema & Aparência": "channels",
  WhatsApp: "channels",
  Marketplace: "channels",
  Domínio: "channels",
  Pagamentos: "integrations",
  "E-commerce": "integrations",
  "CRM & Marketing": "integrations",
  "API & Webhooks": "integrations",
  "Otimizador IA": "intelligence",
  "Impacto no Revenue": "intelligence",
  "Memória de Intenção": "intelligence",
  "Pós-Venda": "intelligence",
  "Base de Conhecimento": "intelligence",
  "Agentes M2M": "intelligence",
  Conta: "settings",
  Equipe: "settings",
  "Planos & Faturamento": "settings",
  "Histórico de Cobrança": "settings",
  Chargebacks: "settings",
  Auditoria: "settings",
  "Config. da Loja": "settings",
};

/**
 * Navigate to a dashboard tab by its exact sidebar item label.
 * Expands the owning section first if it is collapsed.
 */
export async function gotoTab(page: Page, itemLabel: string): Promise<void> {
  const nav = page.locator("nav[aria-label='Módulos do painel']");
  await expect(nav).toBeVisible({ timeout: TIMEOUTS.auth });

  const sectionId = ITEM_SECTION[itemLabel];
  const sectionLabel = sectionId ? SECTION_LABEL[sectionId] : undefined;

  // Item button matched by exact label (avoids matching section header prefix).
  const item = nav.getByRole("button", { name: itemLabel, exact: true });

  const alreadyVisible = await item.isVisible().catch(() => false);
  if (!alreadyVisible && sectionLabel) {
    // Section header renders as `<Label>(<count>)` — match by label prefix.
    const header = nav.locator("button").filter({ hasText: new RegExp(`^${escapeRegExp(sectionLabel)}\\(\\d+\\)$`) }).first();
    if (await header.isVisible().catch(() => false)) {
      await header.click();
      await page.waitForTimeout(300);
    }
  }

  await item.first().click({ timeout: TIMEOUTS.element });
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(600);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
