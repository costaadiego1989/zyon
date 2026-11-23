import {test} from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {campaignContentHash} from "../../domain/campaigns/prospecting-campaign.js";
import {stableDirectoryJson} from "../../domain/company-directory/directory-values.js";
test("CAMP-05 review preserves legacy hash bytes while V2 context and offer policy change reviewed content identity",()=>{
 const legacy={message:"reviewed",offer:{planKey:"growth"},senderBindingId:"sender",senderVersion:1,template:{id:"body"},audienceHash:"members",sendWindow:{start:"09:00"},limits:{dailyRecipients:1}};
 assert.equal(campaignContentHash(legacy),createHash("sha256").update(stableDirectoryJson(legacy)).digest("hex"));assert.equal(campaignContentHash({...legacy,setupVersion:1,businessContext:"ignored legacy"}),campaignContentHash(legacy));
 const v2={...legacy,setupVersion:2,businessContext:"roupas SP",offerPolicy:{mode:"catalog"}};assert.notEqual(campaignContentHash(v2),campaignContentHash(legacy));assert.notEqual(campaignContentHash({...v2,businessContext:"roupas RJ"}),campaignContentHash(v2));assert.notEqual(campaignContentHash({...v2,offerPolicy:{mode:"fixed",planKey:"growth"}}),campaignContentHash(v2));
});
