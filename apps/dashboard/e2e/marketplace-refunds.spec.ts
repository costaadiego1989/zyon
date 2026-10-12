import { test, expect, type Page } from "@playwright/test";
// Real Chromium dashboard. Every API request is simulated; no external provider writes.
async function mockApi(page: Page, options: {role?:string;expired?:boolean;noAuth?:boolean;timeout?:boolean;wrongReceipt?:boolean;invalidList?:boolean;authFailure?:boolean;debtScenario?:"partial"|"legacy"|"invalid"}={}) {
 const state={merchant:'host-a',listError:false,empty:false,postState:'pending',getState:'confirmed',posts:[] as any[],requests:[] as Array<{path:string;method:string}>};
 const role=options.role??'owner';
 function row(name:string,status='prepared') { return {refund_id:`refund_${name}`,return_id:`return_${name}`,payment_intent_id:`payment_${name}`,created_at:'2026-09-30T15:00:00Z',
   amount_cents:1000,currency:'BRL',status:options.invalidList?'PRIVATE_PROVIDER_STATE':status,can_execute:status==='prepared',lines:[{variant_id:'variant_azul',quantity:1,amount_cents:850}],
   components:{commission:'refund',platform_fees:'retain',host_platform_fee:'refund',commission_refund_cents:100,platform_fee_refund_cents:0,host_platform_fee_refund_cents:12,buyer_service_fee_cents:50,shipping_cents:100}}; }
  await page.route("**/audit-api/**", async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname.replace("/audit-api/v1", "");
    state.requests.push({ path, method: request.method() });
    const json = (data: unknown, status = 200) => route.fulfill({ json: data, status });
    if (path === "/merchants/me") return options.noAuth ? json({}, 401) : json({ id: state.merchant, name: state.merchant === "host-a" ? "Loja Aurora" : "Loja Horizonte", user_id: "operator-test", role, plan: "BOTH" });
    if (path === "/auth/refresh") return json({}, 401);
    if (path === "/merchants/me/store-settings") return json({});
    if (path === "/billing/subscription") return json({ plan: options.debtScenario ? "scale" : "starter", status: options.debtScenario ? "active" : "canceled", trial_expired: options.expired ?? false, features: { marketplace: !!options.debtScenario } });
    if (path === "/billing/plans") return json([]);
    if (path === "/onboarding") return json({ completed: true, steps: [] });
    if (path === "/merchants/me/stores") return json({ data: [{ id: "host-a", name: "Loja Aurora", role }, { id: "host-b", name: "Loja Horizonte", role }] });
    if (path === "/merchants/me/stores/host-b/activate") { state.merchant = "host-b"; return json({ merchant_id: "host-b" }); }
    if (options.debtScenario && path.startsWith("/marketplace/dashboard/")) {
      const settlement = { id: "settlement_partial", orderId: "order_partial", lineItemId: "line_partial", hostMerchantId: "host-a", sellerMerchantId: "seller-a",
        totalAmountCents: 12000, commissionCents: 2000, sellerNetCents: 10000, status: "chargeback_debt", createdAt: "2026-09-30T15:00:00Z",
        returnWindowUntil: "2026-09-10T15:00:00Z", chargebackWindowUntil: "2026-10-30T15:00:00Z", chargebackAt: "2026-09-30T15:00:00Z", transferScheduledAt: null };
      const debt = { id: "debt_partial", settlementId: settlement.id, amountCents: 10000, status: "outstanding", deductedFromSettlementId: null,
        createdAt: settlement.createdAt, resolvedAt: null, ...(options.debtScenario === "legacy" ? {} : { recoveredAmountCents: 3500, outstandingAmountCents: options.debtScenario === "invalid" ? 9000 : 6500 }) };
      if (path === "/marketplace/dashboard/config") return json({ enabled: true });
      if (path === "/marketplace/dashboard/orders") return json([]);
      if (path === "/marketplace/dashboard/stats") return json({});
      if (path === "/marketplace/dashboard/settlements") return json({ settlements: [settlement], total: 1, limit: 20, offset: 0 });
      if (path === "/marketplace/dashboard/settlements/settlement_partial") return json({ settlement, debt, timeline: [], availableTransitions: [] });
      if (path === "/marketplace/dashboard/chargebacks") return json({ chargebacks: [{ settlement, debt, type: "chargeback_debt" }], totalDebtCents: 10000, totalCancelled: 0, totalWithDebt: 1 });
    }
    if(path==='/marketplace/dashboard/refunds') {
      if(state.listError)return json({message:'PRIVATE_PROVIDER_TOKEN'},503);
      const refunds=state.empty||state.merchant==='host-b'?[]:url.searchParams.has('cursor')?[row('older','blocked')]:[row('aurora'),row('pending','pending'),row('confirmed','confirmed'),row('blocked','blocked')];
      return json({refunds,next_cursor:refunds.length===4?'refund_blocked':null});
    }
    if(path.endsWith('/execute')) {
      state.posts.push(request.postDataJSON());if(options.timeout)return route.abort('connectionreset');if(options.authFailure)return json({},401);
      return json(row(options.wrongReceipt?'foreign':path.split('/').at(-2)!.replace('refund_',''),state.postState),state.postState==='pending'?202:200);
    }
    if(path.startsWith('/marketplace/dashboard/refunds/')) return json(row(path.split('/').at(-1)!.replace('refund_',''),state.getState));
    if (path.includes("notification")) return json({ notifications: [], unread_count: 0 });
    if (path.endsWith("/domains")) return json([]);
    if (path === "/dashboard/nav-counts") return json({ orders: 0, messages: 0, cartRecovery: 0 });
    return json({});
  });
  await page.route(/^https?:\/\/(?!localhost:5191)/, route => route.abort());
  return state;
}
const refund=(page:Page,name='aurora')=>page.getByRole('row').filter({has:page.getByText(`return_${name}`,{exact:true})});
async function review(page:Page) {await refund(page).getByRole('button',{name:'Ver detalhes'}).click();}
async function confirm(page:Page) {await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Confirmar envio do estorno'}).click();}

test('explicit commercial review and confirmation send once, then local GET shows provider confirmation',async({page},info)=>{
 const state=await mockApi(page);await page.goto('/#marketplace-refunds');await expect(page.getByRole('heading',{name:'Estornos do marketplace'})).toBeVisible();
 await expect(refund(page)).toContainText('Pronto para revis\u00e3o');await expect(refund(page,'pending')).toContainText('Aguardando confirma\u00e7\u00e3o');await expect(refund(page,'blocked')).toContainText('Revis\u00e3o necess\u00e1ria');
 await review(page);await expect(page.getByRole('heading',{name:'Revisar valores do estorno'})).toBeFocused();
 await expect(page.locator('.marketplace-refunds__detail')).toContainText('Total a devolver ao comprador');await expect(page.locator('.marketplace-refunds__detail')).toContainText('Retida');
 await expect(page.getByRole('button',{name:'Confirmar envio do estorno'})).toBeDisabled();expect(state.posts).toHaveLength(0);
 await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Confirmar envio do estorno'}).scrollIntoViewIfNeeded();
 await expect(page.locator('.platform-feedback-fab')).toBeHidden();await page.screenshot({path:info.outputPath('confirmation-action.png')});
 await page.getByRole('button',{name:'Confirmar envio do estorno'}).click();await expect(refund(page)).toContainText('Aguardando confirma\u00e7\u00e3o');
 expect(state.posts).toEqual([{confirmed:true,expected_amount_cents:1000}]);await refund(page).getByRole('button',{name:'Consultar estado'}).click();
 await expect(refund(page)).toContainText('Estorno confirmado');await review(page);await expect(page.getByRole('button',{name:'Confirmar envio do estorno'})).toHaveCount(0);
 expect(state.posts).toHaveLength(1);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:info.outputPath('confirmed.png'),fullPage:true});
});
test('response loss stays uncertain after an early prepared GET and list refresh without retry',async({page})=>{
 const state=await mockApi(page,{timeout:true});state.getState='prepared';await page.goto('/#marketplace-refunds');await review(page);await confirm(page);
 await expect(refund(page)).toContainText('Solicita\u00e7\u00e3o sem confirma\u00e7\u00e3o');await refund(page).getByRole('button',{name:'Consultar estado'}).click();await page.getByRole('button',{name:'Atualizar lista'}).click();
 await review(page);await expect(page.getByRole('button',{name:'Confirmar envio do estorno'})).toHaveCount(0);expect(state.posts).toHaveLength(1);
 state.getState='confirmed';await refund(page).getByRole('button',{name:'Consultar estado'}).click();await expect(refund(page)).toContainText('Estorno confirmado');expect(state.posts).toHaveLength(1);
});
test('pagination, sanitized error and empty state use only GET',async({page})=>{
 const state=await mockApi(page);await page.goto('/#marketplace-refunds');await page.getByRole('button',{name:'Pr\u00f3xima',exact:true}).click();await expect(refund(page,'older')).toBeVisible();
 await expect(page.getByRole('button',{name:'Pr\u00f3xima',exact:true})).toBeDisabled();await page.getByRole('button',{name:'Anterior',exact:true}).click();await expect(refund(page)).toBeVisible();
 state.listError=true;await page.getByRole('button',{name:'Atualizar lista'}).click();await expect(page.getByRole('alert')).toContainText('N\u00e3o foi poss\u00edvel carregar');await expect(page.locator('body')).not.toContainText('PRIVATE_PROVIDER_TOKEN');
 state.listError=false;state.empty=true;await page.getByRole('button',{name:'Atualizar lista'}).click();await expect(page.getByText('Nenhum plano de estorno',{exact:true})).toBeVisible();expect(state.posts).toHaveLength(0);
 expect(state.requests.filter(r=>r.path.includes('/marketplace/dashboard/refunds')).every(r=>r.method==='GET')).toBe(true);
});
test('staff and unauthenticated sessions never query refund journals or expose actions',async({page})=>{
 const state=await mockApi(page,{role:'staff'});await page.goto('/#marketplace-refunds');await expect(page.getByRole('dialog')).toBeVisible();expect(state.requests.filter(r=>r.path.includes('/marketplace/dashboard/refunds'))).toHaveLength(0);
 await page.unrouteAll();const noAuth=await mockApi(page,{noAuth:true});await page.goto('/?mode=login#marketplace-refunds');await expect(page.locator('input[type="password"]').first()).toBeVisible();expect(noAuth.requests.filter(r=>r.path.includes('/marketplace/dashboard/refunds'))).toHaveLength(0);
});
test('expired owner keeps refund remediation and existing payment/shipping entries',async({page})=>{
 const state=await mockApi(page,{expired:true});await page.goto('/#marketplace-refunds');await review(page);await confirm(page);await expect(refund(page)).toContainText('Aguardando confirma\u00e7\u00e3o');
 await page.getByRole('button',{name:'Voltar \u00e0 assinatura'}).click();await expect(page.getByRole('button',{name:'Gerenciar cobran\u00e7as existentes do marketplace'})).toBeVisible();await expect(page.getByRole('button',{name:'Gerenciar remessas existentes do marketplace'})).toBeVisible();
 await page.getByRole('button',{name:'Gerenciar estornos existentes do marketplace'}).click();await expect(refund(page)).toBeVisible();expect(state.posts).toHaveLength(1);
});
test('expired admin still reviews and executes an existing plan',async({page})=>{
 const state=await mockApi(page,{role:'admin',expired:true});await page.goto('/#marketplace-refunds');await review(page);await confirm(page);await expect(refund(page)).toContainText('Aguardando confirma\u00e7\u00e3o');expect(state.posts).toHaveLength(1);
});
test('merchant switch discards approved checkbox and foreign refund details',async({page})=>{
 const state=await mockApi(page);await page.goto('/#marketplace-refunds');await review(page);await page.getByRole('checkbox').check();
 await page.locator('.merchant-store-switcher').getByRole('button',{name:'Loja Aurora',exact:true}).click();await page.getByRole('dialog',{name:'Trocar loja'}).getByRole('button',{name:/Loja Horizonte/}).click();
 await expect(page.getByText('Nenhum plano de estorno',{exact:true})).toBeVisible();await expect(page.locator('body')).not.toContainText('return_aurora');await expect(page.getByRole('checkbox')).toHaveCount(0);expect(state.posts).toHaveLength(0);
});
test('foreign receipt cannot be displayed or clear an uncertain submission',async({page})=>{
 const state=await mockApi(page,{wrongReceipt:true});await page.goto('/#marketplace-refunds');await review(page);await confirm(page);await expect(refund(page)).toContainText('Solicita\u00e7\u00e3o sem confirma\u00e7\u00e3o');
 await expect(page.locator('body')).not.toContainText('return_foreign');expect(state.posts).toHaveLength(1);
});
test('malformed response fails neutrally without rendering provider state',async({page})=>{
 const state=await mockApi(page,{invalidList:true});await page.goto('/#marketplace-refunds');await expect(page.getByRole('alert')).toContainText('N\u00e3o foi poss\u00edvel carregar');await expect(page.locator('body')).not.toContainText('PRIVATE_PROVIDER_STATE');expect(state.posts).toHaveLength(0);
});
test('local GET invalidates an open stale confirmation and blocked plans cannot execute',async({page})=>{
 const state=await mockApi(page);await page.goto('/#marketplace-refunds');await review(page);await page.getByRole('checkbox').check();state.getState='confirmed';await refund(page).getByRole('button',{name:'Consultar estado'}).click();
 await expect(page.getByRole('button',{name:'Confirmar envio do estorno'})).toHaveCount(0);await refund(page,'blocked').getByRole('button',{name:'Ver detalhes'}).click();await expect(page.getByRole('checkbox')).toHaveCount(0);expect(state.posts).toHaveLength(0);
});
test('an unauthorized financial command has no automatic authentication retry',async({page})=>{
 const state=await mockApi(page,{authFailure:true});await page.goto('/#marketplace-refunds');await review(page);await confirm(page);await expect(page.locator('input[type="password"]').first()).toBeVisible();expect(state.posts).toHaveLength(1);
});

