import {expect,type Page} from '@playwright/test';
import {choosePayment} from './product-payment-helpers';
import type {createProductPaymentJourney} from '../../api/tests/product-payment-journey.fixture.mjs';
type Journey=Awaited<ReturnType<typeof createProductPaymentJourney>>;
export async function switchCardToPix(page:Page,journey:Journey,initialPix:any,card:any){
  const before=await journey.checkout(),next=await choosePayment(page,journey,'pix'),after=await journey.checkout(),state=await journey.finance();
  expect(next.method).toBe('pix');expect(next.id).not.toBe(initialPix.id);expect(next.id).not.toBe(card.id);
  expect(state.intents).toHaveLength(3);expect(new Set(state.intents.map((row:any)=>row.id)).size).toBe(3);
  for(const previous of[initialPix,card]){
    const row=state.intents.find((value:any)=>value.id===previous.id);
    expect(row.status).toBe('cancelled');expect(row.creation.cancellation.state).toBe('cancelled');
    expect(row.creation.cancellation.providerPaymentId).toBe(previous.providerPaymentId);
    expect(row.creation.cancellation.mutationAttemptedAt).toBeTruthy();
  }
  expect(state.intents.filter((row:any)=>['pending','requires_action'].includes(row.status)).map((row:any)=>row.id)).toEqual([next.id]);
  expect(next.amountCents).toBe(card.amountCents);expect(next.amountBreakdown).toEqual(card.amountBreakdown);
  expect(after.cart.items).toEqual(before.cart.items);expect(after.shipping.quoteId).toBe(before.shipping.quoteId);
  expect(state.orders).toHaveLength(0);expect(state.movements).toHaveLength(0);expect(state.sales).toHaveLength(0);
  return next;
}
