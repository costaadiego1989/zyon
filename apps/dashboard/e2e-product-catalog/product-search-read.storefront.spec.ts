import {test,expect,openSearch,sendQuery,assertSearchTurn,assertReadOnly,captureSearch} from './product-search-read-helpers.js';

const scenario1Test = test.extend({searchChannel:'storefront',searchScenario:'positive'});
const scenario2Test = test.extend({searchChannel:'storefront',searchScenario:'noeligible'});

scenario1Test.describe('C60 S2A actual Next budget and public-rating search',()=>{
  const test = scenario1Test;
  test('real typed criteria and a tighter follow-up select only canonically eligible products',async({page,journey})=>{
    await openSearch(page,journey);const before=await journey.snapshot();
    const first=await sendQuery(page,journey,'Quero encontrar um fone até R$ 100 com pelo menos 4 estrelas.');
    await assertSearchTurn(page,journey,first,10000);expect((await journey.eligible(10000)).length).toBe(2);
    const second=await sendQuery(page,journey,'Quero manter o fone e pelo menos 4 estrelas, mas agora até R$ 50.');
    await assertSearchTurn(page,journey,second,5000);expect((await journey.eligible(5000)).length).toBe(1);
    journey.assertModelTrace(2);await assertReadOnly(journey,before);await captureSearch(page,'c60-s2a-next-positive');
  });
});
scenario2Test.describe('C60 S2A actual Next no eligible own product',()=>{
  const test = scenario2Test;
  test('confirmed zero eligible results never relax budget/rating or leak the foreign decoy',async({page,journey})=>{
    await openSearch(page,journey);const before=await journey.snapshot();
    const result=await sendQuery(page,journey,'Quero encontrar um fone até R$ 100 com pelo menos 4 estrelas.');
    await assertSearchTurn(page,journey,result,10000);expect(await journey.eligible(10000)).toEqual([]);
    journey.assertModelTrace(1);await assertReadOnly(journey,before);await captureSearch(page,'c60-s2a-next-noeligible');
  });
});