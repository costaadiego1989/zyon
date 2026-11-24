import {test,expect,openStorefront,clickCatalog,catalogProducts,assertReadOnly,captureCatalog,advanceToLastCard} from './product-catalog-read-helpers.js';

test.describe('C60 S1 actual Next configured-structured catalog10',()=>{
  test.use({catalogChannel:'storefront',catalogScenario:'ten'});
  test('ten canonical products render with the correct count and real keyboard navigation',async({page,journey})=>{
    const serviceCalls:string[]=[];page.on('request',request=>{if(/\/service-(booking|appointments)\//.test(new URL(request.url()).pathname))serviceCalls.push(request.url());});
    await openStorefront(page,journey);const before=await journey.snapshot();
    const body=await clickCatalog(page,journey),products=catalogProducts(body.blocks),canonical=await journey.canonicalCatalog();
    expect(products).toHaveLength(10);expect(products.map((row:any)=>row.id).sort()).toEqual(canonical.map((row:any)=>row.id).sort());
    for(const product of products){const row=canonical.find((value:any)=>value.id===product.id)!;expect(product.name).toBe(row.name);expect(product.price).toBe(row.priceInCents);}
    expect(body.message).toMatch(/10\s+(opções|produtos)/i);expect(body.message).not.toMatch(/\b3\s+(opções|produtos)/i);
    const carousel=page.getByRole('region',{name:'Produtos da loja',exact:true}).last();
    const cards=carousel.locator('[data-aacp-carousel-product]');await expect(cards).toHaveCount(10);
    expect((await cards.evaluateAll(nodes=>nodes.map(node=>(node as HTMLElement).dataset.aacpCarouselProduct))).sort()).toEqual(canonical.map((row:any)=>row.id).sort());
    for(const row of canonical){const card=carousel.locator('[data-aacp-carousel-product="'+row.id+'"]');
      await expect(card.getByRole('button',{name:'Saber mais',exact:true})).toHaveCount(1);
      await expect(card.getByRole('button',{name:'Adicionar ao carrinho',exact:true})).toBeEnabled();}
    await advanceToLastCard(page,carousel);const last=cards.last(),lastId=await last.getAttribute('data-aacp-carousel-product');
    const selected=canonical.find((row:any)=>row.id===lastId)!;expect(selected).toBeTruthy();
    const details=last.getByRole('button',{name:'Saber mais',exact:true});await details.focus();await page.keyboard.press('Enter');
    const dialog=page.getByRole('dialog',{name:'Detalhes do produto',exact:true});await expect(dialog).toBeVisible();
    await expect(dialog.getByText(selected.name,{exact:true}).first()).toBeVisible();
    await dialog.getByRole('button',{name:'Fechar produto e voltar ao chat',exact:true}).click();await expect(dialog).toHaveCount(0);
    await expect(carousel).toBeVisible();await expect(page.getByRole('region',{name:'Agendar serviço',exact:true})).toHaveCount(0);
    await assertReadOnly(journey,before);expect(serviceCalls).toEqual([]);
    expect(journey.evidence().api.localStorefrontRoutingProfile).toMatchObject({configured:'structured',observed:'structured',selectorActive:true});
    expect(journey.evidence().api.providerCalls).toBe(0);await captureCatalog(page,carousel,'c60-s1-next-ten');
  });
});

test.describe('C60 S1 actual Next empty-own catalog',()=>{
  test.use({catalogChannel:'storefront',catalogScenario:'empty'});
  test('a confirmed own empty catalog stays empty despite foreign decoys',async({page,journey})=>{
    await openStorefront(page,journey);const before=await journey.snapshot(),body=await clickCatalog(page,journey);
    expect(await journey.canonicalCatalog()).toEqual([]);expect(catalogProducts(body.blocks)).toEqual([]);
    expect(body.message).toMatch(/não encontrei produtos disponíveis/i);expect(body.message).not.toMatch(/não consegui carregar/i);
    await expect(page.locator('[data-aacp-carousel-product]')).toHaveCount(0);
    for(const name of journey.foreignNames)await expect(page.getByText(name,{exact:false})).toHaveCount(0);
    await expect(page.getByRole('region',{name:'Agendar serviço',exact:true})).toHaveCount(0);
    await expect(page.getByRole('button',{name:'Adicionar ao carrinho',exact:true})).toHaveCount(0);
    await assertReadOnly(journey,before);expect(journey.evidence().api.providerCalls).toBe(0);
    await captureCatalog(page,page.getByRole('textbox',{name:'Mensagem',exact:true}),'c60-s1-next-empty');
  });
});