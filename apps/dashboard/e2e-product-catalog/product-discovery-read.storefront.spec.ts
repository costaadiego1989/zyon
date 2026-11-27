import {test,runCategories,runComparison,runReviews} from './product-discovery-read-helpers.js';
const scenario1Test = test.extend({discoveryChannel:'storefront',discoverySurface:'categories'});
const scenario2Test = test.extend({discoveryChannel:'storefront',discoverySurface:'comparison'});
const scenario3Test = test.extend({discoveryChannel:'storefront',discoverySurface:'reviews'});

scenario1Test.describe('C60 S2B storefront categories',()=>{
  const test = scenario1Test;
  test('actual category controls return only current own category products',async({page,journey})=>{await runCategories(page,journey);});
});
scenario2Test.describe('C60 S2B storefront comparison',()=>{
  const test = scenario2Test;
  test('known products render canonical comparison and a foreign name cannot create a product fact',async({page,journey})=>{await runComparison(page,journey);});
});
scenario3Test.describe('C60 S2B storefront public reviews',()=>{
  const test = scenario3Test;
  test('published positive and negative reviews retain scope and truthful load-more behavior',async({page,journey})=>{await runReviews(page,journey);});
});
// Private focus scheduling only. The original comparison case owns Enter/POST/result proof.
scenario2Test.describe('C60 S2B private product-close composer focus boundary',()=>{
  const test = scenario2Test;
  test('a delayed composer callback preserves the buyer-selected real welcome control',async({page,journey})=>{
    const {expect}=await import('@playwright/test');
    const {declineOptionalStorefrontConsent}=await import('../e2e/service-buyer-storefront-helpers.js');
    const modelBefore=journey.modelEvents();let messagePosts=0;
    await page.context().route('**/*',route=>new URL(route.request().url()).origin===journey.origin?route.continue():route.abort('blockedbyclient'));
    page.on('request',request=>{const url=new URL(request.url());if(url.origin===journey.origin&&url.pathname.endsWith('/messages')&&request.method()==='POST')messagePosts++;});
    await page.addInitScript(()=>{
      const originalSetTimeout=window.setTimeout.bind(window),originalClearTimeout=window.clearTimeout.bind(window);
      const held=new Map<number,()=>void>();let armed=false,nextHeld=-1;
      Reflect.set(window,'setTimeout',(handler:TimerHandler,delay?:number,...args:unknown[])=>{
        if(armed&&delay===80&&typeof handler==='function'){const id=nextHeld--;held.set(id,()=>Reflect.apply(handler,window,args));return id;}
        return originalSetTimeout(handler,delay,...args);
      });
      Reflect.set(window,'clearTimeout',(id?:number)=>{if(typeof id==='number'&&held.delete(id))return;originalClearTimeout(id);});
      Reflect.set(window,'__c60ProductCloseComposer80',{
        arm(){armed=true;},pending(){return held.size;},
        release(){armed=false;const callbacks=[...held.values()];held.clear();for(const run of callbacks)run();return callbacks.length;},
      });
    });
    // This published deep-link performs actual product reads without consuming another classifier step.
    await page.goto(journey.origin+'/store/'+journey.slug+'?show=content&product='+encodeURIComponent(journey.ids.a));
    await declineOptionalStorefrontConsent(page);
    const dialog=page.getByRole('dialog',{name:'Detalhes do produto',exact:true});await expect(dialog).toBeVisible();await expect(dialog).toContainText(journey.names.a);
    await expect(dialog.getByRole('button',{name:'Adicionar ao carrinho',exact:true}).first()).toBeEnabled();
    await page.evaluate(()=>Reflect.get(window,'__c60ProductCloseComposer80').arm());
    await dialog.getByRole('button',{name:'Fechar produto e voltar ao chat',exact:true}).click();await expect(dialog).toHaveCount(0);
    await page.waitForFunction(()=>Reflect.get(window,'__c60ProductCloseComposer80').pending()>0);
    const welcome=page.getByRole('button',{name:/^Ver Produtos$/i}).last();await expect(welcome).toBeEnabled();await welcome.focus();await expect(welcome).toBeFocused();
    const released=await page.evaluate(()=>Reflect.get(window,'__c60ProductCloseComposer80').release());expect(released).toBeGreaterThan(0);
    await expect(welcome).toBeFocused();
    expect(messagePosts).toBe(0);expect(journey.modelEvents()).toEqual(modelBefore);expect(journey.evidence().providerCalls).toBe(0);
  });
});
