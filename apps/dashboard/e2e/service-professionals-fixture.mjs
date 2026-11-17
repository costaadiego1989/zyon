import {randomUUID} from 'node:crypto';
import {prepareAttendanceFixtures} from './service-attendance-fixture.mjs';
import {appointment,insert} from '../../api/tests/service-migration-fixture.mjs';

const sql=value=>"'"+String(value).replaceAll("'","''")+"'";
/** Dedicated T76 owned preconditions. No UI response stubs or booking endpoint. */
export async function prepareProfessionalFixtures(runtime){
  const prepared=await prepareAttendanceFixtures(runtime),owner=prepared.scenarios.get('services-owner');
  const request=async(path,method='GET',body,token=owner.access_token)=>{
    const response=await fetch(runtime.apiOrigin+path,{method,signal:AbortSignal.timeout(10000),headers:{...(token?{authorization:'Bearer '+token}:{}),...(body===undefined?{}:{'content-type':'application/json','idempotency-key':randomUUID()})},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const data=await response.json();if(response.status!==(method==='POST'?201:200))throw Error('synthetic_professional_precondition_failed:'+response.status);return data;
  };
  const linked=JSON.parse(await runtime.db.sql(`SELECT json_build_object('productId',p.id,'productName',p.name,'variantId',v.id) FROM professional_services l JOIN products p ON p.id=l.product_id AND p.merchant_id=l.merchant_id JOIN product_variants v ON v.product_id=p.id WHERE l.merchant_id=${sql(owner.merchant_id)} AND l.professional_id=${sql(owner.professionalId)} AND l.is_active ORDER BY v.id LIMIT 1;`));
  const second=await request(`/merchants/${owner.merchant_id}/products`,'POST',{name:'Acompanhamento local T76',type:'service',categoryId:owner.categoryId,metadata:{serviceType:'presencial',serviceSchedule:{timeZone:'America/Sao_Paulo',durationMinutes:60,slots:[]}},variants:[{sku:'t76-'+randomUUID(),basePriceInCents:6500}]});
  const policy=await request('/merchants/me/service-business-policy','PUT',{expectedVersion:1,holdEnabled:false,holdMinutes:null,paymentMode:'at_attendance',admissionsEnabled:true});
  if(policy.status!=='configured'||policy.policy.paymentMode!=='at_attendance')throw Error('synthetic_professional_policy_required');
  const foreign=await request('/auth/register','POST',{merchant_name:'Empresa estrangeira sintética T76',email:'t76-foreign-'+randomUUID()+'@example.test',password:'SyntheticPassword123!',business_mode:'services'},null);
  const foreignProfessional=await request(`/merchants/${foreign.merchant_id}/service-professionals`,'POST',{publicName:'Profissional de outra empresa',timeZone:'America/Sao_Paulo'},foreign.access_token);
  const appointmentId=randomUUID(),paymentId=randomUUID(),now=new Date().toISOString();
  // Existing confirmed manual history under the actual configured policy.
  // This seeds a real canonical row, not a simulated reservation/API result.
  await runtime.db.sql(insert('service_appointments',appointment(appointmentId,{merchant_id:owner.merchant_id,professional_id:owner.professionalId,product_id:linked.productId,variant_id:linked.variantId,starts_at:'2030-01-07T11:00:00.000Z',ends_at:'2030-01-07T12:00:00.000Z',time_zone:'America/Sao_Paulo',duration_minutes:60,policy_version:policy.version,policy_snapshot:policy.policy,operational_status:'scheduled',confirmed_at:now,created_at:now,updated_at:now}))+
    insert('appointment_payments',{id:paymentId,merchant_id:owner.merchant_id,appointment_id:appointmentId,mode:'at_attendance',amount_cents:5000,currency:'BRL',status:'pending',idempotency_key:randomUUID(),request_fingerprint:randomUUID(),created_at:now,updated_at:now}));
  for(const fixture of prepared.fixtures.values())Object.assign(fixture,linked,{secondProductId:second.id,secondProductName:second.name,foreignProfessionalId:foreignProfessional.id,foreignServiceMerchantId:foreign.merchant_id,appointmentId,paymentId});
  return prepared;
}

export function installProfessionalFixture(vite,runtime,prepared){
  vite.middlewares.use((request,response,next)=>{
    const seed=/^\/__service\/professionals\/(services-owner|products-owner|services-staff)$/.exec(request.url??'');
    const snapshot=/^\/__service\/professionals\/([a-f0-9-]{36})\/snapshot$/.exec(request.url??'');
    if(!((seed&&request.method==='POST')||(snapshot&&request.method==='GET')))return next();
    void(async()=>{
      if(seed){const fixture=prepared.scenarios.get(seed[1]);if(!fixture){response.statusCode=404;response.end('unknown_owned_fixture');return;}response.setHeader('content-type','application/json');response.end(JSON.stringify(fixture));return;}
      const fixture=prepared.fixtures.get(snapshot[1]);if(!fixture){response.statusCode=404;response.end('unknown_owned_fixture');return;}
      const merchant=sql(fixture.merchant_id),value=await runtime.db.sql(`SELECT jsonb_build_object(
        'professionals',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM service_professionals p WHERE merchant_id=${merchant}),'[]'::jsonb),
        'links',coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM professional_services l WHERE merchant_id=${merchant}),'[]'::jsonb),
        'appointments',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM service_appointments a WHERE merchant_id=${merchant}),'[]'::jsonb),
        'payments',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM appointment_payments p WHERE merchant_id=${merchant}),'[]'::jsonb),
        'users',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'role',role) ORDER BY id) FROM merchant_users WHERE merchant_id=${merchant}),'[]'::jsonb),
        'prices',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM product_prices p JOIN product_variants v ON v.id=p.variant_id JOIN products o ON o.id=v.product_id WHERE o.merchant_id=${merchant}),'[]'::jsonb),
        'rows',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM professional_availability a WHERE merchant_id=${merchant}),'[]'::jsonb),
        'exceptions',coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM availability_exceptions e WHERE merchant_id=${merchant}),'[]'::jsonb),
        'foreignProfessional',(SELECT to_jsonb(p) FROM service_professionals p WHERE merchant_id=${sql(fixture.foreignServiceMerchantId)} AND id=${sql(fixture.foreignProfessionalId)}));`);
      response.setHeader('content-type','application/json');response.end(JSON.stringify(JSON.parse(value)));
    })().catch(()=>{response.statusCode=500;response.end('synthetic_professional_fixture_failed');});
  });
}
