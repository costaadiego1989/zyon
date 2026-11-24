import {test,runCartMutations,runCrossSell} from './product-cart-journey-helpers.js';
test.describe('C60 S3 whatsapp cart mutations',()=>{
  test.use({cartChannel:'whatsapp',cartScenario:'mutations'});
  test('actual add/edit/remove gestures preserve canonical totals, empty state and recovery',async({page,journey})=>{await runCartMutations(page,journey);});
});
test.describe('C60 S3 whatsapp post-add cross-sell',()=>{
  test.use({cartChannel:'whatsapp',cartScenario:'crosssell'});
  test('each accepted addition rechecks real rules/stock and explicit next offer acceptance or refusal',async({page,journey})=>{await runCrossSell(page,journey);});
});