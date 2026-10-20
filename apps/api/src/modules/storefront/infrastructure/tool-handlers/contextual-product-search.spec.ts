import test from 'node:test';
import assert from 'node:assert/strict';
import { createProductHandlers } from './product.handlers.js';
import { createSalesSearchPolicy } from '../../domain/services/sales-search-policy.js';

test('shared search keeps the shopper need, tenant, budget and pagination when the model requests all products', async () => {
  const calls: any[] = [];
  const deps: any = { productRepo: { search: async (input: any) => { calls.push(input); return { products: [], total: 0 }; } },
    prisma: { checkoutSetting: { findUnique: async () => null } }, stockRepo: {}, merchantRepo: {} };
  const result: any = await createProductHandlers(deps, { merchantId: 'owned', sessionId: 'cart', userMessage: 'quero um produto para minha pele' })
    .searchProducts({ query: '*', maxPrice: 5000, inStockOnly: true, cursor: 'cursor', limit: 3 });
  assert.deepEqual(calls[0], { merchantId: 'owned', query: 'quero um produto para minha pele', queryMode: 'contextual', categoryId: undefined,
    maxPriceCents: 5000, inStockOnly: true, isActiveOnly: true, cursor: 'cursor', limit: 3 });
  assert.equal(result.products.length, 0);
  assert.match(result.note, /correspondentes/);
  await createProductHandlers(deps, { merchantId: 'owned', sessionId: 'cart' }).searchProducts({ query: '*' });
  assert.equal(calls[1].query, '*'); assert.equal(calls[1].queryMode, undefined);
});

test('discovery answers survive the real sales-policy and product-handler layers without false exclusions', async () => {
  const calls: any[] = [];
  const deps: any = { productRepo: { search: async (input: any) => { calls.push(input); return { products: [], total: 0 }; } },
    prisma: { checkoutSetting: { findUnique: async () => null } }, stockRepo: {}, merchantRepo: {} };
  const userMessage = 'É para o rosto. Não sei meu tipo de pele, não tenho outras preferências, sem perfume, até R$ 150.';
  const handler = createProductHandlers(deps, { merchantId: 'owned', sessionId: 'cart', userMessage });
  const [tool] = createSalesSearchPolicy(userMessage, [
    { role: 'user', content: 'Quero um produto para hidratação com textura leve' },
    { role: 'assistant', content: 'Qual seu tipo de pele?' },
  ]).wrap([{ name: 'search_products', execute: async args => ({ ok: true, data: await handler.searchProducts(args as any) }) }]);
  await tool!.execute({ query: 'hidratante textura leve', limit: 20 });
  assert.equal(calls[0].query, 'hidratante textura leve sem perfume');
  assert.equal(calls[0].maxPriceCents, 15000);
  assert.equal(calls[0].limit, 3);
  assert.equal(calls[0].merchantId, 'owned');
  assert.equal(calls[0].queryMode, 'contextual');
});
