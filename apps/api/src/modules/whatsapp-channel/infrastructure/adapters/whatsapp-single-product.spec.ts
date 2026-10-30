import test from 'node:test';
import assert from 'node:assert/strict';
import { CheckoutWhatsAppConversationAdapter } from './checkout-whatsapp-conversation.adapter.js';
import { buildMetaUiView, presentMetaUi, withMetaCartNavigation } from '../../domain/ui/meta-ui-renderer.js';

const initial: any = { version: 1, conversationId: 'conversation', stage: 'store', history: [{ role: 'user', content: 'Ver produtos' }], revision: '', page: 0, previousViews: [] };
const product: any = { id: 'protetor', name: 'Núcleo — Protetor Diário FPS 50', price: 9990, inStock: true,
  variants: [{ id: 'variant-40g', name: 'Tamanho', value: '40 g', stock: 3, price: 9990 }] };

function fixture(blocks: any[], detailsId = 'protetor') {
  const calls: any[] = []; const storeCalls: any[] = [];
  const port: any = { reply: async (input: any) => {
    calls.push(input);
    return input.uiAction?.tool === 'get_product_details' ? { message: 'Detalhes', blocks: [{ type: 'product_card', data: { ...product, id: detailsId } }], suggestedNext: ['Adicionar ao Carrinho'] }
      : { message: 'Encontrei o protetor. Quer adicionar ao carrinho?', blocks, suggestedNext: ['Selecionar Produto', 'Filtrar Produtos'] };
  } };
  const store = { execute: async (request: any) => {
    storeCalls.push(request);
    const result = await port.reply({ uiAction: request.ui_action });
    return { message: result.message, blocks: result.blocks, suggested_next: result.suggestedNext };
  } };
  const adapter = new CheckoutWhatsAppConversationAdapter({} as any, {} as any, store as any,
    { executeForMerchant: async () => ({ name: 'Athom' }) } as any,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined, undefined, port);
  return { calls, storeCalls, adapter };
}

test('welcome animation is HTTPS-only and appears once while text and menu stay available on later visits', async t => {
  const previous=process.env.API_PUBLIC_URL;
  t.after(()=>{if(previous===undefined)delete process.env.API_PUBLIC_URL;else process.env.API_PUBLIC_URL=previous});
  process.env.API_PUBLIC_URL='https://api.example.test';
  const f=fixture([]),buyer={globalUserId:'buyer',phone:'5521999990000'};
  const first=await f.adapter.respondStore({merchantId:'merchant',buyer,message:'Menu',state:initial});
  assert.equal(first.blocks.filter(b=>b.type==='welcome_animation').length,1);
  assert.equal(first.state.welcomeAnimationShown,true);
  const presentation=presentMetaUi(buildMetaUiView(first),'welcome');
  assert(presentation.messages.some(m=>m.type==='video'));
  assert(presentation.messages.some(m=>m.type==='text'&&m.text.body.includes('Athom')));
  const next=await f.adapter.respondStore({merchantId:'merchant',buyer,message:'Menu',state:first.state});
  assert(!next.blocks.some(b=>b.type==='welcome_animation'));
  process.env.API_PUBLIC_URL='http://api.example.test';
  const insecure=await f.adapter.respondStore({merchantId:'merchant',buyer,message:'Menu',state:initial});
  assert.equal(insecure.blocks.length,0);assert(insecure.agentMessage.includes('Athom'));
});

test('typing the single matching product opens authoritative purchase controls through one storefront turn', async () => {
  const f = fixture([{ type: 'product_carousel', data: { products: [{ id: 'protetor', name: product.name }] } }]);
  const response = await f.adapter.respondStore({ merchantId: 'merchant', buyer: { globalUserId: 'buyer', phone: '5521999990000' },
    message: 'Protetor diário 50fps', state: initial });
  assert.equal(f.calls.length, 2);
  assert.deepEqual(f.calls[1].uiAction, { tool: 'get_product_details', args: { productId: 'protetor' } });
  assert.equal(f.calls[1].merchantId, 'merchant');
  assert.equal(f.calls[1].sessionId, initial.conversationId);
  assert.equal(f.calls[1].buyerContext.globalUserId, 'buyer');
  assert.equal(f.storeCalls.length, 1, 'the product read cannot record a second buyer turn');
  assert.equal(response.state.history.length, initial.history.length + 2);
  assert.equal(response.state.selectedProductId, 'protetor');
  assert.equal(response.blocks.some(b => b.type === 'product_carousel'), false);
  const shown = presentMetaUi(withMetaCartNavigation(buildMetaUiView(response), false), 'product-turn');
  assert.deepEqual(shown.numericSelections[0], { kind: 'tool', tool: 'add_item_to_cart',
    args: { variantId: 'variant-40g', quantity: 1, selectedOptionItemIds: [], selectedServiceSlotId: undefined } });
  assert.ok(f.calls.every(call => !call.uiAction || call.uiAction.tool === 'get_product_details'), 'naming a product cannot add it automatically');
});

for (const [name, blocks, action, detailsId] of [
  ['ambiguous results', [{ type: 'product_carousel', data: { products: [product, { ...product, id: 'other' }] } }]],
  ['more search results', [{ type: 'product_carousel', data: { products: [product], nextCursor: 'next' } }]],
  ['typed filters restrict eligible variants', [{ type: 'product_carousel', data: { products: [{ ...product,
    price: 5000, variants: [{ id: 'eligible-variant', price: 5000, stock: 2 }] }],
    criteria: { version: 1, query: '*', maxPriceCents: 6000, attributes: [], unsupportedCriteria: [] } } }]],
  ['cart response', [{ type: 'product_carousel', data: { products: [product] } }, { type: 'cart_summary', data: { items: [] } }]],
  ['explicit catalog action', [{ type: 'product_carousel', data: { products: [product] } }], { tool: 'search_products', args: { query: '*' } }],
  ['mismatched product details', [{ type: 'product_carousel', data: { products: [product] } }], undefined, 'foreign'],
] as any[]) test(`single-product expansion preserves the catalog for ${name}`, async () => {
  const f = fixture(blocks, detailsId);
  const result = await f.adapter.respondStore({ merchantId: 'merchant', buyer: { globalUserId: 'buyer', phone: '5521999990000' },
    message: 'Protetor', state: initial, action: action ? { kind: 'tool', ...action } : undefined });
  assert.ok(result.blocks.some(b => b.type === 'product_carousel'));
  assert.equal(f.calls.length, name === 'mismatched product details' ? 2 : 1);
  assert.equal(f.storeCalls.length, 1);
});
