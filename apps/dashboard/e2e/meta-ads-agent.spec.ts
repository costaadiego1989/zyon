import {test, expect, type Page} from "@playwright/test";
const backend = "http://127.0.0.1:3018";
async function facts(page: Page) {const r = await page.request.get(backend + "/__test/facts"); expect(r.ok()).toBeTruthy(); return r.json();}
async function overview(page: Page) {const r = await page.request.get(backend + "/v1/meta-ads-agent"); expect(r.ok()).toBeTruthy(); return r.json();}
async function approveAndExecute(page: Page, kind: string) {
  const review = page.locator(".mga-proposal").filter({has: page.getByRole("heading", {name: kind, exact: true})}).last();
  await expect(review).toBeVisible(); await review.getByRole("checkbox").check();
  await review.getByRole("button", {name: kind === "Publicar" ? "Aprovar publicação" : "Aprovar alteração", exact: true}).click();
  await review.getByRole("button", {name: "Executar alteração aprovada", exact: true}).click();
  return review;
}
test("MGA-56 real storefront consent survives hydration, verifies paid purchase and revokes before reload", async ({page}) => {
  const setup=await page.request.post(backend+"/__test/buyer-setup"); expect(setup.ok()).toBeTruthy(); const {trackingToken}=await setup.json();
  await page.addInitScript(()=>{const w=window as Window & {__pixels:unknown[][];fbq:(...args:unknown[])=>void};w.__pixels=[];w.fbq=(...args)=>w.__pixels.push(args);});
  await page.goto(`/buyer.html?zyon_ad=${encodeURIComponent(trackingToken)}&fbclid=real-controlled-click`);
  await expect(page.getByRole("dialog")).toBeVisible(); expect((await facts(page)).buyerSignals).toBe(0); expect((await facts(page)).buyerCaptured).toBe(false);
  await page.getByRole("checkbox",{name:/Cookies de medição e publicidade/}).check();await page.getByRole("button",{name:"Aceitar seleção",exact:true}).click();await expect.poll(async()=>(await facts(page)).buyerCaptured).toBe(true);
  await page.reload();await expect(page.getByRole("button",{name:"Confirmar pagamento do teste",exact:true})).toBeVisible();await expect(page.getByRole("dialog")).not.toBeVisible();expect((await facts(page)).buyerRevoked).toBe(false);
  await page.getByRole("button",{name:"Confirmar pagamento do teste",exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>(window as Window & {__pixels:unknown[][]}).__pixels.filter(p=>p[2]==="Purchase").length)).toBe(1);const signal=(await facts(page));expect(signal.buyerSignals).toBe(1);
  const pixel=await page.evaluate(()=>(window as Window & {__pixels:unknown[][]}).__pixels.find(p=>p[2]==="Purchase"));expect(pixel?.slice(0,4)).toEqual(["trackSingle","1234567890123","Purchase",{value:99,currency:"BRL"}]);expect(pixel?.[4]).toEqual({eventID:signal.buyerEventId});
  await page.getByRole("button",{name:"Confirmar pagamento do teste",exact:true}).click();expect((await facts(page)).buyerSignals).toBe(1);
  await page.getByRole("button",{name:"Cookies e contato",exact:true}).click();await page.getByRole("checkbox",{name:/Cookies de medição e publicidade/}).uncheck();await Promise.all([page.waitForEvent("load"),page.getByRole("button",{name:"Aceitar seleção",exact:true}).click()]);
  await expect.poll(async()=>(await facts(page)).buyerRevoked).toBe(true);await page.getByRole("button",{name:"Confirmar pagamento do teste",exact:true}).click();expect((await facts(page)).buyerSignals).toBe(1);expect(await page.evaluate(()=>(window as Window & {__pixels:unknown[][]}).__pixels.filter(p=>p[2]==="Purchase").length)).toBe(0);
});
for (const viewport of [{width:1440,height:900}, {width:390,height:844}, {width:320,height:800}]) {
  test(`MGA-77 full merchant approval journey at ${viewport.width}px`, async ({page, context}, testInfo) => {
    await page.request.post(backend + "/__test/reset"); await context.addCookies([{name:"aacp_access_token", value:"owner-a", domain:"127.0.0.1", path:"/", httpOnly:true}]); await page.setViewportSize(viewport);
    await page.route("https://www.facebook.com/**", async route => {const state = new URL(route.request().url()).searchParams.get("state")!; await route.fulfill({status:302, headers:{location:`http://127.0.0.1:5178/?tab=meta-ads-agent&state=${encodeURIComponent(state)}&code=controlled-code`}});});
    await page.route("https://media.example.test/**", route => route.fulfill({contentType:"image/svg+xml", body:'<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#e9ece9"/><text x="60" y="230" font-size="30">Bolsa Aurora</text><text x="60" y="280" font-size="24">R$ 99,00</text></svg>'}));
    await page.goto("/"); await page.getByRole("button", {name:"Conectar Meta", exact:true}).click();
    await expect(page.getByText("Conexão autorizada.", {exact:false})).toBeVisible(); expect(new URL(page.url()).searchParams.has("code")).toBe(false);
    await page.getByLabel("Conta de anúncios", {exact:true}).selectOption("100"); await page.getByRole("button", {name:"Carregar ativos da conta", exact:true}).click();
    await page.getByLabel("Página", {exact:true}).selectOption("110"); await page.getByLabel("Pixel / conjunto de dados", {exact:true}).selectOption("120"); await page.getByLabel("WhatsApp vinculado à página", {exact:true}).selectOption("5511999999999"); await page.getByRole("button", {name:"Salvar ativos", exact:true}).click();
    await page.getByRole('tab',{name:'Campanhas',exact:true}).click();
    await page.getByRole("button", {name:"Preparar primeira campanha", exact:true}).click(); await page.getByLabel("Nome da campanha", {exact:true}).fill("Coleção Aurora"); await page.getByRole("checkbox", {name:/Bolsa Aurora/}).check();
    await page.getByLabel("Destino", {exact:true}).selectOption(viewport.width === 320 ? "whatsapp" : "store"); await page.getByLabel("Prioridade", {exact:true}).selectOption("roas"); await expect(page.getByText(/Requer gasto de mídia e receita atribuída/)).toBeVisible();
    await page.getByLabel("Valor em reais", {exact:true}).fill("20"); await page.getByLabel("Título do anúncio", {exact:true}).fill("Bolsa Aurora"); await page.getByLabel("Texto do anúncio", {exact:true}).fill("Conheça a Bolsa Aurora por R$ 99,00"); await page.getByRole("button", {name:"Salvar rascunho", exact:true}).click();
    await expect(page.getByRole("button", {name:"Abrir campanha Coleção Aurora", exact:true})).toBeVisible();
    await page.getByLabel("Quantidade de imagens", {exact:true}).fill("5"); await page.getByRole("button", {name:"Gerar criativos", exact:true}).click(); expect((await facts(page)).images).toBe(0); await expect(page.getByText(/Esta solicitação reserva 5 créditos/)).toBeVisible(); await page.getByRole("button", {name:"Confirmar geração de 5 imagens", exact:true}).click();
    const images = page.getByRole("checkbox", {name:/Usar imagem/}); await expect(images).toHaveCount(5); for (const image of await images.all()) await image.check(); await page.getByRole("button", {name:"Salvar rascunho", exact:true}).click();
    expect((await overview(page)).wallet.monthlyAvailable).toBe(25); expect((await facts(page)).images).toBe(5); expect((await facts(page)).writes).toEqual([]);
    await page.getByLabel("Motivo da alteração", {exact:true}).fill("Preparar estrutura revisada"); await page.getByRole("button", {name:"Criar proposta", exact:true}).click();
    const prepare = await approveAndExecute(page, "Preparar na Meta"); await expect(prepare.getByText("Preparada, sem veiculação", {exact:true})).toBeVisible(); expect((await facts(page)).writes).toEqual(["prepare"]);
    await page.getByLabel("Alteração", {exact:true}).selectOption("publish"); await page.getByLabel("Motivo da alteração", {exact:true}).fill("Publicar orçamento revisado"); await page.getByRole("button", {name:"Criar proposta", exact:true}).click();
    const publication = page.locator(".mga-proposal").filter({has:page.getByRole("heading",{name:"Publicar",exact:true})}); await expect(publication.locator(".mga-comparison > section").nth(1).getByText(/20,00/)).toBeVisible(); expect((await facts(page)).writes).toEqual(["prepare"]);
    const publish = await approveAndExecute(page, "Publicar"); await expect(publish.getByText("Publicação em processamento", {exact:true})).toBeVisible(); await publish.getByRole("button",{name:"Consultar estado na Meta",exact:true}).click(); await expect(publish.getByText("Ativa, veiculação ainda não confirmada", {exact:true})).toBeVisible(); await publish.getByRole("button",{name:"Consultar estado na Meta",exact:true}).click(); await expect(publish.getByText("Veiculação confirmada",{exact:true})).toBeVisible();
    await page.getByLabel("Alteração", {exact:true}).selectOption("budget"); await page.getByLabel("Novo orçamento em reais", {exact:true}).fill("15"); await page.getByLabel("Motivo da alteração", {exact:true}).fill("Reduzir verba com aprovação"); await page.getByRole("button", {name:"Criar proposta", exact:true}).click(); const budget = await approveAndExecute(page, "Alterar orçamento"); await expect(budget.getByText("15,00",{exact:false})).toBeVisible(); await expect(budget.getByText("Ativa, veiculação ainda não confirmada",{exact:true})).toBeVisible(); await expect.poll(async () => (await overview(page)).campaigns[0].draft.budget.amountCents).toBe(1500);
    await page.getByLabel("Alteração", {exact:true}).selectOption("pause"); await page.getByLabel("Motivo da alteração", {exact:true}).fill("Pausar com aprovação"); await page.getByRole("button", {name:"Criar proposta", exact:true}).click(); const pause = await approveAndExecute(page,"Pausar"); await expect(pause.getByText("Pausada na Meta",{exact:true})).toBeVisible();
    const final = await overview(page); expect(final.executions).toHaveLength(4); expect(final.proposals.every((p: {approvedBy:string}) => p.approvedBy === "owner-a")).toBe(true); expect((await facts(page)).writes).toEqual(["prepare","publish","budget","pause"]);
    await page.getByRole("button",{name:"Analisar campanhas existentes",exact:true}).click(); await page.getByRole("button",{name:"Analisar Zyon externa",exact:true}).click(); await expect(page.getByText("Somente análise",{exact:true})).toBeVisible(); expect((await facts(page)).writes).toHaveLength(4);
    await page.getByRole('tab',{name:'Configurações',exact:true}).click();
    await page.getByText("Plano, preço e saldo de imagens",{exact:true}).click();await expect(page.getByText(/149,00\/mês/)).toBeVisible();
    await page.route("https://checkout.stripe.com/**",route=>route.fulfill({status:302,headers:{location:"http://127.0.0.1:5178/?tab=meta-ads-agent&addon_checkout=success"}}));
    await page.getByRole("button",{name:/Comprar 10 imagens por/}).click();await expect(page).toHaveURL(/addon_checkout=success/);expect((await overview(page)).wallet.extraAvailable).toBe(0);
    await page.getByRole('tab',{name:'Configurações',exact:true}).click();
    await page.getByText("Plano, preço e saldo de imagens",{exact:true}).click();await page.getByRole("button",{name:"Cancelar renovação",exact:true}).click();await expect(page.getByText(/Campanhas na Meta podem continuar consumindo verba/)).toBeVisible();await page.getByRole("button",{name:"Confirmar cancelamento",exact:true}).click();await expect(page.getByText(/Renovação cancelada/)).toBeVisible();expect((await overview(page)).subscription.status).toBe("cancel_at_period_end");
    await page.getByText("Configurar conexão com a Meta",{exact:true}).click();await page.getByRole("button",{name:"Desconectar Meta",exact:true}).click();await expect(page.getByText(/As campanhas podem continuar consumindo verba na Meta/)).toBeVisible();await page.getByRole("button",{name:"Confirmar desconexão",exact:true}).click();await expect(page.getByText(/Meta desconectada/)).toBeVisible();expect((await facts(page)).writes).toHaveLength(4);
    await page.getByRole('tab',{name:'Campanhas',exact:true}).click();
    await page.getByRole("button",{name:"Abrir campanha Coleção Aurora",exact:true}).click();
    await page.screenshot({path:testInfo.outputPath(`merchant-${viewport.width}.png`),fullPage:true}); expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    await page.request.post(backend + "/__test/expire"); await page.getByRole("button",{name:"Atualizar dados",exact:true}).click(); await expect(page.getByText(/Seu histórico permanece disponível/)).toBeVisible(); await expect(page.getByRole("button",{name:"Criar proposta",exact:true})).toBeDisabled(); expect((await overview(page)).proposals).toHaveLength(4); expect((await facts(page)).writes).toHaveLength(4);
  });
}
