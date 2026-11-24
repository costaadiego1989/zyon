import {test,expect,preparePayment,choosePayment,assertPending,approveOnce,assertPaid,capture,verifyNative} from './product-payment-helpers';
test.use({paymentChannel:'whatsapp',paymentScenario:'pix'});
test('C60 S5 signed WA Pix text, pending check and canonical approved order/stock effects',async({page,journey})=>{
  const before=await preparePayment(page,journey);const intent=await choosePayment(page,journey,'pix');
  await assertPending(journey,before,intent);await verifyNative(page);
  await expect(page.getByRole('log',{name:'Mensagens capturadas',exact:true})).toContainText(intent.buyerFacing.qrCodeCopyPaste);
  expect(intent.buyerFacing.qrCodeCopyPaste).toMatch(/^CAPTURED_PIX_NOT_PAYABLE:/);
  await expect(page.getByRole('img',{name:'QR Code Pix',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Copiar código',exact:true})).toHaveCount(0);
  await capture(page,'wa-pix-pending');await approveOnce(page,journey,intent);await assertPaid(page,journey,before,intent);await capture(page,'wa-pix-paid');
});
