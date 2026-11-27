import {test,expect} from '@playwright/test';
import {attachServedArtifact,createServedWidgetApp,servedFrontendDigest,servedReleaseIdentity} from './service-served-artifact-observation.mjs';

test('T95 built standalone widget serves the exact artifact and safely handles an incomplete link',async({browser},testInfo)=>{
  const before={runtime:servedReleaseIdentity(),frontends:{'widget-app':servedFrontendDigest('widget-app')}};
  const host=await createServedWidgetApp(),context=await browser.newContext({viewport:{width:1440,height:1000}});
  try{
    const mutations:string[]=[];await context.route('**/*',route=>{
      const request=route.request();if(!['GET','HEAD'].includes(request.method()))mutations.push(request.method()+' '+new URL(request.url()).pathname);
      return new URL(request.url()).origin===host.origin?route.continue():route.abort('blockedbyclient');
    });
    const page=await context.newPage();await page.goto(host.origin);
    await expect(page.getByRole('alert')).toContainText(/Este link est/);
    const reload=page.waitForResponse(response=>response.request().isNavigationRequest()&&response.url()===host.origin+'/');
    await page.getByRole('button',{name:'Tentar novamente',exact:true}).click();
    const actual=await reload;await expect(page.getByRole('alert')).toContainText(/Este link est/);
    expect(mutations).toEqual([]);await attachServedArtifact(testInfo,'widget-app',actual,before,host.indexBytes);
    await page.screenshot({path:testInfo.outputPath('served-widget-app.running.png'),fullPage:false});
  }finally{await context.close();await host.close();}
});
