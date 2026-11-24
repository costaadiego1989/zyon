import {test,runIdentityAddress,runOwnDeliveryFreight} from './product-contact-delivery-helpers';
test.describe('C60 S4 whatsapp contact and delivery',()=>{
  test.use({deliveryChannel:'whatsapp'});
  test.describe('identity/address',()=>{test.use({deliveryScenario:'identity'});test('normal identity collection, saved address and authorized edit preserve the actual cart',async({page,journey})=>runIdentityAddress(page,journey));});
  test.describe('own-delivery tariff',()=>{test.use({deliveryScenario:'freight'});test('configured destination tariffs, explicit selection and address-driven re-quote preserve stock',async({page,journey})=>runOwnDeliveryFreight(page,journey));});
});