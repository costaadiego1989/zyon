import { test, expect, type Page } from "@playwright/test";
// Real Chromium, synthetic authenticated API transport. No provider access.
async function mockApi(page: Page, options: {role?:string;expired?:boolean;noAuth?:boolean;timeout?:boolean;blocked?:boolean;forbidden?:boolean;prior?:boolean}={}) {
 const state={merchant:'host-a',posts:[] as any[],requests:[] as Array<{path:string;method:string}>,stale:false,prepared:false,detailReady:false};
 const role=options.role??'owner';
 const candidate={return_id:'return_inspected',payment_intent_id:'payment_frozen',created_at:'2026-09-30T15:00:00Z',expected_preparation_hash:'a'.repeat(64),products_amount_cents:2500,buyer_service_fee_available_cents:100,buyer_service_fee_refund_cents:50,can_prepare:true,
   lines:[{variant_id:'variant_a',merchant_id:'seller-a',quantity:1,amount_cents:1500},{variant_id:'variant_b',merchant_id:'seller-b',quantity:1,amount_cents:1000}],
   shipping:[{merchant_id:'seller-a',merchant_name:'Loja Horizonte',available_cents:300,refund_cents:100},{merchant_id:'seller-b',merchant_name:'Loja Sol',available_cents:200,refund_cents:0}],
   required_policy:options.prior?{commission:'refund',platformFees:'retain',hostPlatformFee:'refund'}:null};
 const prepared=()=>({return_id:candidate.return_id,candidate:null,prepared_refund:{refund_id:'refund_prepared',return_id:candidate.return_id,payment_intent_id:candidate.payment_intent_id,amount_cents:2650,status:options.blocked?'blocked':'prepared'}});
  await page.route("**/audit-api/**", async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname.replace("/audit-api/v1", "");
    state.requests.push({ path, method: request.method() });
    const json = (data: unknown, status = 200) => route.fulfill({ json: data, status });
    if (path === "/merchants/me") return options.noAuth ? json({}, 401) : json({ id: state.merchant, name: state.merchant === "host-a" ? "Loja Aurora" : "Loja Horizonte", user_id: "operator-test", role, plan: "BOTH" });
    if (path === "/auth/refresh") return json({}, 401);
    if (path === "/merchants/me/store-settings") return json({});
    if (path === "/billing/subscription") return json({ plan: "starter", status: "canceled", trial_expired: options.expired ?? false, features: { marketplace: false } });
    if (path === "/billing/plans") return json([]);
    if (path === "/onboarding") return json({ completed: true, steps: [] });
    if (path === "/merchants/me/stores") return json({ data: [{ id: "host-a", name: "Loja Aurora", role }, { id: "host-b", name: "Loja Horizonte", role }] });
    if (path === "/merchants/me/stores/host-b/activate") { state.merchant = "host-b"; return json({ merchant_id: "host-b" }); }
    if(path==='/marketplace/dashboard/refunds') return json({refunds:[],next_cursor:null});
    if(path==='/marketplace/dashboard/refund-candidates') return options.forbidden?json({message:'PRIVATE_OPERATOR_DATA'},403):json({candidates:state.merchant==='host-a'?[candidate]:[],next_cursor:null});
    if(path==='/marketplace/dashboard/refund-candidates/return_inspected/prepare') {
      state.posts.push(request.postDataJSON());
      if(options.timeout)return route.abort('connectionreset');if(state.stale)return json({message:'PRIVATE_SNAPSHOT'},409);
      state.prepared=true;return json(prepared(),201);
    }
    if(path==='/marketplace/dashboard/refund-candidates/return_inspected') return json(state.prepared||state.detailReady?prepared():{return_id:candidate.return_id,candidate,prepared_refund:null});
    if(path==='/marketplace/dashboard/refunds/refund_prepared')return json({refund_id:'refund_prepared',return_id:candidate.return_id,payment_intent_id:candidate.payment_intent_id,amount_cents:2650,currency:'BRL',status:options.blocked?'blocked':'prepared',can_execute:!options.blocked,created_at:candidate.created_at,
      lines:candidate.lines.map(line=>({variant_id:line.variant_id,quantity:line.quantity,amount_cents:line.amount_cents})),components:{commission:'refund',platform_fees:options.prior?'retain':'refund',host_platform_fee:'refund',commission_refund_cents:100,platform_fee_refund_cents:20,host_platform_fee_refund_cents:0,buyer_service_fee_cents:50,shipping_cents:100}});
    if (path.includes("notification")) return json({ notifications: [], unread_count: 0 });
    if (path.endsWith("/domains")) return json([]);
    if (path === "/dashboard/nav-counts") return json({ orders: 0, messages: 0, cartRecovery: 0 });
    return json({});
  });
  await page.route(/^https?:\/\/(?!localhost:5193)/, route => route.abort());
  return state;
}
async function openForm(page: Page) {
  await page.goto('/#marketplace-refunds'); await page.getByRole('button', { name: 'Preparar devolução', exact: true }).click();
  await page.getByRole('button', { name: 'Definir componentes', exact: true }).click();
}
async function fill(page: Page, prior = false) {
  await page.getByRole('combobox', { name: 'Comissão da loja anfitriã', exact: true }).selectOption('refund');
  await page.getByRole('combobox', { name: 'Taxas da plataforma dos vendedores', exact: true }).selectOption(prior ? 'retain' : 'refund');
  await page.getByRole('combobox', { name: 'Taxa da plataforma da loja anfitriã', exact: true }).selectOption('refund');
  await expect(page.getByLabel('Taxa de serviço do comprador (R$)')).toHaveValue('0,50');
  await expect(page.getByLabel('Frete de Loja Horizonte (R$)')).toHaveValue('1,00');
  await expect(page.getByLabel('Frete de Loja Sol (R$)')).toHaveValue('0,00');
}
async function submit(page: Page) { await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Confirmar preparação do plano' }).click(); }

test('preparation requires every policy and cents component, then opens the existing plan without sending money', async ({ page }, info) => {
  const state = await mockApi(page); await openForm(page);
  await expect(page.getByRole('heading', { name: 'Definir componentes do estorno' })).toBeFocused();
  for (const select of await page.locator('.marketplace-refund-preparation__form').getByRole('combobox').all()) await expect(select).toHaveValue('');
  await expect(page.getByRole('checkbox')).toBeDisabled(); await expect(page.getByRole('button', { name: 'Confirmar preparação do plano' })).toBeDisabled();
  await fill(page); await expect(page.getByText('Total proposto ao comprador:')).toContainText(/26,50/); expect(state.posts).toHaveLength(0);
  await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Confirmar preparação do plano' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('preparation-confirmation.png') });
  await page.getByRole('button', { name: 'Confirmar preparação do plano' }).click(); await expect(page.getByRole('heading', { name: 'Plano preparado' })).toBeVisible();
  expect(state.posts).toEqual([{ confirmed: true, expected_preparation_hash: 'a'.repeat(64), components: { commission: 'refund', platformFees: 'refund', hostPlatformFee: 'refund', buyerServiceFeeCents: 50,
    shipping: [{ merchantId: 'seller-a', amountCents: 100 }, { merchantId: 'seller-b', amountCents: 0 }] } }]);
  await page.getByRole('button', { name: 'Abrir plano de estorno' }).click(); await expect(page.getByRole('heading', { name: 'Revisar valores do estorno' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirmar envio do estorno' })).toBeDisabled();
  expect(state.requests.filter(row => row.path.endsWith('/execute'))).toHaveLength(0); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('prepared-plan.png') });
});
test('original freight and buyer fee are read-only and included automatically', async ({ page }) => {
  const state = await mockApi(page); await openForm(page); await fill(page);
  const freight = page.getByLabel('Frete de Loja Horizonte (R$)');
  await expect(freight).toHaveAttribute('readonly', '');
  await expect(page.getByLabel('Taxa de serviço do comprador (R$)')).toHaveAttribute('readonly', '');
  await expect(page.getByLabel('Frete de Loja Sol (R$)')).toHaveAttribute('readonly', '');
  await expect(page.getByText('Total proposto ao comprador:')).toContainText(/26,50/);
  expect(state.posts).toHaveLength(0);
});
test('blocked preparation opens a review-only plan and never exposes execution', async ({ page }) => {
  const state = await mockApi(page, { blocked: true }); await openForm(page); await fill(page); await submit(page);
  await expect(page.getByRole('status')).toContainText('permanece bloqueado'); await page.getByRole('button', { name: 'Abrir plano de estorno' }).click();
  await expect(page.getByRole('button', { name: 'Confirmar envio do estorno' })).toHaveCount(0); expect(state.posts).toHaveLength(1);
});
test('lost response uses GET only and an early unprepared read never retries preparation', async ({ page }) => {
  const state = await mockApi(page, { timeout: true }); await openForm(page); await fill(page); await submit(page);
  await expect(page.getByRole('status')).toContainText('Preparação sem confirmação'); await page.getByRole('button', { name: 'Consultar preparação' }).click();
  await expect(page.getByRole('button', { name: 'Confirmar preparação do plano' })).toHaveCount(0); expect(state.posts).toHaveLength(1);
  state.detailReady = true; await page.getByRole('button', { name: 'Consultar preparação' }).click(); await expect(page.getByRole('heading', { name: 'Plano preparado' })).toBeVisible(); expect(state.posts).toHaveLength(1);
});
test('stale snapshot requires a new authoritative read and clears every old decision', async ({ page }) => {
  const state = await mockApi(page); state.stale = true; await openForm(page); await fill(page); await submit(page);
  await expect(page.getByRole('alert')).toContainText('Os dados mudaram'); await expect(page.locator('body')).not.toContainText('PRIVATE_SNAPSHOT');
  await page.getByRole('button', { name: 'Consultar preparação' }).click(); await expect(page.locator('.marketplace-refund-preparation__form').getByRole('combobox').first()).toHaveValue('');
  await expect(page.getByLabel('Taxa de serviço do comprador (R$)')).toHaveValue('0,50'); await expect(page.getByRole('checkbox')).not.toBeChecked(); expect(state.posts).toHaveLength(1);
});
test('switching merchants discards components, selected return and confirmation', async ({ page }) => {
  const state = await mockApi(page); await openForm(page); await fill(page); await page.getByRole('checkbox').check();
  await page.locator('.merchant-store-switcher').getByRole('button', { name: 'Loja Aurora', exact: true }).click();
  await page.getByRole('dialog', { name: 'Trocar loja' }).getByRole('button', { name: /Loja Horizonte/ }).click();
  await page.getByRole('button', { name: 'Preparar devolução', exact: true }).click(); await expect(page.getByText(/Nenhuma devolução elegível/)).toBeVisible();
  await expect(page.locator('body')).not.toContainText('return_inspected'); await expect(page.getByRole('checkbox')).toHaveCount(0); expect(state.posts).toHaveLength(0);
});
for (const role of ['owner', 'admin']) test(`${role} can prepare existing obligations after downgrade`, async ({ page }) => {
  const state = await mockApi(page, { role, expired: true }); await openForm(page); await fill(page); await submit(page);
  await expect(page.getByRole('heading', { name: 'Plano preparado' })).toBeVisible(); expect(state.posts).toHaveLength(1);
});
test('previous policy must be explicitly reconfirmed and cannot change', async ({ page }) => {
  const state = await mockApi(page, { prior: true }); await openForm(page);
  const fees = page.getByRole('combobox', { name: 'Taxas da plataforma dos vendedores', exact: true }); await expect(fees).toHaveValue('');
  await expect(fees.locator('option[value="refund"]')).toHaveJSProperty('disabled', true); await fill(page, true); await submit(page); await expect(page.getByRole('heading', { name: 'Plano preparado' })).toBeVisible(); expect(state.posts[0].components.platformFees).toBe('retain');
});
test('staff cannot query candidates and forbidden API errors remain neutral', async ({ page }) => {
  const state = await mockApi(page, { role: 'staff' }); await page.goto('/#marketplace-refunds'); await expect(page.getByRole('dialog')).toBeVisible();
  expect(state.requests.filter(row => row.path.includes('refund-candidates'))).toHaveLength(0); await page.unrouteAll();
  await mockApi(page, { forbidden: true }); await page.reload(); await page.getByRole('button', { name: 'Preparar devolução', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Não foi possível consultar'); await expect(page.locator('body')).not.toContainText('PRIVATE_OPERATOR_DATA');
});
