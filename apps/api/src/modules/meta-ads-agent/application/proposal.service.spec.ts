import assert from "node:assert/strict";
import { test } from "node:test";
import type { MetaAdsCampaignDraft, MetaAdsProduct } from "@zyon/shared-types";
import { applicationFixture } from "./__tests__/fixture.js";
import { ConnectionService } from "./connection.service.js";
import { CampaignService } from "./campaign.service.js";
import { ProposalService } from "./proposal.service.js";

test('ACAP-08 a launch review freezes the current business version and active intent without remote objects',async()=>{
  const f=await fixture(false);try{
    const current=await f.campaigns.owned('store-a',f.campaign.id),p=await f.service.create('store-a',current.id,{kind:'launch',after:{},reasoning:'Campanha pronta para aprovacao inicial',idempotencyKey:'launch-review'});
    assert.equal(p.kind,'launch');assert.equal(p.status,'pending_review');assert.equal(p.approvedBy,null);assert.equal(p.executionId,null);assert.equal(p.after.status,'ACTIVE');assert.deepEqual(p.after.draft,current.draft);assert.deepEqual(p.after.products,current.products);
    assert.deepEqual(p.after.objects,['campaign','ad_set','creative','ad']);assert.equal(p.after.accountId,'100');assert.equal(p.after.pageId,'110');assert.equal(p.after.datasetId,'120');assert.equal(p.after.whatsappId,null);
    const media=p.after.media as Array<{id:string;commercialReview:{status:string;imageSha256:string}}>;
    assert.deepEqual(media.map(m=>m.id),['media-a']);assert.equal(media[0].commercialReview.status,'verified');assert.equal(media[0].commercialReview.imageSha256,'a'.repeat(64));assert.deepEqual(p.before.objects,[]);
    const state=await f.repo.read('store-a');assert.equal(p.connectionEpoch,state.connection.epoch);assert.equal(state.campaigns[current.id].remoteCampaignId,null);assert.equal(Object.keys(state.executions).length,0);assert.equal(f.calls.includes('prepare'),false);assert.equal(f.calls.includes('execute'),false);
    assert.deepEqual((await f.repo.getRecord('store-a',`proposal-version:${p.id}`))!.payload,p);
  }finally{await f.close();}
});
test('ACAP-08 carousel review retains the exact selected media order and verified content',async()=>{
  const f=await fixture(false);try{
    await f.repo.mutate('store-a',[],state=>{state.media['media-b']={...state.media['media-a'],id:'media-b',url:'https://media.example.test/second.png',commercialReview:{...state.media['media-a'].commercialReview!,imageSha256:'b'.repeat(64)}};return {result:null};});
    const current=await f.campaigns.owned('store-a',f.campaign.id);await f.campaigns.save('store-a',current.id,{...current.draft,mediaIds:['media-b','media-a']});
    const p=await f.service.create('store-a',current.id,{kind:'launch',reasoning:'Carrossel revisado',idempotencyKey:'launch-carousel'});
    assert.deepEqual((p.after.media as Array<{id:string;url:string}>).map(m=>[m.id,m.url]),[['media-b','https://media.example.test/second.png'],['media-a','https://media.example.test/result.png']]);assert.deepEqual((p.after.draft as MetaAdsCampaignDraft).mediaIds,['media-b','media-a']);
  }finally{await f.close();}
});
test('ACAP-14 pending or rejected image verification prevents a launch review',async()=>{
  const f=await fixture(false);try{
    for(const status of ['unavailable','rejected'] as const){await f.repo.mutate('store-a',[],state=>{state.media['media-a'].commercialReview!.status=status;return {result:null};});await assert.rejects(f.service.create('store-a',f.campaign.id,{kind:'launch',reasoning:'Ainda nao pronta',idempotencyKey:`launch-${status}`}));}
    assert.equal(Object.keys((await f.repo.read('store-a')).proposals).length,0);assert.equal(f.calls.includes('prepare'),false);
  }finally{await f.close();}
});
test('ACAP-14 changed canonical catalog data cannot be announced as a current launch review',async()=>{
  const f=await fixture(false);try{
    f.commerce.products=async()=>[{...f.campaign.products[0],commercialVersion:'changed-version',priceCents:12000}];
    await assert.rejects(f.service.create('store-a',f.campaign.id,{kind:'launch',reasoning:'Catalogo alterado',idempotencyKey:'changed-launch'}),{code:'campaign_products_changed'});assert.equal(Object.keys((await f.repo.read('store-a')).proposals).length,0);
  }finally{await f.close();}
});
test('ACAP-08 required budget and copy remain mandatory for a launch review',async()=>{
  const f=await fixture(false);try{
    const current=await f.campaigns.owned('store-a',f.campaign.id);await f.campaigns.save('store-a',current.id,{...current.draft,budget:null});await assert.rejects(f.service.create('store-a',current.id,{kind:'launch',reasoning:'Sem verba definida',idempotencyKey:'missing-launch-budget'}),{code:'campaign_budget_required'});
    await f.campaigns.save('store-a',current.id,{...current.draft,headline:''});await assert.rejects(f.service.create('store-a',current.id,{kind:'launch',reasoning:'Sem texto',idempotencyKey:'missing-launch-copy'}),{code:'creative_copy_required'});assert.equal(Object.keys((await f.repo.read('store-a')).proposals).length,0);
  }finally{await f.close();}
});
test('ACAP-14 media changes during connection validation cannot commit an obsolete launch snapshot',async()=>{
  const f=await fixture(false);try{
    const original=f.connection.access.bind(f.connection);f.connection.access=async(...args)=>{const access=await original(...args);await f.repo.mutate('store-a',[],state=>{state.media['media-a'].url='https://media.example.test/changed.png';return {result:null};});return access;};
    await assert.rejects(f.service.create('store-a',f.campaign.id,{kind:'launch',reasoning:'Versao deve ser exata',idempotencyKey:'racing-launch'}),{code:'proposal_stale'});assert.equal(Object.keys((await f.repo.read('store-a')).proposals).length,0);
  }finally{await f.close();}
});
test('ACAP-08 idempotent launch requests retain one frozen version while a correction requires a new review',async()=>{
  const f=await fixture(false);try{
    const input={kind:'launch' as const,reasoning:'Revisao unica',idempotencyKey:'same-launch'},first=await f.service.create('store-a',f.campaign.id,input);assert.equal((await f.service.create('store-a',f.campaign.id,input)).id,first.id);
    const current=await f.campaigns.owned('store-a',f.campaign.id);await f.campaigns.save('store-a',current.id,{...current.draft,budget:{...current.draft.budget!,amountCents:3000}});
    assert.equal((await f.service.create('store-a',current.id,input)).status,'stale');const next=await f.service.create('store-a',current.id,{...input,idempotencyKey:'corrected-launch'});assert.notEqual(next.digest,first.digest);assert.notEqual(next.id,first.id);assert.equal((next.after.draft as MetaAdsCampaignDraft).budget!.amountCents,3000);assert.equal((await f.repo.read('store-a')).media['media-a'].id,'media-a');
  }finally{await f.close();}
});
test('ACAP-08 the client cannot override the frozen launch targets or active intent',async()=>{
  const f=await fixture(false);try{
    await assert.rejects(f.service.create('store-a',f.campaign.id,{kind:'launch',after:{accountId:'foreign',status:'ACTIVE'},reasoning:'No overrides',idempotencyKey:'injected-launch'}),{code:'proposal_fields_invalid'});assert.equal(Object.keys((await f.repo.read('store-a')).proposals).length,0);assert.equal(f.calls.includes('prepare'),false);
  }finally{await f.close();}
});
test('ACAP-08 launching a campaign with an existing remote structure cannot create another one',async()=>{
  const f=await fixture(true);try{await assert.rejects(f.service.create('store-a',f.campaign.id,{kind:'launch',reasoning:'Estrutura ja criada',idempotencyKey:'existing-launch'}),{code:'campaign_already_prepared'});assert.equal(f.calls.includes('prepare'),false);assert.equal(Object.keys((await f.repo.read('store-a')).proposals).length,0);}finally{await f.close();}
});

