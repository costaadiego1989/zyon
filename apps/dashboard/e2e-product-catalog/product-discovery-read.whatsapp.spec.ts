import {test,runCategories,runComparison,runReviews} from './product-discovery-read-helpers.js';
const scenario1Test = test.extend({discoveryChannel:'whatsapp',discoverySurface:'categories'});
const scenario2Test = test.extend({discoveryChannel:'whatsapp',discoverySurface:'comparison'});
const scenario3Test = test.extend({discoveryChannel:'whatsapp',discoverySurface:'reviews'});

scenario1Test.describe('C60 S2B whatsapp categories',()=>{
  const test = scenario1Test;
  test('actual category controls return only current own category products',async({page,journey})=>{await runCategories(page,journey);});
});
scenario2Test.describe('C60 S2B whatsapp comparison',()=>{
  const test = scenario2Test;
  test('known products render canonical comparison and a foreign name cannot create a product fact',async({page,journey})=>{await runComparison(page,journey);});
});
scenario3Test.describe('C60 S2B whatsapp public reviews',()=>{
  const test = scenario3Test;
  test('published positive and negative reviews retain scope and truthful load-more behavior',async({page,journey})=>{await runReviews(page,journey);});
});