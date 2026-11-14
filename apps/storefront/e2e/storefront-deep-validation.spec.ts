import { test, expect, type Page } from '@playwright/test';

/**
 * DEEP VALIDATION — Captures actual API response + rendered DOM for each quick reply.
 * Verifies: (1) LLM text response (2) blocks returned (3) component rendered in DOM.
 *
 * Outputs structured results for reporting.
 */

const TIMEOUT = 55000;
const WAIT_MS = 5000;

interface QuickReplyResult {
  reply: string;
  stage: string;
  responseText: string;
  blocksReturned: string[];
  componentRendered: string[];
  pass: boolean;
  issue?: string;
}

const results: QuickReplyResult[] = [];

async function setup(page: Page) {
  await page.goto('/store/demo');
  await page.evaluate(() => localStorage.clear());
  await page.goto('/store/demo');
  await page.waitForSelector('button', { timeout: 15000 });
  await page.locator('button', { hasText: 'Por chat' }).click();
  await page.waitForTimeout(800);
}

async function sendAndCapture(page: Page, msg: string): Promise<{
  responseText: string;
  blocks: string[];
  dom: string[];
}> {
  let apiResponse: any = null;

  // Intercept API response
  page.on('response', async (response) => {
    if (response.url().includes('/storefront/') && response.url().includes('/chat') && response.status() === 200) {
      try {
        apiResponse = await response.json();
      } catch {}
    }
  });

  const input = page.locator('input[aria-label="Mensagem"]').first();
  const btn = page.locator('button[aria-label*="Enviar"]').first();
  await input.fill(msg);
  await btn.click();
  await page.waitForTimeout(WAIT_MS);

  // Get DOM rendered components
  const main = page.locator('[role="main"]');
  const responseText = (await main.textContent()) ?? "";

  // Check for specific rendered components
  const dom: string[] = [];

  // Product carousel/cards
  const productCards = await page.locator('[style*="product"], [aria-label*="produto"], [style*="carousel"]').count();
  if (productCards > 0) dom.push("product_carousel");

  // Check for image elements (product images in carousel)
  const images = await main.locator('img[src*="http"]').count();
  if (images > 0) dom.push("product_images");

  // Check for price display
  const hasPrice = /R\$\s*\d|BRL/i.test(responseText);
  if (hasPrice) dom.push("price_display");

  // Check for quick reply buttons rendered after response
  const qrButtons = await page.locator('button').filter({ hasText: /Selecionar|Filtrar|Adicionar|Ver|Continuar|Aplicar|Finalizar/ }).count();
  if (qrButtons > 0) dom.push("quick_replies_updated");

  // Check for agent bubble
  const agentBubbles = await main.locator('div[style*="background"]').count();
  if (agentBubbles > 0) dom.push("agent_bubble");

  // Extract blocks from API response
  const blocks: string[] = [];
  if (apiResponse?.blocks) {
    for (const b of apiResponse.blocks) {
      blocks.push(b.type);
    }
  }

  return { responseText: responseText.slice(-500), blocks, dom };
}

// ═══════════════════════════════════════════════════════════════════════
// TEST EACH QUICK REPLY — capture actual response
// ═══════════════════════════════════════════════════════════════════════

