import assert from 'node:assert/strict';
import {test} from 'node:test';
import {campaignApprovalDatabase} from '../infrastructure/__tests__/campaign-approval-database.js';
import {MetaAdsError} from '../domain/types.js';
import {CampaignNoticeContactService,CAMPAIGN_NOTICE_CONSENT_VERSION} from './campaign-notice-contact.service.js';

async function fixture(){
  const db=await campaignApprovalDatabase();let role=true,now=new Date('2026-11-17T12:00:00Z');
  const service=new CampaignNoticeContactService({db:db.prisma,clock:()=>now,senderNumber:async()=>'+5511999990000',authorizeActor:async(merchantId,actorId)=>{
    if(!role||!((merchantId==='store-a'&&['owner-a','admin-a'].includes(actorId))||(merchantId==='store-b'&&actorId==='owner-b')))throw new MetaAdsError('meta_ads_role_forbidden',403);
  }});
  const input={phoneNumber:'+55 (11) 98888-7777',consented:true,expectedVersion:0};
  return {...db,service,input,role:(value:boolean)=>{role=value;},advance:()=>{now=new Date(now.getTime()+60000);}};
}
test('ACAP-24 an existing commercial contact does not opt into campaign readiness notices',async()=>{
  const f=await fixture();try{
    await f.sql.query('ALTER TABLE merchants ADD COLUMN budget_whatsapp TEXT');await f.sql.query("UPDATE merchants SET budget_whatsapp='+5511988887777' WHERE id='store-a'");
    assert.deepEqual(await f.service.read('store-a','owner-a'),{phoneNumber:null,consented:false,consentVersion:null,consentedAt:null,version:0,updatedAt:null});
    assert.equal((await f.sql.query('SELECT count(*) FROM meta_ads_campaign_notice_contacts')).rows[0].count,'0');
  }finally{await f.close();}
});
test('ACAP-24 explicit consent persists normalized phone purpose actor time and an immutable audit without a full phone',async()=>{
  const f=await fixture();try{
    const saved=await f.service.save('store-a','owner-a',f.input);assert.deepEqual(saved,{phoneNumber:'+5511988887777',consented:true,consentVersion:CAMPAIGN_NOTICE_CONSENT_VERSION,consentedAt:'2026-11-17T12:00:00.000Z',version:1,updatedAt:'2026-11-17T12:00:00.000Z'});
    assert.deepEqual(await f.service.read('store-a','admin-a'),saved);
    const row=await f.prisma.metaAdsCampaignNoticeContact.findUniqueOrThrow({where:{merchantId:'store-a'}});assert.equal(row.consentedBy,'owner-a');
    const audit=await f.prisma.metaAdsAgentRecord.findFirstOrThrow({where:{merchantId:'store-a',key:'campaign-notice-contact:1'}});assert.equal(audit.kind,'audit');assert.deepEqual(audit.payload,{action:'campaign_notice_contact_changed',actorId:'owner-a',version:1,consented:true,consentVersion:CAMPAIGN_NOTICE_CONSENT_VERSION,phoneChanged:true,changedAt:'2026-11-17T12:00:00.000Z'});assert.equal(JSON.stringify(audit.payload).includes('5511988887777'),false);
  }finally{await f.close();}
});
test('ACAP-24 saving a phone without consent never fabricates permission',async()=>{
  const f=await fixture();try{
    const saved=await f.service.save('store-a','owner-a',{...f.input,consented:false});assert.equal(saved.consented,false);assert.equal(saved.phoneNumber,'+5511988887777');assert.equal(saved.consentVersion,null);assert.equal(saved.consentedAt,null);
    assert.equal((await f.prisma.metaAdsCampaignNoticeContact.findUniqueOrThrow({where:{merchantId:'store-a'}})).consentedBy,null);
  }finally{await f.close();}
});
test('ACAP-24 revocation clears permission and updates the version without changing another store',async()=>{
  const f=await fixture();try{
    await f.service.save('store-a','owner-a',f.input);const other=await f.service.save('store-b','owner-b',{...f.input,phoneNumber:'+5511977776666'});f.advance();
    const revoked=await f.service.save('store-a','admin-a',{phoneNumber:'+5511988887777',consented:false,expectedVersion:1});assert.equal(revoked.version,2);assert.equal(revoked.consented,false);assert.equal(revoked.consentedAt,null);assert.equal(revoked.consentVersion,null);assert.equal(revoked.updatedAt,'2026-11-17T12:01:00.000Z');assert.deepEqual(await f.service.read('store-b','owner-b'),other);
  }finally{await f.close();}
});
test('ACAP-24 invalid international numbers missing recipients and self-send addresses do not persist',async()=>{
  const f=await fixture();try{
    for(const phoneNumber of ['11988887777','+012345678','+5511not-a-phone','+1234567890123456'])await assert.rejects(f.service.save('store-a','owner-a',{...f.input,phoneNumber}),{code:'campaign_notice_phone_invalid'});
    await assert.rejects(f.service.save('store-a','owner-a',{...f.input,phoneNumber:null}),{code:'campaign_notice_contact_required'});
    await assert.rejects(f.service.save('store-a','owner-a',{...f.input,phoneNumber:'+55 (11) 99999-0000'}),{code:'campaign_notice_self_recipient'});
    assert.equal((await f.sql.query('SELECT count(*) FROM meta_ads_campaign_notice_contacts')).rows[0].count,'0');assert.equal((await f.sql.query('SELECT count(*) FROM meta_ads_agent_records')).rows[0].count,'0');
  }finally{await f.close();}
});
test('ACAP-24 a revoked role foreign store or client-selected actor cannot read or change consent',async()=>{
  const f=await fixture();try{
    await f.service.save('store-a','owner-a',f.input);await assert.rejects(f.service.read('store-a','owner-b'),{code:'meta_ads_role_forbidden'});await assert.rejects(f.service.save('store-b','owner-a',f.input),{code:'meta_ads_role_forbidden'});
    await assert.rejects(f.service.save('store-a','owner-a',{...f.input,actorId:'admin-a'} as never),{code:'campaign_notice_contact_invalid'});f.role(false);await assert.rejects(f.service.read('store-a','owner-a'),{code:'meta_ads_role_forbidden'});await assert.rejects(f.service.save('store-a','owner-a',{...f.input,expectedVersion:1,consented:false}),{code:'meta_ads_role_forbidden'});
    assert.equal((await f.prisma.metaAdsCampaignNoticeContact.findUniqueOrThrow({where:{merchantId:'store-a'}})).version,1);
  }finally{await f.close();}
});
test('ACAP-24 two administrators cannot overwrite each others concurrent consent version',async()=>{
  const f=await fixture();try{
    const results=await Promise.allSettled([f.service.save('store-a','owner-a',f.input),f.service.save('store-a','admin-a',{...f.input,phoneNumber:'+5511977776666'})]);assert.equal(results.filter(result=>result.status==='fulfilled').length,1);const rejected=results.find(result=>result.status==='rejected') as PromiseRejectedResult;assert.equal(rejected.reason.code,'campaign_notice_contact_changed');
    assert.equal((await f.prisma.metaAdsCampaignNoticeContact.findUniqueOrThrow({where:{merchantId:'store-a'}})).version,1);assert.equal((await f.prisma.metaAdsAgentRecord.count({where:{merchantId:'store-a'}})),1);
  }finally{await f.close();}
});
test('ACAP-24 unchanged saves do not renew consent while changed recipients require a new version and actor',async()=>{
  const f=await fixture();try{
    const original=await f.service.save('store-a','owner-a',f.input);f.advance();assert.deepEqual(await f.service.save('store-a','owner-a',{...f.input,expectedVersion:1}),original);
    const changed=await f.service.save('store-a','admin-a',{...f.input,phoneNumber:'+5511977776666',expectedVersion:1});assert.equal(changed.version,2);assert.equal(changed.phoneNumber,'+5511977776666');assert.equal(changed.consentedAt,'2026-11-17T12:01:00.000Z');assert.equal((await f.prisma.metaAdsCampaignNoticeContact.findUniqueOrThrow({where:{merchantId:'store-a'}})).consentedBy,'admin-a');
  }finally{await f.close();}
});
test('ACAP-24 an audit failure rolls back consent and deleted stores cannot recreate a contact',async()=>{
  const f=await fixture();try{
    await f.sql.query("ALTER TABLE meta_ads_agent_records ADD CONSTRAINT reject_contact_audit_for_test CHECK (key NOT LIKE 'campaign-notice-contact:%')");await assert.rejects(f.service.save('store-a','owner-a',f.input));assert.equal((await f.sql.query('SELECT count(*) FROM meta_ads_campaign_notice_contacts')).rows[0].count,'0');
    await f.sql.query("DELETE FROM merchants WHERE id='store-a'");await assert.rejects(f.service.save('store-a','owner-a',f.input),{code:'merchant_not_found'});
  }finally{await f.close();}
});