test('partial recovery shows original, recovered and remaining principal while debt stays open in list and detail', async ({ page }, info) => {
  const state = await mockApi(page, { debtScenario: "partial" }); await page.goto('/#marketplace');
  await page.getByRole('tab', { name: 'Contestações', exact: true }).click();
  const aggregate = page.getByRole('article').filter({ hasText: 'Principal original das dívidas' });
  await expect(aggregate.locator('.stat-card__value')).toHaveText(/R\$\s*100,00/);
  const values = page.locator('.marketplace-debt-principal');
  await expect(values).toContainText('Principal original'); await expect(values).toContainText(/R\$\s*100,00/);
  await expect(values).toContainText('Principal recuperado'); await expect(values).toContainText(/R\$\s*35,00/);
  await expect(values).toContainText('Principal restante'); await expect(values).toContainText(/R\$\s*65,00/);
  await expect(page.getByRole('cell').filter({ has: values })).toContainText('Em aberto');
  await values.scrollIntoViewIfNeeded(); await page.screenshot({ path: info.outputPath('debt-partial-list.png') });
  await page.getByRole('tab', { name: 'Repasses', exact: true }).click(); await page.getByRole('button', { name: 'Detalhes', exact: true }).click();
  const panel = page.locator('.settlement-panel__debt'); await expect(panel).toContainText(/R\$\s*100,00/);
  await expect(panel).toContainText(/R\$\s*35,00/); await expect(panel).toContainText(/R\$\s*65,00/); await expect(panel).toContainText('Pendente');
  await panel.scrollIntoViewIfNeeded(); await page.screenshot({ path: info.outputPath('debt-partial-detail.png') });
  expect(state.posts).toHaveLength(0); expect(state.requests.filter(row => row.path.startsWith('/marketplace/dashboard/')).every(row => row.method === 'GET')).toBe(true);
});

for (const debtScenario of ['legacy', 'invalid'] as const) test(`${debtScenario} recovery fields preserve original principal without inventing recovered or remaining values`, async ({ page }) => {
  await mockApi(page, { debtScenario }); await page.goto('/#marketplace'); await page.getByRole('tab', { name: 'Contestações', exact: true }).click();
  const values = page.locator('.marketplace-debt-principal'); await expect(values).toContainText(/R\$\s*100,00/);
  await expect(values).toContainText('Saldo atualizado não informado.'); await expect(values).not.toContainText('Principal recuperado'); await expect(values).not.toContainText('Principal restante');
  await page.getByRole('tab', { name: 'Repasses', exact: true }).click(); await page.getByRole('button', { name: 'Detalhes', exact: true }).click();
  const panel = page.locator('.settlement-panel__debt'); await expect(panel).toContainText('Saldo atualizado não informado.'); await expect(panel).toContainText('Pendente');
});
