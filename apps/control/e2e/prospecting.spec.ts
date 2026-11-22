import {expect,test,type Page} from "@playwright/test";
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";

const labels={companies:"Buscar empresas",leads:"Leads",campaigns:"Campanhas",conversations:"Conversas",overview:"Visão geral",privacy:"Privacidade",channel:"Canal",knowledge:"Conhecimento"};
async function area(page:Page,key:keyof typeof labels){
  const nav=page.getByRole("combobox",{name:"Área da prospecção"});
  if(await nav.isVisible())await nav.selectOption(key);
  else await page.getByRole("navigation",{name:"Áreas da prospecção"}).getByRole("link",{name:labels[key],exact:true}).click();
}
function provider(action:string){
  return JSON.parse(execFileSync(process.execPath,["--loader","./apps/api/tests/platform-support-loader.mjs","./apps/api/tests/prospecting-acceptance-provider.ts",action],
    {cwd:fileURLToPath(new URL("../../../",import.meta.url)),windowsHide:true,encoding:"utf8",stdio:["ignore","pipe","pipe"]}));
}
async function campaign(page:Page){
  await area(page,"companies");
  await page.getByRole("checkbox",{name:"Selecionar 12ABC34501DE35"}).check();
  const added=page.waitForResponse(r=>r.request().method()==="POST"&&r.url().includes("/prospects"));
  await page.getByRole("button",{name:"Adicionar ao CRM"}).click();
  expect((await added).ok()).toBe(true);
  await page.getByLabel("Nome do segmento").fill("Piloto local controlado");
  let complete=false;
  await page.route("**/platform/prospecting/segments",async r=>{
    if(r.request().method()!=="POST")return r.continue();
    expect((await r.fetch()).ok()).toBe(true);complete=true;await r.abort();
  });
  await page.route("**/platform/prospecting/commands/*",r=>r.abort());
  await page.getByRole("button",{name:"Salvar segmento"}).click();
  const recover=page.getByRole("button",{name:"Consultar resultado do comando"});
  await expect(recover).toBeVisible();expect(complete).toBe(true);
  await page.unroute("**/platform/prospecting/commands/*");await recover.click();
  await expect(page.getByText("Comando confirmado pelo servidor.")).toBeVisible();
  await page.unroute("**/platform/prospecting/segments");
  await area(page,"campaigns");
  await page.getByRole("button",{name:"Preparar campanha"}).click();
  await page.getByLabel("Nome da campanha").fill("Piloto da jornada local");
  await page.getByLabel("Plano",{exact:true}).selectOption("growth");
  await page.getByLabel("Template aprovado").selectOption({index:1});
  await page.getByLabel("Destinatários por dia").fill("3");
  await page.getByLabel("Orçamento (R$)").fill("30");
  await page.getByLabel("Início da janela").fill("00:00");
  await page.getByLabel("Fim da janela").fill("23:59");
  for(const day of await page.getByRole("group",{name:"Dias de envio"}).getByRole("checkbox").all())await day.check();
  await page.getByRole("button",{name:"Salvar rascunho"}).click();
  await page.getByLabel("Segmento",{exact:true}).selectOption({label:"Piloto local controlado · v1"});
  await page.getByRole("button",{name:"Congelar público"}).click();
  await page.getByRole("button",{name:"Aprovar revisão"}).click();
  const started=page.waitForResponse(r=>r.url().endsWith("/start")&&r.request().method()==="POST");
  await page.getByRole("button",{name:"Iniciar campanha"}).click();expect((await (await started).json()).state).toBe("running");
  await page.getByRole("button",{name:"Ver destinatários"}).click();
  const pause=page.getByRole("button",{name:"Pausar campanha"});
  await pause.click();
  await page.getByRole("button",{name:"Retomar campanha"}).click();
  await expect(pause).toBeVisible();
  await page.reload();await expect(pause).toBeVisible();
  await expect.poll(()=>provider("campaign"),{timeout:45000}).toEqual({segments:1,submitted:1,physical:1});
}
async function chatAndBilling(page:Page){
  await area(page,"conversations");
  await page.getByLabel("Buscar resposta ou CNPJ").fill("00000000000191");await page.getByRole("button",{name:"Aplicar filtros"}).click();
  await page.getByRole("button",{name:"Abrir conversa"}).first().click();
  const history=page.locator('[aria-label="Histórico de mensagens"]');
  await expect(history.getByText("Quero o link para contratar o Growth.")).toBeVisible();
  await page.getByRole("button",{name:"Assumir atendimento"}).click();
  const message="Mensagem manual da equipe local";
  await page.getByLabel("Mensagem ao contato").fill(message);
  await page.getByRole("button",{name:"Enviar mensagem"}).click();
  await expect(history.getByText(message)).toBeVisible();
  await expect.poll(()=>provider("manual"),{timeout:30000}).toEqual({physical:1});
  await page.getByLabel("Nota interna").fill("Registro interno da jornada");
  await page.getByRole("button",{name:"Salvar nota"}).click();
  await page.getByRole("button",{name:"Devolver para a IA"}).click();
  await expect(page.getByRole("button",{name:"Assumir atendimento"})).toBeVisible();

  expect(provider("incoming")).toEqual({invalid:401,accepted:200,replay:200});
  await expect(history.getByText("Como funciona o site do Growth?",{exact:true})).toBeVisible({timeout:30000});
  const siteLink=history.getByRole("link",{name:"Abrir site da Zyon"});
  await expect(siteLink).toHaveAttribute("href","https://127.0.0.1:5181/",{timeout:30000});
  expect(provider("site")).toEqual({ai:1,physical:1});
  const opened=page.waitForEvent("popup");await siteLink.click();const site=await opened;
  await expect(site.getByRole("heading",{level:1})).toContainText("Zyon");await site.close();
  const link=history.getByRole("link",{name:"Abrir proposta de cadastro"}).first();
  const target=page.waitForEvent("popup");await link.click();const dashboard=await target;
  await dashboard.getByRole("button",{name:/^entrar/i}).first().click();
  await dashboard.locator('input[type="email"]').fill("comprador@prospecting.test");
  await dashboard.locator('input[type="password"]').fill("Local-Comprador-2026!");
  await dashboard.getByRole("button",{name:/^entrar/i}).last().click();
  await expect(dashboard.getByRole("heading",{name:"Vincular proposta à conta"})).toBeVisible();
  await dashboard.getByRole("button",{name:"Vincular proposta",exact:true}).click();
  await expect(dashboard.getByText("Growth",{exact:true}).first()).toBeVisible();
  expect(provider("financial")).toEqual({before:0,invalid:401,accepted:200,replay:200,paid:1});
  await dashboard.close();
  await area(page,"leads");await page.getByRole("button",{name:"00000000000191",exact:true}).click();
  await expect(page.getByRole("dialog").getByText("Pagamento confirmado",{exact:true})).toBeVisible();
  await page.keyboard.press("Escape");await area(page,"overview");
  await page.getByRole("button",{name:/assinaturas pagas|pagamentos confirmados/i}).click();
  await expect(page).toHaveURL(/prospecting\/overview\//);
}
async function rightsAndKnowledge(page:Page){
  await area(page,"channel");await page.getByRole("button",{name:"Conectar número Zyon"}).click();
  await page.getByRole("button",{name:"Abrir autorização"}).click();
  await page.getByLabel("Conta de mensagens autorizada").selectOption("100005");
  const connected=page.waitForResponse(r=>r.url().endsWith("/sender/meta/connect"));
  await page.getByRole("button",{name:"Confirmar vínculo"}).click();expect((await connected).ok()).toBe(true);
  await area(page,"knowledge");await page.getByRole("button",{name:"Nova fonte"}).click();
  await page.getByLabel("Título da fonte").fill("Guia da demonstração");
  await page.getByLabel("Referência de origem").fill("Guia local revisado");
  await page.getByLabel("Tipo",{exact:true}).selectOption("feature");
  await page.getByLabel("Assunto",{exact:true}).fill("Painel local");
  await page.getByLabel("Conteúdo da informação").fill("O painel local reúne as conversas revisadas.");
  await page.getByRole("button",{name:"Salvar rascunho"}).click();
  await page.getByRole("button",{name:"Publicar versão"}).click();
  await expect(page.getByRole("button",{name:"Retirar publicação"})).toBeVisible();
  await page.getByLabel("Operação").selectOption("explain_feature");
  const query=page.getByRole("heading",{name:"Testar cobertura da base"}).locator("..");
  await query.getByRole("textbox").fill("Painel local");await query.getByRole("button",{name:"Testar pergunta"}).click();
  await expect(query.getByText("O painel local reúne as conversas revisadas.",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Retirar publicação"}).click();
  await expect(page.getByRole("button",{name:"Retirar publicação"})).toHaveCount(0);
  await page.getByLabel("Operação").selectOption("explain_feature");await query.getByRole("textbox").fill("Painel local");
  await query.getByRole("button",{name:"Testar pergunta"}).click();await expect(query.getByText("Encaminhar ao atendimento humano")).toBeVisible();
  await area(page,"leads");const lead=page.getByRole("button",{name:"11222333000181",exact:true});await lead.click();
  const popup=page.waitForEvent("popup");await page.evaluate(()=>window.open(location.href));const other=await popup;
  await other.getByRole("dialog").getByLabel("Etiquetas separadas por vírgula").fill("Versão concorrente");
  await other.getByRole("button",{name:"Salvar lead"}).click();await expect(other.getByText("Lead atualizado.")).toBeVisible();await other.close();
  await page.getByRole("dialog").getByLabel("Etiquetas separadas por vírgula").fill("Revisão anterior");
  const stale=page.waitForResponse(r=>r.request().method()==="PATCH"&&r.url().includes("/prospects/"));
  await page.getByRole("button",{name:"Salvar lead"}).click();expect((await stale).status()).toBe(409);
  await page.keyboard.press("Escape");await area(page,"privacy");
  await page.getByLabel("CNPJ do lead").fill("11222333000181");await page.getByRole("button",{name:"Localizar lead"}).click();
  await page.getByRole("button",{name:"Bloquear 11222333000181"}).click();
  await page.getByLabel("Motivo do bloqueio").fill("Revogação sintética do contato");await page.getByRole("button",{name:"Confirmar bloqueio"}).click();
  await expect(page.getByText(/Contato bloqueado\. /)).toBeVisible();
}
test("PROS-31 AC3 percorre a entrada autenticada do Control e persiste a jornada local",async({page},info)=>{
  test.setTimeout(180000);
  const local=new Set(["http://127.0.0.1:3019","http://127.0.0.1:5179","https://127.0.0.1:5180","https://127.0.0.1:5181"]);
  await page.context().route("**/*",r=>local.has(new URL(r.request().url()).origin)?r.continue():r.abort());
  await page.goto("/");await page.locator('input[type="email"]').fill("operador@prospecting.test");await page.locator('input[type="password"]').fill("Local-Operador-2026!");
  await page.getByRole("button",{name:/entrar/i}).click();
  const width=page.viewportSize()!.width;if(width<800)await page.getByRole("button",{name:"Abrir navegação"}).click();
  await page.getByRole("button",{name:"Prospecção",exact:true}).click();
  await expect(page.getByRole("region",{name:"Prospecção de empresas"})).toBeVisible();
  if(width===1440)await campaign(page);
  else if(width===390)await chatAndBilling(page);
  else await rightsAndKnowledge(page);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await page.screenshot({path:info.outputPath("jornada-control.png")});
});

