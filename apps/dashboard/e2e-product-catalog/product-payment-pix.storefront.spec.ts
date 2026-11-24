import {test,expect,preparePayment,choosePayment,assertPending,approveOnce,assertPaid,capture} from './product-payment-helpers';
test.use({paymentChannel:'storefront',paymentScenario:'pix'});
test('C60 S5 real Next Pix, clipboard, pending and original approved order/stock effects',async({page,journey})=>{
  const before=await preparePayment(page,journey);const intent=await choosePayment(page,journey,'pix');
  await assertPending(journey,before,intent);
  await expect(page.getByRole('img',{name:'QR Code Pix',exact:true}).last()).toHaveAttribute('src',/^data:image\/png;base64,/);
  await expect.poll(()=>page.getByRole('img',{name:'QR Code Pix',exact:true}).last().evaluate((image:HTMLImageElement)=>image.naturalWidth)).toBeGreaterThan(0);
  await page.context().grantPermissions(['clipboard-read','clipboard-write'],{origin:journey.origin});
  await page.getByRole('button',{name:'Copiar código',exact:true}).last().click();
  await expect(page.getByRole('button',{name:'Código copiado',exact:true}).last()).toBeVisible();
  expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe(intent.buyerFacing.qrCodeCopyPaste);
  expect(intent.buyerFacing.qrCodeCopyPaste).toMatch(/^CAPTURED_PIX_NOT_PAYABLE:/);
  await capture(page,'next-pix-pending');await approveOnce(page,journey,intent);await assertPaid(page,journey,before,intent);await capture(page,'next-pix-paid');
});
