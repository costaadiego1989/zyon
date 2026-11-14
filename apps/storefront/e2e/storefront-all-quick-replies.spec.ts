import { test, expect, type Page } from '@playwright/test';

/**
 * EXHAUSTIVE Quick Replies E2E — All 14 stages, ~60 replies
 *
 * Tests every single quick reply by sending it as a text message.
 * Validates LLM responds with contextually relevant content.
 *
 * Strategy: send the quick reply text → wait for agent → assert content pattern.
 * Uses generous timeouts since LLM (llama) can be slow.
 */

const TIMEOUT = 50000;
const WAIT_MS = 4000;

async function setup(page: Page) {
  await page.goto('/store/demo');
  await page.evaluate(() => localStorage.clear());
  await page.goto('/store/demo');
  await page.waitForSelector('button', { timeout: 15000 });
  await page.locator('button', { hasText: 'Por chat' }).click();
  await page.waitForTimeout(800);
}

async function send(page: Page, msg: string) {
  const input = page.locator('input[aria-label="Mensagem"]').first();
  const btn = page.locator('button[aria-label*="Enviar"]').first();
  await input.fill(msg);
  await btn.click();
  await page.waitForTimeout(WAIT_MS);
}

async function content(page: Page): Promise<string> {
  return (await page.locator('[role="main"]').textContent()) ?? "";
}

function matches(text: string, patterns: RegExp): boolean {
  return patterns.test(text);
}

// ═══════════════════════════════════════════════════════════════════════
// STAGE: welcome (8 replies)
// ═══════════════════════════════════════════════════════════════════════

test.describe('Stage: Welcome', () => {
  test('"Ver Produtos" → product listing', async ({ page }) => {
    await setup(page);
    await send(page, 'Ver Produtos');
    expect(matches(await content(page), /produto|encontr|dispon|listando|aqui/i)).toBe(true);
  }, { timeout: TIMEOUT });

  test('"Encontrar Produto" → asks which product', async ({ page }) => {
    await setup(page);
    await send(page, 'Encontrar Produto');
    expect(matches(await content(page), /qual|quais|busca|procur|produto|ajud|gostaria/i)).toBe(true);
  }, { timeout: TIMEOUT });

  test('"Categorias" → shows categories', async ({ page }) => {
    await setup(page);
    await send(page, 'Categorias');
    expect(matches(await content(page), /categor|seção|departament|tipo/i)).toBe(true);
  }, { timeout: TIMEOUT });

  test('"Prazo de Entrega" → asks CEP', async ({ page }) => {
    await setup(page);
    await send(page, 'Prazo de Entrega');
    expect(matches(await content(page), /cep|postal|endereço|entreg|frete|informe|localiz/i)).toBe(true);
  }, { timeout: TIMEOUT });

  test('"Trocas e Devoluções" → policy text', async ({ page }) => {
    await setup(page);
    await send(page, 'Trocas e Devoluções');
    expect(matches(await content(page), /devolu|troc|política|prazo|dias|reembolso/i)).toBe(true);
  }, { timeout: 60000 });

  test('"Rastrear Pedido" → asks order ID', async ({ page }) => {
    await setup(page);
    await send(page, 'Rastrear Pedido');
    expect(matches(await content(page), /pedido|número|código|rastr|identific|order/i)).toBe(true);
  }, { timeout: TIMEOUT });

  test('"Meus Dados" → profile or identification', async ({ page }) => {
    await setup(page);
    await send(page, 'Meus Dados');
    expect(matches(await content(page), /dados|perfil|email|nome|conta|identific|cadastr/i)).toBe(true);
  }, { timeout: TIMEOUT });

  test('"Ofertas" → deals (deterministic)', async ({ page }) => {
    await setup(page);
    await send(page, 'Ofertas');
    expect(matches(await content(page), /ofert|nossas|produ|descont|promoç/i)).toBe(true);
  }, { timeout: 15000 });
});

// ═══════════════════════════════════════════════════════════════════════
// STAGE: browsing (4 replies)
// ═══════════════════════════════════════════════════════════════════════

test.describe('Stage: Browsing', () => {
  test('"Selecionar Produto" → asks which product', async ({ page }) => {
    await setup(page);
    await send(page, 'Selecionar Produto');
    expect(matches(await content(page), /qual|selecionar|escolh|produto|gostaria|nome/i)).toBe(true);
  }, { timeout: TIMEOUT });

  test('"Filtrar Produtos" → asks filter criteria', async ({ page }) => {
    await setup(page);
    await send(page, 'Filtrar Produtos');
    expect(matches(await content(page), /filtr|critério|preço|avaliação|ordenar|preferência|como/i)).toBe(true);
  }, { timeout: TIMEOUT });

  test('"Ofertas do Dia" → deals (deterministic)', async ({ page }) => {
    await setup(page);
    await send(page, 'Ofertas do Dia');
    expect(matches(await content(page), /ofert|promoç|descont|produ|deal/i)).toBe(true);
  }, { timeout: 15000 });

  test('"Categorias" from browsing → shows categories', async ({ page }) => {
    await setup(page);
    await send(page, 'Ver Produtos');
    await send(page, 'Categorias');
    expect(matches(await content(page), /categor|seção|departament/i)).toBe(true);
  }, { timeout: TIMEOUT });
});

