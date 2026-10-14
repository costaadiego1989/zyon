import test from 'node:test';
import assert from 'node:assert/strict';
import { createProductHandlers } from './product.handlers.js';

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