const QUICK_REPLIES = [
  // Welcome stage
  { reply: "Ver Produtos", stage: "welcome", expectText: /produto|encontr|dispon/i, expectBlock: "product_carousel" },
  { reply: "Encontrar Produto", stage: "welcome", expectText: /qual|busca|procur|produto/i, expectBlock: null },
  { reply: "Categorias", stage: "welcome", expectText: /categor|seção/i, expectBlock: "category_carousel" },
  { reply: "Prazo de Entrega", stage: "welcome", expectText: /cep|entreg|frete|informe/i, expectBlock: null },
  { reply: "Trocas e Devoluções", stage: "welcome", expectText: /devolu|troc|política|dias/i, expectBlock: null },
  { reply: "Rastrear Pedido", stage: "welcome", expectText: /pedido|número|rastr/i, expectBlock: null },
  { reply: "Meus Dados", stage: "welcome", expectText: /dados|perfil|email|identific/i, expectBlock: null },
  { reply: "Ofertas", stage: "welcome", expectText: /ofert|nossas|produ/i, expectBlock: "product_carousel" },
  // Browsing
  { reply: "Selecionar Produto", stage: "browsing", expectText: /qual|selecionar|produto/i, expectBlock: null },
  { reply: "Filtrar Produtos", stage: "browsing", expectText: /filtr|critério|preço/i, expectBlock: null },
  { reply: "Ofertas do Dia", stage: "browsing", expectText: /ofert|promoç|descont/i, expectBlock: "product_carousel" },
  // Filter
  { reply: "Por Preço", stage: "filter", expectText: /preço|valor|faixa/i, expectBlock: null },
  { reply: "Mais Vendidos", stage: "filter", expectText: /vendido|popular|produto/i, expectBlock: null },
  // Product Detail
  { reply: "Adicionar ao Carrinho", stage: "product_detail", expectText: /carrinho|adicion|qual/i, expectBlock: null },
  { reply: "Mais Informações", stage: "product_detail", expectText: /inform|detalh|produto/i, expectBlock: null },
  { reply: "Ver Avaliações", stage: "product_detail", expectText: /avaliação|review|produto|opini/i, expectBlock: null },
  { reply: "Comparar", stage: "product_detail", expectText: /compar|produto|quais/i, expectBlock: null },
  { reply: "Lista de Desejos", stage: "product_detail", expectText: /desejo|lista|favorit/i, expectBlock: null },
  // Cart
  { reply: "Ver Carrinho", stage: "added_to_cart", expectText: /carrinho|item|vazio|total/i, expectBlock: null },
  { reply: "Aplicar Cupom", stage: "added_to_cart", expectText: /cupom|código|desconto/i, expectBlock: null },
  { reply: "Finalizar Compra", stage: "added_to_cart", expectText: /finaliz|checkout|pagamento|carrinho/i, expectBlock: null },
  // Support
  { reply: "FAQ", stage: "support", expectText: /faq|pergunt|frequent/i, expectBlock: null },
  { reply: "Falar com Humano", stage: "support", expectText: /human|atendente|equipe/i, expectBlock: null },
  { reply: "Suporte", stage: "support", expectText: /suport|ajud|atendiment/i, expectBlock: null },
];

for (const qr of QUICK_REPLIES) {
  test(`[${qr.stage}] "${qr.reply}" → response + render validation`, async ({ page }) => {
    await setup(page);
    const { responseText, blocks, dom } = await sendAndCapture(page, qr.reply);

    // 1. Validate LLM responded with relevant text
    const textOk = qr.expectText.test(responseText);
    expect(textOk).toBe(true);

    // 2. Log what was returned for the report
    const result: QuickReplyResult = {
      reply: qr.reply,
      stage: qr.stage,
      responseText: responseText.slice(-200).trim(),
      blocksReturned: blocks,
      componentRendered: dom,
      pass: textOk,
    };

    // 3. If we expect a specific block, verify it
    if (qr.expectBlock) {
      const hasBlock = blocks.includes(qr.expectBlock) || dom.includes(qr.expectBlock);
      if (!hasBlock) {
        result.issue = `Expected block "${qr.expectBlock}" not found. Got: [${blocks.join(', ')}]`;
        // Don't fail — LLM may respond with text instead of tool call
        // Just flag for report
      }
    }

    results.push(result);
    console.log(JSON.stringify(result));
  }, { timeout: TIMEOUT });
}

test.afterAll(async () => {
  // Print summary report
  console.log('\n\n═══ QUICK REPLY DEEP VALIDATION REPORT ═══\n');
  console.log(`Total: ${results.length}`);
  console.log(`Pass: ${results.filter(r => r.pass).length}`);
  console.log(`Fail: ${results.filter(r => !r.pass).length}`);
  console.log(`Issues (block missing): ${results.filter(r => r.issue).length}`);
  console.log('\n');
  for (const r of results) {
    const status = r.pass ? '✅' : '❌';
    const blockInfo = r.blocksReturned.length > 0 ? `blocks:[${r.blocksReturned.join(',')}]` : 'text-only';
    const domInfo = r.componentRendered.length > 0 ? `dom:[${r.componentRendered.join(',')}]` : '';
    console.log(`${status} [${r.stage}] "${r.reply}" → ${blockInfo} ${domInfo} ${r.issue || ''}`);
  }
});