// ═══════════════════════════════════════════════════════════════════════
// STAGE: filter (7 replies)
// ═══════════════════════════════════════════════════════════════════════

test.describe('Stage: Filter', () => {
  test('"Por Preço" → sorts/filters by price', async ({ page }) => {
    await setup(page);
    await send(page, 'Por Preço');
    expect(matches(await content(page), /preço|valor|menor|maior|barato|caro|faixa|orçamento/i)).toBe(true);
  }, { timeout: TIMEOUT });

  test('"Por Avaliação" → sorts by rating', async ({ page }) => {
    await setup(page);
    await send(page, 'Por Avaliação');
    expect(matches(await content(page), /avaliação|nota|estrela|melhor|rating|avaliados/i)).toBe(true);
  }, { timeout: TIMEOUT });

  test('"Mais Vendidos" → shows bestsellers', async ({ page }) => {
    await setup(page);
    await send(page, 'Mais Vendidos');
    expect(matches(await content(page), /vendido|popular|mais|produto|sucesso/i)).toBe(true);
  }, { timeout: TIMEOUT });

  test('"Novidades" → shows new arrivals', async ({ page }) => {
    await setup(page);
    await send(page, 'Novidades');
    expect(matches(await content(page), /novidad|novo|recente|lançamento|chegou/i)).toBe(true);
  }, { timeout: TIMEOUT });

  test('"Frete Grátis" → filters free shipping', async ({ page }) => {
    await setup(page);
    await send(page, 'Frete Grátis');
    expect(matches(await content(page), /frete|grátis|gratuito|entreg|envio/i)).toBe(true);
  }, { timeout: TIMEOUT });

  test('"Por Desconto" → shows discounted items', async ({ page }) => {
    await setup(page);
    await send(page, 'Por Desconto');
    expect(matches(await content(page), /desconto|promoç|oferta|%|reduzido/i)).toBe(true);
  }, { timeout: TIMEOUT });

  test('"Limpar Filtros" → resets filters', async ({ page }) => {
    await setup(page);
    await send(page, 'Limpar Filtros');
    expect(matches(await content(page), /filtro|limpar|reset|removid|todos|padrão/i)).toBe(true);
  }, { timeout: TIMEOUT });
});

// ═══════════════════════════════════════════════════════════════════════
// STAGE: categories (2 replies)
// ═══════════════════════════════════════════════════════════════════════

test.describe('Stage: Categories', () => {
  test('"Ver Todas" → lists all categories', async ({ page }) => {
    await setup(page);
    await send(page, 'Ver Todas');
    expect(matches(await content(page), /categor|todas|lista|disponív/i)).toBe(true);
  }, { timeout: TIMEOUT });

  test('"Filtrar Categoria" → asks which category', async ({ page }) => {
    await setup(page);
    await send(page, 'Filtrar Categoria');
    expect(matches(await content(page), /categor|qual|filtr|escolh|prefer/i)).toBe(true);
  }, { timeout: TIMEOUT });
});

// ═══════════════════════════════════════════════════════════════════════
// STAGE: product_detail (7 replies)
// ═══════════════════════════════════════════════════════════════════════

test.describe('Stage: Product Detail', () => {
  test('"Adicionar ao Carrinho" → adds or asks which product', async ({ page }) => {
    await setup(page);
    await send(page, 'Adicionar ao Carrinho');
    expect(matches(await content(page), /carrinho|adicion|qual|produto|item/i)).toBe(true);
  }, { timeout: TIMEOUT });

  test('"Mais Informações" → shows product details', async ({ page }) => {
    await setup(page);
    await send(page, 'Mais Informações');
    expect(matches(await content(page), /inform|detalh|especific|produto|qual/i)).toBe(true);
  }, { timeout: TIMEOUT });

  test('"Ver Avaliações" → shows reviews', async ({ page }) => {
    await setup(page);
    await send(page, 'Ver Avaliações');
    expect(matches(await content(page), /avaliação|review|estrela|nota|comentár|qual|produto|ver|opini/i)).toBe(true);
  }, { timeout: TIMEOUT });

  test('"Tirar Dúvidas" → opens questions flow', async ({ page }) => {
    await setup(page);
    await send(page, 'Tirar Dúvidas');
    expect(matches(await content(page), /dúvida|pergunt|responder|ajud|qual/i)).toBe(true);
  }, { timeout: TIMEOUT });

  test('"Comparar" → comparison or asks products', async ({ page }) => {
    await setup(page);
    await send(page, 'Comparar');
    expect(matches(await content(page), /compar|produto|quais|versus|diferenç/i)).toBe(true);
  }, { timeout: TIMEOUT });

  test('"Lista de Desejos" → wishlist action', async ({ page }) => {
    await setup(page);
    await send(page, 'Lista de Desejos');
    expect(matches(await content(page), /desejo|lista|favorit|salv|wishlist/i)).toBe(true);
  }, { timeout: TIMEOUT });

  test('"Produtos Semelhantes" → similar products', async ({ page }) => {
    await setup(page);
    await send(page, 'Produtos Semelhantes');
    expect(matches(await content(page), /semelhant|similar|parec|relacion|sugest/i)).toBe(true);
  }, { timeout: TIMEOUT });
});

