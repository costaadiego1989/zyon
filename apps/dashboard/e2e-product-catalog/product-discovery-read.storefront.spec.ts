import {test,runCategories,runComparison,runReviews} from './product-discovery-read-helpers.js';
test.describe('C60 S2B storefront categories',()=>{
  test.use({discoveryChannel:'storefront',discoverySurface:'categories'});
  test('actual category controls return only current own category products',async({page,journey})=>{await runCategories(page,journey);});
});
test.describe('C60 S2B storefront comparison',()=>{
  test.use({discoveryChannel:'storefront',discoverySurface:'comparison'});
  test('known products render canonical comparison and a foreign name cannot create a product fact',async({page,journey})=>{await runComparison(page,journey);});
});
test.describe('C60 S2B storefront public reviews',()=>{
  test.use({discoveryChannel:'storefront',discoverySurface:'reviews'});
  test('published positive and negative reviews retain scope and truthful load-more behavior',async({page,journey})=>{await runReviews(page,journey);});
});