async function fixture(prepared = true) {
  const f = await applicationFixture(); let sequence = 0;
  const product: MetaAdsProduct = { productId: "product-a", variantId: "variant-a", name: "Produto", description: "Dados", sku: "A", imageUrl: "https://media.example.test/source.png", priceCents: 10000, currency: "BRL", stockQuantity: 5, active: true, storefrontUrl: "https://store.example.test/product-a", commercialVersion: "version-a" };
  f.commerce.products = async () => [product];
  const connection = new ConnectionService(f.repo, f.commerce, f.oauth, f.codec, f.provider, f.redirect, f.clock);
  const authorization = await connection.begin("store-a", "owner-a"); await connection.complete("store-a", "owner-a", new URL(authorization.authorizationUrl).searchParams.get("state")!, "code"); await connection.select("store-a", { accountId: "100", pageId: "110", datasetId: "120" });
  const campaigns = new CampaignService(f.repo, f.commerce, connection, f.provider, f.clock, () => `campaign-${++sequence}`);
  const draft: MetaAdsCampaignDraft = { name: "Campanha", destination: "store", priority: "paid_sales", variantIds: ["variant-a"], budget: { amountCents: 2000, currency: "BRL", cadence: "daily", startsAt: "2026-11-15T12:00:00Z", endsAt: null }, mediaIds: [], headline: "Produto", primaryText: "Conheca", country: "BR" };
  const campaign = await campaigns.create("store-a", draft, "create-a");
  await f.repo.mutate("store-a", [], state => {
    state.media["media-a"] = { id: "media-a", campaignId: campaign.id, productId: "product-a", variantId: "variant-a", productVersion: "version-a", url: "https://media.example.test/result.png", createdAt: "2026-11-14T12:00:00Z", commercialReview: { status: "verified", productVersion: "version-a", imageSha256: "a".repeat(64) } };
    return { result: null };
  });
  await campaigns.save("store-a", campaign.id, { ...draft, mediaIds: ["media-a"] });
  if (prepared) await f.repo.mutate("store-a", [], state => { Object.assign(state.campaigns[campaign.id], { remoteCampaignId: "200", remoteAdSetId: "300", remoteAdIds: ["500"], remoteAccountId: "100", status: "remote_paused" }); return { result: null }; });
  const service = new ProposalService(f.repo, f.commerce, campaigns, connection, f.provider, f.clock, () => `proposal-${++sequence}`);
  return { ...f, service, campaigns, campaign, connection };
}
test("MGA-40 approval binds store, actor, objects and the exact reviewed proposal version", async () => {
  const f = await fixture(false); try {
    const proposal = await f.service.create("store-a", f.campaign.id, { kind: "prepare", after: {}, reasoning: "Estrutura revisada", idempotencyKey: "prepare-a" });
    await assert.rejects(f.service.approve("store-a", proposal.id, "owner-a", "different-version"), { code: "proposal_version_changed" });
    const approved = await f.service.approve("store-a", proposal.id, "owner-a", proposal.digest);
    assert.equal(approved.status, "approved"); assert.equal(approved.approvedBy, "owner-a"); assert.equal(approved.approvedAt, "2026-11-14T12:00:00.000Z"); assert.equal(approved.campaignId, f.campaign.id); assert.equal(approved.digest, proposal.digest);
    const receipt = await f.repo.getRecord<{ actorId: string; digest: string; campaignId: string }>("store-a", `proposal-approval:${proposal.id}`);
    assert.equal(receipt!.payload.actorId, "owner-a"); assert.equal(receipt!.payload.digest, proposal.digest); assert.equal(receipt!.payload.campaignId, f.campaign.id); assert.equal(await f.repo.getRecord("store-b", `proposal-approval:${proposal.id}`), null);
    assert.equal(f.calls.includes("prepare"), false);
  } finally { await f.close(); }
});
test("MGA-66 pause, budget, audience and creative suggestions remain pending without external mutations", async () => {
  const f = await fixture(); try {
    for (const [kind, after] of [["pause", {}], ["budget", { budget: { ...f.campaign.draft.budget!, amountCents: 2500 } }], ["audience", { country: "PT" }], ["creative", {}]] as const) {
      const proposal = await f.service.create("store-a", f.campaign.id, { kind, after, reasoning: "Hipotese com dados", idempotencyKey: `suggest-${kind}` });
      assert.equal(proposal.status, "pending_review"); assert.equal(proposal.approvedBy, null); assert.equal(proposal.executionId, null);
    }
    assert.equal(f.calls.includes("execute"), false); assert.equal(f.calls.includes("prepare"), false); assert.equal(Object.keys((await f.repo.read("store-a")).executions).length, 0);
  } finally { await f.close(); }
});
test("MGA-67 rejecting a suggestion records rejection without executing any part of it", async () => {
  const f = await fixture(); try {
    const proposal = await f.service.create("store-a", f.campaign.id, { kind: "pause", after: {}, reasoning: "Hipotese", idempotencyKey: "pause-a" });
    const rejected = await f.service.reject("store-a", proposal.id, "owner-a"); assert.equal(rejected.status, "rejected"); assert.equal((await f.repo.read("store-a")).proposals[proposal.id].status, "rejected");
    assert.equal((await f.repo.getRecord<{ actorId: string }>("store-a", `proposal-rejection:${proposal.id}`))!.payload.actorId, "owner-a");
    await assert.rejects(f.service.approve("store-a", proposal.id, "owner-a", proposal.digest), { code: "proposal_not_pending" }); assert.equal(f.calls.includes("execute"), false);
  } finally { await f.close(); }
});
test("proposal content tampering and a changed connection cannot reuse an earlier review", async () => {
  const f = await fixture(); try {
    const proposal = await f.service.create("store-a", f.campaign.id, { kind: "budget", after: { budget: { ...f.campaign.draft.budget!, amountCents: 2500 } }, reasoning: "Teste", idempotencyKey: "budget-a" });
    await f.repo.mutate("store-a", [], state => { (state.proposals[proposal.id].after.budget as { amountCents: number }).amountCents = 9900; return { result: null }; });
    await assert.rejects(f.service.approve("store-a", proposal.id, "owner-a", proposal.digest), { code: "proposal_version_changed" });
    const other = await f.service.create("store-a", f.campaign.id, { kind: "pause", after: {}, reasoning: "Teste", idempotencyKey: "pause-a" });
    await f.connection.disconnect("store-a"); await assert.rejects(f.service.approve("store-a", other.id, "owner-a", other.digest), { code: "proposal_stale" });
  } finally { await f.close(); }
});
test("proposal action fields are typed and unknown operations fail before provider reads", async () => {
  const f = await fixture(); try {
    let reads = 0; const original = f.provider.snapshot; f.provider.snapshot = async (...args) => { reads++; return original(...args); };
    await assert.rejects(f.service.create("store-a", f.campaign.id, { kind: "activate-everything" as never, after: {}, reasoning: "No", idempotencyKey: "bad-kind" }), { code: "meta_action_invalid" });
    await assert.rejects(f.service.create("store-a", f.campaign.id, { kind: "pause", after: { status: "ACTIVE", arbitrary_tool: "publish" }, reasoning: "No", idempotencyKey: "bad-fields" }), { code: "proposal_fields_invalid" });
    assert.equal(reads, 0); assert.equal(f.calls.includes("execute"), false);
  } finally { await f.close(); }
});

