import {test,runCartMutations,runCrossSell} from './product-cart-journey-helpers.js';
const scenario1Test = test.extend({cartChannel:'whatsapp',cartScenario:'mutations'});
const scenario2Test = test.extend({cartChannel:'whatsapp',cartScenario:'crosssell'});

scenario1Test.describe('C60 S3 whatsapp cart mutations',()=>{
  const test = scenario1Test;
  test('actual add/edit/remove gestures preserve canonical totals, empty state and recovery',async({page,journey})=>{await runCartMutations(page,journey);});
});
scenario2Test.describe('C60 S3 whatsapp post-add cross-sell',()=>{
  const test = scenario2Test;
  test('each accepted addition rechecks real rules/stock and explicit next offer acceptance or refusal',async({page,journey})=>{await runCrossSell(page,journey);});
});