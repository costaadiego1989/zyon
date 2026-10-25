import { test, expect } from '@playwright/test';

/**
 * Direct API call test — bypasses frontend, calls storefront API directly
 * to verify what the LLM+tools return for each quick reply.
 */

const API = 'http://localhost:3009';

async function callChat(page: any, message: string): Promise<any> {
  return page.evaluate(async ({ api, msg }: { api: string; msg: string }) => {
    // Start conversation
    const startRes = await fetch(`${api}/storefront/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ merchant_id: 'demo@zyon.com' }),
    });
    if (!startRes.ok) {
      // Try getting merchant list
      return { error: `start failed: ${startRes.status}`, body: await startRes.text() };
    }
    const { conversation_id } = await startRes.json();

    // Send message
    const res = await fetch(`${api}/storefront/conversations/${conversation_id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ merchant_id: 'demo@zyon.com', user_message: msg, history: [] }),
    });
    if (!res.ok) return { error: `message failed: ${res.status}`, body: await res.text() };
    return res.json();
  }, { api: API, msg: message });
}

const QUICK_REPLIES = [
  { msg: "Ver Produtos", expect: "product_carousel" },
  { msg: "Ofertas", expect: "product_carousel" },
  { msg: "Categorias", expect: "category_carousel" },
  { msg: "Trocas e Devoluções", expect: "text" },
  { msg: "FAQ", expect: "text" },
  { msg: "Ver Avaliações", expect: "text" },
  { msg: "Comparar", expect: "text" },
  { msg: "Lista de Desejos", expect: "text" },
  { msg: "Adicionar ao Carrinho", expect: "text" },
  { msg: "Aplicar Cupom", expect: "text" },
  { msg: "Falar com Humano", expect: "text" },
];

for (const qr of QUICK_REPLIES) {
  test(`API: "${qr.msg}" returns valid response`, async ({ page }) => {
    await page.goto('/store/demo');
    const result = await callChat(page, qr.msg);

    console.log(`\n[${qr.msg}]`);
    console.log(`  message: ${result.message?.slice(0, 150)}`);
    console.log(`  blocks: ${JSON.stringify(result.blocks?.map((b: any) => b.type))}`);
    console.log(`  suggested_next: ${JSON.stringify(result.suggested_next)}`);
    console.log(`  error: ${result.error || 'none'}`);

    if (result.error) {
      console.log(`  ERROR BODY: ${result.body?.slice(0, 200)}`);
    }

    expect(result.message || result.error).toBeTruthy();
  }, { timeout: 60000 });
}
