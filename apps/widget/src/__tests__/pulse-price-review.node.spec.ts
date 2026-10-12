import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { PulseAPI } from '../features/pulse/model/PulseAPI.js';
import { PulsePriceReviewRequired, pulsePriceReview } from '../features/pulse/model/PulsePriceReview.js';
import { CheckoutViewModel } from '../features/pulse/viewmodels/CheckoutViewModel.js';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const review = { currency: 'BRL', confirmation_fingerprint: 'a'.repeat(64), order_total_cents: 11000, service_fee_cents: 137, total_to_pay_cents: 11137,
  cart: { currency: 'BRL', total: 100, currentDiscount: 0, items: [{ sku: 'sku', name: 'Produto', price: 100, quantity: 1 }] },
  shipping: { carrierKey: 'shipping', method: 'Entrega', customerPrice: 10 } };
function fixture() {
  const calls: any[] = [];
  let nextReview: any = review;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body)); calls.push(body);
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer signed');
    if (nextReview) return Response.json({ code: 'checkout_review_required', review: nextReview }, { status: 409 });
    return Response.json({ id: 'payment', buyerFacing: { qrCodeCopyPaste: 'fixture-pix' } });
  };
  const api = new PulseAPI({ baseUrl: 'https://fixture.invalid', sessionId: 'session', sessionToken: 'signed', merchantId: 'store', allowDemoFallbacks: true });
  const vm = new CheckoutViewModel({} as any, { chat: null, cam: null, wave: null, support: null });
  vm.api = api;
  vm.agentSay = (entries, actions) => vm.setState(s => ({ log: [...s.log, ...entries], actions: actions ?? [], typing: false }));
  vm.startPixPolling = () => {};
  vm.setState({ cart: { product: { id: 'sku', title: 'Produto', subtitle: '', price: 100, tags: [] }, qty: 1, bundle: null,
    coupon: { code: 'old', amount: -5, label: 'Desconto' }, shipping: { key: 'shipping', label: 'Entrega', cost: 10, tag: '', sub: '' }, payMethod: 'pix' } });
  return { api, vm, calls, response: (value: unknown) => { nextReview = value; } };
}

test('Pulse transport never turns a price-review response into demo payment or automatic confirmation', async () => {
  const f = fixture();
  await assert.rejects(f.api.createOrder('pix'), error => error instanceof PulsePriceReviewRequired && error.review?.total_to_pay_cents === 11137);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].confirmed_cart_fingerprint, undefined);
  f.response(null);
  await f.api.createOrder('pix', undefined, 1, review.confirmation_fingerprint);
  assert.equal(f.calls[1].confirmed_cart_fingerprint, review.confirmation_fingerprint);
});

test('Pulse shows the authoritative revised total and waits for the confirm-order action', async () => {
  const f = fixture();
  await f.vm.finalize('pix');
  assert.equal(f.vm.calc(f.vm.state.cart).total, 111.37);
  assert.equal(f.vm.state.cart.coupon, null);
  assert.match(f.vm.state.actions[0].label, /Confirmar pedido de R\$ 111,37/);
  assert.equal(f.vm.state.pixIntentId, null);
  await f.vm.finalize('pix');
  assert.equal(f.calls.length, 1);
  f.response(null);
  f.vm.state.actions[0].fn();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1].confirmed_cart_fingerprint, review.confirmation_fingerprint);
  assert.equal(f.vm.state.pixIntentId, 'payment');
});

test('Pulse discards an obsolete review button after the server changes its total again', async () => {
  const f = fixture(); await f.vm.finalize('pix');
  const originalButton = f.vm.state.actions[0];
  f.response({ ...review, confirmation_fingerprint: 'b'.repeat(64), service_fee_cents: 200, total_to_pay_cents: 11200 });
  originalButton.fn(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.vm.calc(f.vm.state.cart).total, 112);
  originalButton.fn(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.calls.length, 2);
});

test('Pulse cannot confirm malformed prices and invalidates a displayed server total after cart edits', async () => {
  assert.equal(pulsePriceReview({ ...review, total_to_pay_cents: 1 }), undefined);
  const f = fixture(); await f.vm.finalize('pix');
  f.vm.setState({ cart: { ...f.vm.state.cart, qty: 2 } });
  assert.equal(f.vm.calc(f.vm.state.cart).total, 210);
  f.response({ ...review, confirmation_fingerprint: 'bad' });
  f.vm.state.actions[0].fn(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.calls.at(-1).confirmed_cart_fingerprint, undefined);
  assert.deepEqual(f.vm.state.actions, []);
});
