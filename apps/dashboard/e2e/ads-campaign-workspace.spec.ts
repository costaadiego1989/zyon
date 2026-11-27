import {test,expect} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const captures=fileURLToPath(new URL('../../../.specs/features/ads-campaign-workspace/captures/',import.meta.url));
const asset='<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="600" height="600" fill="#141d18"/><rect x="150" y="180" width="300" height="210" rx="30" fill="#d5e4db"/><circle cx="300" cy="280" r="65" fill="#284936"/><text x="300" y="480" font-size="20" fill="#a6b7ad" text-anchor="middle">Produto de demonstração</text></svg>';
test.beforeEach(async({page})=>{await mkdir(captures,{recursive:true});await page.route(/https:\/\/(media|images)\.example\.test\//,route=>route.fulfill({contentType:'image/svg+xml',body:asset}));await page.route('https://fonts.googleapis.com/**',route=>route.fulfill({contentType:'text/css',body:''}));});
test('ACW-51 native widths and keyboard keep campaigns review settings and confirmations reachable without document overflow',async({page})=>{
 for(const width of [1440,768,390]){
  await page.setViewportSize({width,height:1000});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/?count=12');await expect(page.getByRole('heading',{name:'Campanhas da loja',exact:true})).toBeVisible();await expect(page.locator('.ads-workspace article')).toHaveCount(10);
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`${captures}/campaigns-${width}.running.png`});
  const first=page.getByRole('button',{name:'Ver campanha Fones sem fio · Mais vendas · Loja',exact:true});await first.focus();await page.keyboard.press('Enter');await expect(page.locator('.ads-detail__heading h2')).toBeFocused();await expect(page.locator('.ads-detail')).toBeInViewport();await page.getByRole('button',{name:'Voltar às campanhas',exact:true}).click();await expect(first).toBeFocused();
  await page.getByRole('button',{name:'Pausar',exact:true}).first().click();const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();await page.keyboard.press('Tab');expect(await dialog.evaluate(el=>el.contains(document.activeElement))).toBe(true);await page.keyboard.press('Escape');await expect(dialog).toBeHidden();
  await page.getByRole('button',{name:'Ver campanha Câmera Wi-Fi · Mais vendas · Loja',exact:true}).click();await expect(page.getByRole('button',{name:'Aprovar e publicar',exact:true})).toBeVisible();await expect.poll(()=>page.locator('.mga-launch img').evaluateAll(images=>images.every(image=>(image as HTMLImageElement).complete&&(image as HTMLImageElement).naturalWidth>0))).toBe(true);await page.getByRole('button',{name:'Próximo criativo',exact:true}).click();await expect(page.locator('.mga-slide-controls')).toContainText('2 de 2');if(width===1440)await page.screenshot({path:`${captures}/detail-1440.running.png`});
  await page.getByRole('tab',{name:'Configurações',exact:true}).click();await page.getByRole('button',{name:'Autonomia',exact:true}).click();const daily=page.getByRole('spinbutton',{name:'Novas propostas por dia',exact:true});await expect(daily).toHaveValue('1');await daily.focus();await page.keyboard.press('ArrowUp');await expect(daily).toHaveValue('2');await page.keyboard.press('Enter');await expect(page.getByText('Limites salvos.',{exact:true})).toBeVisible();if(width===390)await page.screenshot({path:`${captures}/settings-390.running.png`});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
 }
});
test('ACW-52 twelve and eighty campaigns show at least three complete comparable rows at 1440 by 1000',async({page})=>{
 await page.setViewportSize({width:1440,height:1000});for(const count of [12,80]){await page.goto('/?count='+count);await expect(page.locator('.ads-workspace article')).toHaveCount(10);const visible=await page.locator('.ads-workspace article').evaluateAll(elements=>elements.filter(el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&r.top>=0&&r.bottom<=innerHeight&&getComputedStyle(el).visibility!=='hidden';}).map(el=>({name:el.querySelector('h3')?.textContent,results:el.querySelectorAll('dd').length,text:el.textContent})));expect(visible.length).toBeGreaterThanOrEqual(3);for(const row of visible.slice(0,3)){expect(row.name).toBeTruthy();expect(row.results).toBe(3);expect(row.text).toContain('R$');expect(row.text).toContain('Brasil');}await page.screenshot({path:`${captures}/density-${count}.running.png`});}
});

test('ACW-42 follows campaign sales to an older paid order and returns to its exact campaign without opening foreign-store links',async({page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000});await page.goto('/?count=12');
  await page.getByRole('button',{name:'Ver campanha Fones sem fio · Mais vendas · Loja',exact:true}).click();
  await page.getByRole('button',{name:'Ver pedidos',exact:true}).click();
  const orders=page.locator('.ads-sales__orders');await expect(orders.locator('tbody tr')).toHaveCount(3);await expect(orders).toContainText('R$ 20,00');
  await orders.locator('a[href*="adOrder=native-paid-order"]').click();
  await expect(page.getByRole('dialog')).toBeVisible();const origin=page.locator('[aria-label="Origem da venda"]');
  await expect(origin).toContainText('Fones sem fio · Mais vendas · Loja');await expect(origin).toContainText('Loja');await expect(origin).toContainText('20/11/2026');await expect(origin).toContainText('21/11/2026');await expect(origin).toContainText('Último anúncio clicado nos 7 dias antes do pagamento');await expect(origin).toContainText('Compra recebida pela Meta');
  await origin.getByRole('link',{name:'Ver campanha',exact:true}).click();await expect(page.locator('.ads-detail__heading h2')).toHaveText('Fones sem fio · Mais vendas · Loja');await expect(page.locator('.ads-detail__heading h2')).toBeFocused();
  await page.goto('/?tab=meta-ads-agent&adStore=other-store&adCampaign=native-0#meta-ads-agent');await expect(page.getByRole('heading',{name:'Campanhas da loja',exact:true})).toBeVisible();await expect(page.locator('.ads-detail')).toHaveCount(0);
  await page.goto('/?tab=shipments&adStore=other-store&adOrder=native-paid-order#shipments');await expect(page.getByRole('heading',{name:'Pedidos e envios',exact:true})).toBeVisible();await expect(page.getByRole('dialog')).toHaveCount(0);
 }
 expect(errors).toEqual([]);
});
