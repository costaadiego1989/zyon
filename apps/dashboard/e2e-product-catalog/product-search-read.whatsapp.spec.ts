import {test,expect,openSearch,sendQuery,assertSearchTurn,assertReadOnly,captureSearch} from './product-search-read-helpers.js';

const scenario1Test = test.extend({searchChannel:'whatsapp',searchScenario:'positive'});
const scenario2Test = test.extend({searchChannel:'whatsapp',searchScenario:'noeligible'});

scenario1Test.describe('C60 S2A signed local WhatsApp budget and public-rating search',()=>{
  const test = scenario1Test;
  test('real signed text and tighter follow-up retain original canonical price/rating requirements',async({page,journey})=>{
    await openSearch(page,journey);const before=await journey.snapshot();
    const first=await sendQuery(page,journey,'Quero encontrar um fone até R$ 100 com pelo menos 4 estrelas.');
    await assertSearchTurn(page,journey,first,10000);expect((await journey.eligible(10000)).length).toBe(2);
    const second=await sendQuery(page,journey,'Quero manter o fone e pelo menos 4 estrelas, mas agora até R$ 50.');
    await assertSearchTurn(page,journey,second,5000);expect((await journey.eligible(5000)).length).toBe(1);
    journey.assertModelTrace(2);await assertReadOnly(journey,before);await captureSearch(page,'c60-s2a-signed-wa-positive');
  });
});
scenario2Test.describe('C60 S2A signed local WhatsApp no eligible own product',()=>{
  const test = scenario2Test;
  test('genuine processed input returns confirmed no-match without foreign or ineligible product controls',async({page,journey})=>{
    await openSearch(page,journey);const before=await journey.snapshot();
    const result=await sendQuery(page,journey,'Quero encontrar um fone até R$ 100 com pelo menos 4 estrelas.');
    await assertSearchTurn(page,journey,result,10000);expect(await journey.eligible(10000)).toEqual([]);
    journey.assertModelTrace(1);await assertReadOnly(journey,before);await captureSearch(page,'c60-s2a-signed-wa-noeligible');
  });
});