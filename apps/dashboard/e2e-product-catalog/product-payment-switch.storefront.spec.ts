import {switchCardToPix} from './product-payment-duplex-helpers';
import {test,expect,preparePayment,choosePayment,assertPending,switchToCard,clickHosted,approveOnce,assertPaid,capture} from './product-payment-helpers';
test.use({paymentChannel:'storefront',paymentScenario:'switch'});
test('C60 S5 real Next cancels Pix, card and replacement Pix before one final card approval',async({page,journey})=>{
  const before=await preparePayment(page,journey),pix=await choosePayment(page,journey,'pix');await assertPending(journey,before,pix);
  const card=await switchToCard(page,journey,pix);expect(card.method).toBe('card');
  await clickHosted(page,journey,card);
  const replacementPix=await switchCardToPix(page,journey,pix,card);
  const finalCard=await choosePayment(page,journey,'card'),state=await journey.finance();
  expect(state.intents).toHaveLength(4);
  for(const previous of[pix,card,replacementPix])expect(state.intents.find((row:any)=>row.id===previous.id).status).toBe('cancelled');
  expect(state.intents.filter((row:any)=>['pending','requires_action'].includes(row.status)).map((row:any)=>row.id)).toEqual([finalCard.id]);
  expect(finalCard.method).toBe('card');expect(finalCard.amountCents).toBe(card.amountCents);expect(finalCard.amountBreakdown).toEqual(card.amountBreakdown);

  await capture(page,'next-final-card-pending');await approveOnce(page,journey,finalCard);await assertPaid(page,journey,before,finalCard);await capture(page,'next-card-paid');
});
