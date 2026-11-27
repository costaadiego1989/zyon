import {test,expect,preparePayment,choosePayment,assertPending,switchToCard,clickHosted,approveOnce,assertPaid,capture} from './product-payment-helpers';
import {switchCardToPix} from './product-payment-duplex-helpers';
test.use({paymentChannel:'storefront',paymentScenario:'duplex'});
test('C60 S5 duplex Next proves Pix to card and card to Pix through real cancellation before one approved sale',async({page,journey})=>{
  const before=await preparePayment(page,journey),initial=await choosePayment(page,journey,'pix');await assertPending(journey,before,initial);
  const card=await switchToCard(page,journey,initial);await clickHosted(page,journey,card);
  const pix=await switchCardToPix(page,journey,initial,card);expect(pix.id).not.toBe(initial.id);await assertPending(journey,before,pix);
  await capture(page,'next-duplex-pix-pending');await approveOnce(page,journey,pix);await assertPaid(page,journey,before,pix);await capture(page,'next-duplex-pix-paid');
});
