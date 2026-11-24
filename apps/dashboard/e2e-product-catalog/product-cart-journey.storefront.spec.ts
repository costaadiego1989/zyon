import {test,runCartMutations,runCrossSell} from './product-cart-journey-helpers.js';
test.describe('C60 S3 storefront cart mutations',()=>{
  test.use({cartChannel:'storefront',cartScenario:'mutations'});
  test('actual add/edit/remove gestures preserve canonical totals, empty state and recovery',async({page,journey})=>{await runCartMutations(page,journey);});
});
test.describe('C60 S3 storefront post-add cross-sell',()=>{
  test.use({cartChannel:'storefront',cartScenario:'crosssell'});
  test('each accepted addition rechecks real rules/stock and explicit next offer acceptance or refusal',async({page,journey})=>{await runCrossSell(page,journey);});
});