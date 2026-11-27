import {test,runIdentityAddress,runOwnDeliveryFreight} from './product-contact-delivery-helpers';
const deliveryScenario1Test = test.extend({deliveryChannel:'whatsapp',deliveryScenario:'identity'});
const deliveryScenario2Test = test.extend({deliveryChannel:'whatsapp',deliveryScenario:'freight'});

test.describe('C60 S4 whatsapp contact and delivery',()=>{
  deliveryScenario1Test.describe('identity/address',()=>{const test = deliveryScenario1Test;test('normal identity collection, saved address and authorized edit preserve the actual cart',async({page,journey})=>runIdentityAddress(page,journey));});
  deliveryScenario2Test.describe('own-delivery tariff',()=>{const test = deliveryScenario2Test;test('configured destination tariffs, explicit selection and address-driven re-quote preserve stock',async({page,journey})=>runOwnDeliveryFreight(page,journey));});
});