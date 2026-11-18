// @vitest-environment jsdom
import {act} from 'react';
import { afterEach, expect, test, vi } from "vitest";
import type { MetaAdsAgentApi } from "../../api/endpoints/meta-ads-agent.js";
import { ConnectionPanel } from "./ConnectionPanel.js";
import { overview } from "./fixtures.js";
import { ui } from "./test-helpers.js";
let screen: ReturnType<typeof ui>;
afterEach(async () => {await screen?.close(); window.history.replaceState({}, "", "/");});
test('AUC-02 healthy authorization has no reconnect CTA while an expired connection offers recovery',async()=>{screen=ui();const api={startConnection:vi.fn()},p={connection:overview().connection,entitled:true,api:api as unknown as MetaAdsAgentApi,onUpdated:vi.fn()};await screen.render(<ConnectionPanel {...p}/>);expect(Array.from(screen.container.querySelectorAll('button')).some(b=>/Autorizar novamente|Reconectar conta|Conectar Meta/.test(b.textContent??''))).toBe(false);await screen.render(<ConnectionPanel {...p} connection={{...p.connection,status:'reconnect_required'}}/>);expect(Array.from(screen.container.querySelectorAll('button')).some(b=>b.textContent==='Reconectar conta')).toBe(true);expect(api.startConnection).not.toHaveBeenCalled();});
test('AGW-09 a beginner without an ad account can open setup guidance without starting OAuth',async()=>{
 screen=ui();const api={startConnection:vi.fn()};await screen.render(<ConnectionPanel connection={{...overview().connection,status:'disconnected',account:null}} entitled api={api as unknown as MetaAdsAgentApi} onUpdated={vi.fn()}/>);
 const help=screen.container.querySelector<HTMLDetailsElement>('[data-meta-first-steps]')!;expect(help).not.toBeNull();await act(async()=>help.querySelector('summary')!.click());expect(help.open).toBe(true);expect(help.textContent).toContain('moeda');expect(help.textContent).toContain('Conectar Meta');expect(help.querySelector('a')?.href).toBe('https://business.facebook.com/');expect(api.startConnection).not.toHaveBeenCalled();
});
test('AGW-03 setup explains Pixel and catalog in distinct containers with safe shortcuts',async()=>{
  screen=ui();await screen.render(<ConnectionPanel connection={overview().connection} entitled api={{} as MetaAdsAgentApi} onUpdated={vi.fn()}/>);
  const pixel=screen.container.querySelector('[aria-labelledby="mga-pixel-title"]')!;
  const catalog=screen.container.querySelector('[aria-labelledby="mga-catalog-title"]')!;
  expect(pixel.textContent).toContain('visitas e compras');expect(catalog.textContent).toContain('Opcional');
  expect(catalog.textContent).toContain('produtos da Zyon');
  const help=pixel.querySelector('details')!;expect(help.open).toBe(false);
  await act(async()=>{help.querySelector('summary')!.click();});expect(help.open).toBe(true);
  expect(pixel.textContent).toContain('mesmo ID');expect(pixel.textContent).toContain('Busca e rastreamento');
  const links=Array.from(screen.container.querySelectorAll<HTMLAnchorElement>('a[target="_blank"]'));
  expect(links.map(a=>a.href)).toContain('https://business.facebook.com/events_manager2/');
  expect(links.map(a=>a.href)).toContain('https://business.facebook.com/commerce/');
  expect(links.every(a=>a.rel.includes('noopener')&&a.rel.includes('noreferrer'))).toBe(true);
  expect(pixel.querySelector('a[href="#store-settings"]')).not.toBeNull();
  expect(screen.container.querySelector('[aria-labelledby="mga-page-title"]')).not.toBeNull();
  expect(screen.container.querySelector('[aria-labelledby="mga-whatsapp-title"]')).not.toBeNull();
});
test('AF-02 explains advertising authorization separately and keeps WhatsApp connected',async()=>{screen=ui();await screen.render(<ConnectionPanel connection={overview().connection} entitled api={{} as MetaAdsAgentApi} onUpdated={vi.fn()}/>);expect(screen.container.textContent).toContain('Para criar anúncios, autorize também sua conta de anúncios');expect(screen.container.textContent).toContain('Não é preciso reconectar o WhatsApp');});
test('ADAS-71 unchanged refresh preserves unsaved asset selections while a changed connection invalidates them',async()=>{
  screen=ui();const connection=overview().connection;connection.page=null;connection.whatsappNumbers=[{id:'phone',name:'Phone',pageId:'234'}];
  const props={connection,entitled:true,api:{} as MetaAdsAgentApi,onUpdated:async()=>{}};await screen.render(<ConnectionPanel {...props}/>);await screen.change('Página','234');await screen.change('WhatsApp vinculado à página','phone');
  await screen.render(<ConnectionPanel {...props} connection={{...connection}}/>);expect((screen.container.querySelector('[aria-label="Página"]') as HTMLSelectElement).value).toBe('234');expect((screen.container.querySelector('[aria-label="WhatsApp vinculado à página"]') as HTMLSelectElement).value).toBe('phone');
  await screen.render(<ConnectionPanel {...props} connection={{...connection,epoch:connection.epoch+1}}/>);expect((screen.container.querySelector('[aria-label="Página"]') as HTMLSelectElement).value).toBe('');
});
test("connection shows only authorized scoped assets and saves selected identifiers", async () => {
  screen = ui(); const connection = overview().connection;
  connection.pages.push({id: "foreign", name: "Outra conta", accountId: "777"});
  const selectConnection = vi.fn().mockResolvedValue(connection);
  await screen.render(<ConnectionPanel connection={connection} entitled api={{selectConnection} as unknown as MetaAdsAgentApi} onUpdated={vi.fn()}/>);
  expect(screen.container.textContent).not.toContain("Outra conta");
  expect(screen.container.textContent).toContain("Catálogo sem acesso");
  await screen.change("Pixel / conjunto de dados", "345"); await screen.click("Salvar ativos");
  expect(selectConnection.mock.calls[0][0]).toEqual({accountId: "123", pageId: "234", catalogId: null, datasetId: "345", whatsappId: null});
  expect(screen.container.textContent).toContain("Ativos atualizados");
});
test("MGA-74 disconnect warns spending continues and requires a confirming gesture", async () => {
  screen = ui(); const disconnect = vi.fn().mockResolvedValue(undefined);
  await screen.render(<ConnectionPanel connection={overview().connection} entitled api={{disconnect} as unknown as MetaAdsAgentApi} onUpdated={vi.fn()}/>);
  await screen.click("Desconectar Meta");
  expect(screen.container.textContent).toContain("continuar consumindo verba"); expect(disconnect).not.toHaveBeenCalled();
  await screen.click("Confirmar desconexão");
  expect(screen.container.textContent).toContain("Meta desconectada"); expect(disconnect).toHaveBeenCalledTimes(1);
});
test("OAuth callback exchanges actual code once, removes it from URL and shows connected state", async () => {
  screen = ui(); window.history.replaceState({}, "", "/?tab=meta-ads-agent&state=state1&code=code1");
  const completeConnection = vi.fn().mockResolvedValue(overview().connection);
  const props = {connection: {...overview().connection, status: "disconnected" as const}, entitled: true, api: {completeConnection} as unknown as MetaAdsAgentApi, onUpdated: vi.fn()};
  await screen.render(<ConnectionPanel {...props}/>);
  expect(completeConnection).toHaveBeenCalledWith("state1", "code1"); expect(window.location.search).not.toContain("code=");
  expect(screen.container.textContent).toContain("Conexão autorizada");
  await screen.render(<ConnectionPanel {...props}/>); expect(completeConnection).toHaveBeenCalledTimes(1);
});

test('ADAS-71 rapid asset changes preserve the page when updating the dataset',async()=>{screen=ui();const connection=overview().connection;connection.page=null;const selectConnection=vi.fn().mockResolvedValue(connection);await screen.render(<ConnectionPanel connection={connection} entitled api={{selectConnection} as unknown as MetaAdsAgentApi} onUpdated={vi.fn()}/>);await act(async()=>{for(const [label,value] of [['Página','234'],['Pixel / conjunto de dados','345']]){const select=screen.container.querySelector<HTMLSelectElement>(`[aria-label="${label}"]`)!;select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));}});await screen.click('Salvar ativos');expect(selectConnection.mock.calls[0][0]).toMatchObject({pageId:'234',datasetId:'345'});});