test("a remote campaign without its recorded ad-account binding cannot be reviewed against another connection", async () => {
  const f = await fixture(); try {
    let reads = 0; f.provider.snapshot = async () => { reads++; throw new Error("must not query a foreign object"); };
    await f.repo.mutate("store-a", [], state => { state.campaigns[f.campaign.id].remoteAccountId = null; return { result: null }; });
    await assert.rejects(f.service.create("store-a", f.campaign.id, { kind: "pause", after: {}, reasoning: "Scope", idempotencyKey: "unbound-a" }), { code: "meta_asset_forbidden", status: 403 });
    assert.equal(reads, 0);
  } finally { await f.close(); }
});

test("proposal review snapshots bind stock separately from a reusable image commercial version", async () => {
  const f = await fixture(); try {
    const before = await f.service.create("store-a", f.campaign.id, { kind: "pause", after: {}, reasoning: "Antes", idempotencyKey: "stock-before" });
    const campaign = await f.campaigns.owned("store-a", f.campaign.id); const oldProduct = campaign.products[0];
    f.commerce.products = async () => [{ ...oldProduct, stockQuantity: oldProduct.stockQuantity! - 1 }];
    const saved = await f.campaigns.save("store-a", campaign.id, campaign.draft);
    const after = await f.service.create("store-a", campaign.id, { kind: "pause", after: {}, reasoning: "Depois", idempotencyKey: "stock-after" });
    assert.notEqual(before.productVersions[oldProduct.variantId], after.productVersions[oldProduct.variantId]);
    assert.equal(saved.draft.mediaIds[0], "media-a"); assert.equal((await f.repo.read("store-a")).credits.monthlyAvailable, 30);
  } finally { await f.close(); }
});

test("a merchant can review a new pause after stock runs out while launch remains blocked", async () => {
  const f = await fixture(); try {
    const campaign = await f.campaigns.owned("store-a", f.campaign.id);
    f.commerce.products = async () => [{ ...campaign.products[0], stockQuantity: 0 }];
    const proposal = await f.service.create("store-a", campaign.id, { kind: "pause", after: {}, reasoning: "Sem estoque", idempotencyKey: "pause-empty" });
    assert.equal((proposal.before.productState as Array<{ stockQuantity: number }>)[0].stockQuantity, 0);
    assert.equal((await f.service.approve("store-a", proposal.id, "owner-a", proposal.digest)).status, "approved");
    await assert.rejects(f.service.create("store-a", campaign.id, { kind: "publish", after: {}, reasoning: "No", idempotencyKey: "publish-empty" }), { code: "campaign_products_unavailable" });
    assert.equal(f.calls.includes("execute"), false);
  } finally { await f.close(); }
});