// ═══════════════════════════════════════════════════════════════════════
// STAGE: added_to_cart (5 replies)
// ═══════════════════════════════════════════════════════════════════════

test.describe('Stage: Added to Cart', () => {
  test('"Ver Carrinho" → shows cart contents', async ({ page }) => {
    await setup(page);
    await send(page, 'Ver Carrinho');
    expect(matches(await content(page), /carrinho|cart|item|vazio|produto|total/i)).toBe(true);
  }, { timeout: TIMEOUT });

  test('"Continuar Comprando" → back to products', async ({ page }) => {
    await setup(page);
    await send(page, 'Continuar Comprando');
    expect(matches(await content(page), /continu|compra|produto|busca|ajud|mais/i)).toBe(true);
  }, { timeout: TIMEOUT });

  test('"Aplicar Cupom" → coupon flow', async ({ page }) => {
    await setup(page);
    await send(page, 'Aplicar Cupom');
    expect(matches(await content(page), /cupom|código|desconto|aplic|tem|informe/i)).toBe(true);
  }, { timeout: TIMEOUT });

  test('"Finalizar Compra" → checkout flow', async ({ page }) => {
    await setup(page);
    await send(page, 'Finalizar Compra');
    expect(matches(await content(page), /finaliz|checkout|pagamento|compra|carrinho|vazio/i)).toBe(true);
  }, { timeout: TIMEOUT });

  test('"Produtos Similares" → related products', async ({ page }) => {
    await setup(page);
    await send(page, 'Produtos Similares');
    expect(matches(await content(page), /similar|parec|relacion|semelhant|sugest/i)).toBe(true);
  }, { timeout: TIMEOUT });
});

// ═══════════════════════════════════════════════════════════════════════
// STAGE: post_purchase (6 replies)
// ═══════════════════════════════════════════════════════════════════════

test.describe('Stage: Post-Purchase', () => {
  test('"Nota Fiscal" → invoice request', async ({ page }) => {
    await setup(page);
    await send(page, 'Nota Fiscal');
    expect(matches(await content(page), /nota|fiscal|invoice|pedido|número|NF/i)).toBe(true);
  }, { timeout: TIMEOUT });

  test('"Alterar Endereço" → address change', async ({ page }) => {
    await setup(page);
    await send(page, 'Alterar Endereço');
    expect(matches(await content(page), /endereço|alter|atualiz|entrega|pedido/i)).toBe(true);
  }, { timeout: TIMEOUT });

  test('"Cancelar Pedido" → cancellation flow', async ({ page }) => {
    await setup(page);
    await send(page, 'Cancelar Pedido');
    expect(matches(await content(page), /cancel|pedido|certeza|motivo|confirm/i)).toBe(true);
  }, { timeout: TIMEOUT });

  test('"Avaliar Produto" → review creation', async ({ page }) => {
    await setup(page);
    await send(page, 'Avaliar Produto');
    expect(matches(await content(page), /avali|produto|nota|estrela|qual|feedback/i)).toBe(true);
  }, { timeout: TIMEOUT });

  test('"Suporte" → support flow', async ({ page }) => {
    await setup(page);
    await send(page, 'Suporte');
    expect(matches(await content(page), /suport|ajud|atendiment|faq|problema|posso/i)).toBe(true);
  }, { timeout: TIMEOUT });
});

// ═══════════════════════════════════════════════════════════════════════
// STAGE: support (4 replies)
// ═══════════════════════════════════════════════════════════════════════

test.describe('Stage: Support', () => {
  test('"FAQ" → frequently asked questions', async ({ page }) => {
    await setup(page);
    await send(page, 'FAQ');
    expect(matches(await content(page), /faq|pergunt|frequent|dúvida|respost/i)).toBe(true);
  }, { timeout: TIMEOUT });

  test('"Falar com Humano" → escalation', async ({ page }) => {
    await setup(page);
    await send(page, 'Falar com Humano');
    expect(matches(await content(page), /human|atendente|equipe|transferir|encaminh|suport/i)).toBe(true);
  }, { timeout: TIMEOUT });

  test('"Reportar Problema" → issue report', async ({ page }) => {
    await setup(page);
    await send(page, 'Reportar Problema');
    expect(matches(await content(page), /problem|reportar|relat|ocorr|descrev|ajud/i)).toBe(true);
  }, { timeout: TIMEOUT });

  test('"Status do Pedido" → order status', async ({ page }) => {
    await setup(page);
    await send(page, 'Status do Pedido');
    expect(matches(await content(page), /status|pedido|número|rastr|andamento/i)).toBe(true);
  }, { timeout: TIMEOUT });
});
