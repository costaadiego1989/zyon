import assert from "node:assert/strict";
import { test } from "node:test";
import { createProspectCrmFixture } from "../../../../../tests/prospect-crm-fixture.js";
import { FreezeCampaignAudience } from "./freeze-campaign-audience.js";
import { PrismaAudienceRepository } from "../../infrastructure/campaigns/prisma-audience.repository.js";
test("PROS-07 AC3 whole saved-segment results freeze across bounded work, deduplicating shared endpoints without losing companies",async()=>{
 const f=await createProspectCrmFixture(); const actor={operatorId:"operator",correlationId:"freeze"};
 try {
   const segment=await f.prisma.savedProspectSegment.create({data:{name:"all",filterJson:{},ownerOperatorId:"operator"}});
   const campaign=await f.prisma.prospectCampaign.create({data:{name:"synthetic",message:"offer",senderBindingId:"sender",senderVersion:1,sendWindow:{},createdBy:"operator"}});
   const repo=new PrismaAudienceRepository(f.prisma,{currentVersion:1,keys:{1:"a".repeat(64)}});
   const freeze=new FreezeCampaignAudience(repo);
   const cmd={clientRequestId:"freeze",expectedRevision:1,snapshotId:"search-old",segmentId:segment.id,segmentVersion:1};
   const accepted=await freeze.enqueue(campaign.id,cmd,actor);
   assert.equal(accepted.state,"pending"); assert.deepEqual(await freeze.enqueue(campaign.id,cmd,actor),accepted);
   await f.prisma.savedProspectSegment.update({where:{id:segment.id},data:{filterJson:{ufs:["RJ"]},version:2}});
   await freeze.processNext(1); assert.notEqual((await freeze.poll(accepted.selectionId))?.state,"complete");
   for(let i=0;i<5;i++)await freeze.processNext(1);
   const result=await freeze.poll(accepted.selectionId);
   assert.equal(result?.state,"complete"); assert.equal(result?.companyCount,3); assert.equal(result?.recipientCount,1); assert.equal(result?.missingEndpointCount,1); assert.match(result!.audienceHash!,/^[a-f0-9]{64}$/);
   assert.deepEqual(result?.eligibilityBlockers,[{reason:"no_opt_in",recipients:1},{reason:"provider_policy_blocked",recipients:1}]);
   assert.equal(await f.prisma.platformProspect.count(),3); assert.equal(await f.prisma.prospectContactBinding.count(),2);
   const recipient=await f.prisma.campaignRecipient.findFirstOrThrow(); assert.equal(recipient.eligibility,"no_opt_in"); assert.deepEqual(recipient.blockers,["no_opt_in","provider_policy_blocked"]);
   assert.equal(await f.prisma.contactPermissionReceipt.count(),0); assert.equal((await f.prisma.prospectCampaign.findUniqueOrThrow({where:{id:campaign.id}})).audienceHash,result?.audienceHash);
   assert.equal(await freeze.processNext(1),null); assert.deepEqual(await freeze.poll(accepted.selectionId),result);
 } finally {await f.close();}
});
test("PROS-07 AC3 freeze waits for the privacy fence and sees the committed erasure before deriving any contact",async()=>{
 const f=await createProspectCrmFixture();
 try{
  const lead=await f.prisma.platformProspect.create({data:{cnpj:"00000000000191",sourceSnapshotId:"search-old"}});
  const c=await f.prisma.prospectCampaign.create({data:{name:"race",message:"test",senderBindingId:"sender",senderVersion:1,sendWindow:{},createdBy:"operator"}});
  const freeze=new FreezeCampaignAudience(new PrismaAudienceRepository(f.prisma,{currentVersion:1,keys:{1:"a".repeat(64)}}));
  const job=await freeze.enqueue(c.id,{snapshotId:"search-old",cnpjs:[lead.cnpj],expectedRevision:1,clientRequestId:"freeze-race"},{operatorId:"operator",correlationId:"freeze-race"});
  const retention=await f.pg.connect();
  let waiting=false;
  try{
   await retention.query("BEGIN");
   const locked=await retention.query("SELECT pg_backend_pid() AS holder FROM platform_prospects WHERE id=$1 FOR UPDATE",[lead.id]);
   const work=freeze.processNext(1);
   try{
    // Observe fresh activity on a different connection while retention owns the lead.
    for(let i=0;i<150&&!waiting;i++){
     const res=await f.pg.query(`SELECT EXISTS (
       SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid))
       AND query LIKE '%FROM platform_prospects%FOR UPDATE%'
     ) AS waiting`,[locked.rows[0].holder]);
     waiting=res.rows[0].waiting;
     if(!waiting)await new Promise(resolve=>setTimeout(resolve,10));
    }
    await retention.query("UPDATE platform_prospects SET pii_discarded_at=now(),stage='do_not_contact' WHERE id=$1",[lead.id]);
    await retention.query("COMMIT");
   }finally{await retention.query("ROLLBACK");await work;}
  }finally{retention.release();}
  assert.equal(waiting,true,"freeze took the same row fence as retention");
  assert.equal((await freeze.poll(job.selectionId))?.missingEndpointCount,1);
  assert.equal(await f.prisma.prospectContactBinding.count(),0);assert.equal(await f.prisma.prospectEndpoint.count(),0);
 }finally{await f.close();}
});
