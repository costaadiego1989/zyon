// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import type { MetaAdsAgentApi } from "../../api/endpoints/meta-ads-agent.js";
import { ConnectionPanel } from "./ConnectionPanel.js";
import { overview } from "./fixtures.js";
import { ui } from "./test-helpers.js";
let screen: ReturnType<typeof ui>;
afterEach(async () => {await screen?.close(); window.history.replaceState({}, "", "/");});
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
