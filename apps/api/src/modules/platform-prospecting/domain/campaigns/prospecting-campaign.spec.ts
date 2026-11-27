import { test } from "node:test";
import assert from "node:assert/strict";
import { validateLimits, campaignContentHash, campaignTransition } from "./prospecting-campaign.js";
test("PROS-12 AC1 preparation requires explicit positive daily recipients and positive integer BRL cents",()=>{
 assert.throws(()=>validateLimits(undefined),/dailyRecipients,budget/);
 for(const dailyRecipients of [0,-1,0.5,NaN,Infinity]) assert.throws(()=>validateLimits({dailyRecipients,budget:{currency:"BRL",amountCents:1}}),/dailyRecipients/);
 for(const budget of [{currency:"USD",amountCents:2},{currency:"BRL",amountCents:0},{currency:"BRL",amountCents:2.5}]) assert.throws(()=>validateLimits({dailyRecipients:2,budget}),/budget/);
 const valid={dailyRecipients:2,budget:{currency:"BRL",amountCents:100}};
 assert.deepEqual(validateLimits(valid),valid);
 assert.equal(campaignTransition("approved","start",true,[]),"running");
 assert.equal(campaignTransition("running","pause",false,["no_opt_in"]),"paused");
 assert.throws(()=>campaignTransition("paused","resume",true,["provider_policy_blocked"]),/provider_policy_blocked/);
 assert.throws(()=>campaignTransition("approved","start",false,[]),/approval_stale/);
 const review={message:"A",offer:{planKey:"p"},senderBindingId:"sender",senderVersion:3,template:null,audienceHash:"hash",sendWindow:{timezone:"UTC"},limits:valid};
 for(const change of [{message:"B"},{offer:{planKey:"q"}},{senderVersion:4},{audienceHash:"new"},{sendWindow:{timezone:"America/Sao_Paulo"}},{limits:{...valid,dailyRecipients:3}}])
   assert.notEqual(campaignContentHash(review),campaignContentHash({...review,...change}));
});
