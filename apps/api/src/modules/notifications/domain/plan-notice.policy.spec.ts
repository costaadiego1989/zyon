import test from "node:test";
import assert from "node:assert/strict";
import { billingTerm, planMilestone, planNoticeId, isCurrentPlanNotice, planNoticeContent } from "./plan-notice.policy.js";
import { buildCatalog } from "../../whatsapp-templates/domain/catalog/template-catalog.js";
import { prepareSalesWhatsApp } from "../../whatsapp-templates/domain/sales-template-content.js";
const now = new Date("2026-09-14T12:00:00Z"), day = 86_400_000;
const row = { merchantId: "m1", status: "active", provider: "asaas", planKey: "growth", currentPeriodEnd: new Date(now.getTime()+7*day),
  trialEndsAt: null, stripeSubscriptionId: null, asaasSubscriptionId: "sub1", createdAt: now };
test("plan milestones use exact rolling deadlines at 7d, 3d, 24h and expiry", () => {
  for (const [offset, expected] of [[7*day+1,null],[7*day,"7d"],[3*day+1,"7d"],[3*day,"3d"],[day+1,"3d"],[day,"24h"],[1,"24h"],[0,"expired"],[-day,"expired"]] as const) {
    assert.equal(planMilestone(new Date(now.getTime()+offset), now), expected);
  }
  assert.equal(planMilestone(new Date("bad"), now), null);
});
test("renewal, a changed subscription, plan change or tenant invalidates an old notice", () => {
  const term = billingTerm(row)!; const notice = { ...term, id: planNoticeId(term,"7d"), milestone: "7d" };
  assert.equal(isCurrentPlanNotice(notice,row,now),true);
  for (const update of [{ currentPeriodEnd: new Date(now.getTime()+37*day) }, { asaasSubscriptionId: "sub2" }, { planKey: "scale" }, { merchantId: "m2" }]) {
    assert.equal(isCurrentPlanNotice(notice,{...row,...update},now),false);
  }
  assert.equal(isCurrentPlanNotice(notice,row,new Date(now.getTime()+5*day)),false);
});
test("trial termination still produces one expired notice after downgrade to starter", () => {
  const trial = { ...row, status: "trialing", asaasSubscriptionId: null, currentPeriodEnd: null, trialEndsAt: now };
  const active = billingTerm(trial)!;
  const expired = billingTerm({ ...trial, status: "starter" })!;
  assert.deepEqual(expired,active);
  assert.equal(planMilestone(expired.endsAt,now),"expired");
  assert.equal(billingTerm({...row,status:"incomplete"}),null);
});
test("notice identity is stable per subscription deadline and new periods get new identities", () => {
  const term = billingTerm(row)!;
  assert.equal(planNoticeId(term,"7d"),planNoticeId(term,"7d"));
  assert.notEqual(planNoticeId(term,"7d"),planNoticeId(term,"3d"));
  assert.notEqual(planNoticeId(term,"7d"),planNoticeId({...term,endsAt:new Date(now.getTime()+37*day)},"7d"));
  assert.match(planNoticeContent({...term,milestone:"expired"}).body,/Growth.*21\/09\/2026/);
});
test("all four plan templates have utility copy, resolved variables and can enter the existing lifecycle", () => {
  const catalog = buildCatalog("Minha loja");
  for (const milestone of ["7d","3d","24h","expired"] as const) {
    const type = `plan_expiry_${milestone}` as const;
    const definition = catalog[type];
    const prepared = prepareSalesWhatsApp(type,definition.freeformBody);
    assert.equal(prepared.category,"UTILITY");
    assert.equal(definition.hasCoupon,false);
    assert.deepEqual(Object.values(prepared.variableMap),["merchantName","planName","expiresAt","dashboardLink"]);
    assert.ok(!/\{\{[a-z]/i.test(prepared.metaBody));
    assert.ok(!/\{\{[a-z]/i.test(definition.metaBody));
  }
});
