import test from 'node:test';
import assert from 'node:assert/strict';
import { createProductHandlers } from './product.handlers.js';
import { createSalesSearchPolicy } from '../../domain/services/sales-search-policy.js';
import { SearchFederatedProductsUseCase } from '../../../marketplace/application/use-cases/search-federated-products.use-case.js';
import { contextualSearchGroups } from '../../../catalog/domain/services/contextual-product-search.js';
import { normalizeSalesText } from '../../domain/services/sales-recommendation-intent.js';

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
  assert.equal(calls[0].query, 'hidratante textura leve sem perfume facial');
  assert.equal(calls[0].maxPriceCents, 15000);
  assert.equal(calls[0].limit, 3);
  assert.equal(calls[0].merchantId, 'owned');
  assert.equal(calls[0].queryMode, 'contextual');
});

test('shared recommendation can show a disclosed partner alternative only behind the effective Scale gate', async () => {
  for (const plan of ['growth', 'scale']) {
    let partnerReads = 0;
    const partner = { id: 'partner_serum', sourceMerchantId: 'seller', sourceProductId: 'source_serum', name: 'Sérum de Barreira',
      description: 'Hidratação leve com ceramidas, sem fragrância adicionada.', priceCents: 12990, currency: 'BRL', stockAvailable: true, imageUrl: null };
    const marketplace = new SearchFederatedProductsUseCase({ getById: async () => partner } as any,
      { get: async () => ({ enabled: true, blockedMerchants: [] }) } as any,
      { search: async (args: any) => { partnerReads++; return contextualSearchGroups(args.query).every(group =>
        group.some(term => normalizeSalesText(`${partner.name} ${partner.description}`).includes(term))) ? [{ id: partner.id }] : []; } } as any,
      { marketplaceConnection: { findMany: async () => [{ sellerMerchantId: 'seller' }] } } as any,
      { getEffectivePlan: async () => plan } as any);
    const deps: any = { productRepo: { search: async () => ({ products: [] }) },
      prisma: { checkoutSetting: { findUnique: async () => null } }, stockRepo: {},
      merchantRepo: { getProfile: async (seller: string) => { assert.equal(seller, 'seller'); return { name: 'Loja parceira autorizada' }; } },
      searchFederatedProducts: marketplace };
    const message = 'Quero hidratante para pele oleosa sem perfume, até R$ 150';
    const handlers = createProductHandlers(deps, { merchantId: 'host', sessionId: 'conversation', userMessage: message });
    const policy = createSalesSearchPolicy(message, []);
    const [search] = policy.wrap([{ name: 'search_products', execute: async args => ({ ok: true, data: await handlers.searchProducts(args as any) }) }]);
    const result: any = await search!.execute({ query: 'hidratante', limit: 3 });
    if (plan === 'scale') {
      assert.equal(partnerReads, 2, 'exact then related, not an unrestricted partner catalog');
      assert.equal(result.data.products.length, 1);
      assert.equal(result.data.products[0].source, 'marketplace');
      assert.equal(result.data.products[0].sellerName, 'Loja parceira autorizada');
      assert.equal(result.data.products[0].sellerMerchantId, 'seller');
      assert.match(policy.recommendationMessage!, /não confirma indicação para pele oleosa/);
    } else {
      assert.equal(partnerReads, 0);
      assert.deepEqual(result.data.products, []);
    }
  }
});

test('a confirmed local result has priority without querying partners just to fill three slots', async () => {
  const local = { id: 'local', name: 'Hidratante', description: 'Facial', type: 'physical', hasStock: true, variants: [],
    defaultVariant: { basePriceInCents: 7900 } };
  const deps: any = { productRepo: { search: async () => ({ products: [local] }) },
    prisma: { checkoutSetting: { findUnique: async () => null } }, stockRepo: {}, merchantRepo: {},
    searchFederatedProducts: { execute: async () => assert.fail('local exact result is already available') } };
  const result: any = await createProductHandlers(deps, { merchantId: 'host', sessionId: 'conversation' }).searchProducts({ query: 'hidratante' });
  assert.equal(result.products[0].id, 'local');
  assert.equal(result.products[0].source, 'local');
});
