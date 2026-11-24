import {test,runCategories,runComparison,runReviews} from './product-discovery-read-helpers.js';
test.describe('C60 S2B whatsapp categories',()=>{
  test.use({discoveryChannel:'whatsapp',discoverySurface:'categories'});
  test('actual category controls return only current own category products',async({page,journey})=>{await runCategories(page,journey);});
});
test.describe('C60 S2B whatsapp comparison',()=>{
  test.use({discoveryChannel:'whatsapp',discoverySurface:'comparison'});
  test('known products render canonical comparison and a foreign name cannot create a product fact',async({page,journey})=>{await runComparison(page,journey);});
});
test.describe('C60 S2B whatsapp public reviews',()=>{
  test.use({discoveryChannel:'whatsapp',discoverySurface:'reviews'});
  test('published positive and negative reviews retain scope and truthful load-more behavior',async({page,journey})=>{await runReviews(page,journey);});
});