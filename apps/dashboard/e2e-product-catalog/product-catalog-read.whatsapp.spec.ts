import {test,expect,openWhatsApp,sendWhatsApp,chooseWhatsApp,catalogProducts,assertReadOnly,captureCatalog} from './product-catalog-read-helpers.js';

test.describe('C60 S1 signed captured-native WhatsApp catalog10',()=>{
  test.use({catalogChannel:'whatsapp',catalogScenario:'ten'});
  test('ten canonical product cards and their original navigation controls remain available',async({page,journey})=>{
    await openWhatsApp(page,journey);const before=await journey.snapshot();await sendWhatsApp(page,'/produtos');
    const view=await journey.currentMetaView(),canonical=await journey.canonicalCatalog(),products=catalogProducts(view.blocks);
    expect(view.blocks.some((block:any)=>block.type==='service_booking')).toBe(false);
    expect(products).toHaveLength(10);expect(products.map((row:any)=>row.id).sort()).toEqual(canonical.map((row:any)=>row.id).sort());
    for(const product of products){const row=canonical.find((value:any)=>value.id===product.id)!;expect(product.name).toBe(row.name);expect(product.price).toBe(row.priceInCents);}
    const log=page.getByRole('log',{name:'Mensagens capturadas',exact:true});
    for(const row of canonical){const card=log.locator('article').filter({hasText:row.name}).filter({has:page.getByRole('button',{name:'Ver detalhes',exact:true})});
      await expect(card).toHaveCount(1);await expect(card.getByRole('button',{name:/Adicionar/})).toBeEnabled();}
    const navigation=log.locator('article').filter({hasText:'Produtos 1 a 10 de 10 nesta lista.'});await expect(navigation).toHaveCount(1);
    expect(await navigation.getByRole('button').allTextContents()).toEqual(['Menu principal']);
    const selected=products[products.length-1];const card=log.locator('article').filter({hasText:selected.name}).filter({has:page.getByRole('button',{name:'Ver detalhes',exact:true})});
    await chooseWhatsApp(page,card.getByRole('button',{name:'Ver detalhes',exact:true}));
    const detail=await journey.currentMetaView();expect(detail.blocks.some((block:any)=>block.type==='product_card'&&block.data.id===selected.id)).toBe(true);
    await chooseWhatsApp(page,log.getByRole('button',{name:'Menu principal',exact:true}).last());
    await expect(log.getByRole('button',{name:/Ver produtos/i}).last()).toBeVisible();
    await assertReadOnly(journey,before);expect(journey.evidence().api.providerCalls).toBe(0);
    expect(journey.evidence().api.localStorefrontRoutingProfile).toMatchObject({configured:'structured',observed:'structured',selectorActive:true});
    expect(journey.evidence().api.authOverrides).toBe(false);expect(journey.evidence().api.repositoryOverrides).toBe(false);
    await captureCatalog(page,log,'c60-s1-signed-whatsapp-ten');
  });
});

test.describe('C60 S1 signed captured-native WhatsApp empty-own catalog',()=>{
  test.use({catalogChannel:'whatsapp',catalogScenario:'empty'});
  test('a confirmed empty read does not leak foreign products or fabricate a product menu',async({page,journey})=>{
    await openWhatsApp(page,journey);const before=await journey.snapshot();await sendWhatsApp(page,'/produtos');
    const view=await journey.currentMetaView();expect(await journey.canonicalCatalog()).toEqual([]);expect(catalogProducts(view.blocks)).toEqual([]);expect(view.blocks.some((block:any)=>block.type==='service_booking')).toBe(false);
    expect(view.body).toMatch(/não encontrei produtos/i);expect(view.body).not.toMatch(/não consegui carregar/i);
    const log=page.getByRole('log',{name:'Mensagens capturadas',exact:true});
    for(const name of journey.foreignNames)await expect(log).not.toContainText(name);
    await expect(log.getByRole('button',{name:'Ver detalhes',exact:true})).toHaveCount(0);
    await expect(log.getByRole('button',{name:/Adicionar(?: ao carrinho)?$/i})).toHaveCount(0);
    await assertReadOnly(journey,before);expect(journey.evidence().api.providerCalls).toBe(0);
    await captureCatalog(page,log,'c60-s1-signed-whatsapp-empty');
  });
});