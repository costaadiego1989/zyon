import {randomUUID} from 'node:crypto';
import {prepareAttendanceFixtures} from './service-attendance-fixture.mjs';

const sql=value=>"'"+String(value).replaceAll("'","''")+"'";
/** Real owned preconditions; no category, product or availability response stubs. */
export async function prepareCategoryFixtures(runtime){
  const prepared=await prepareAttendanceFixtures(runtime),owner=prepared.scenarios.get('services-owner'),products=prepared.scenarios.get('products-owner');
  const request=async(f,path,method='GET',body)=>{
    const response=await fetch(runtime.apiOrigin+path,{method,signal:AbortSignal.timeout(10000),headers:{authorization:'Bearer '+f.access_token,...(method==='GET'?{}:{'idempotency-key':randomUUID()}),...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const value=await response.json();if(response.status!==(method==='POST'?201:200))throw Error('synthetic_category_precondition_failed:'+response.status);return value;
  };
  const linked=JSON.parse(await runtime.db.sql(`SELECT json_build_object('productId',p.id,'productName',p.name,'variantId',v.id) FROM professional_services l JOIN products p ON p.id=l.product_id AND p.merchant_id=l.merchant_id JOIN product_variants v ON v.product_id=p.id WHERE l.merchant_id=${sql(owner.merchant_id)} AND l.professional_id=${sql(owner.professionalId)} AND l.is_active ORDER BY v.id LIMIT 1;`));
  // The empty category state is a declared real fixture. Deletion unlinks the
  // same canonical offer; it does not remove the offer or professional links.
  await request(owner,`/merchants/${owner.merchant_id}/categories/${owner.categoryId}`,'DELETE');
  const second=await request(owner,`/merchants/${owner.merchant_id}/service-professionals`,'POST',{publicName:'Beatriz · Categorias local',timeZone:'America/Sao_Paulo',isPublished:true,productIds:[linked.productId]});
  const foreign=await request(products,`/merchants/${products.merchant_id}/categories`,'POST',{name:'Categoria de produtos local',slug:'t77-products-'+randomUUID()});
  for(const fixture of prepared.fixtures.values())Object.assign(fixture,linked,{secondProfessionalId:second.id,secondProfessionalName:second.publicName,foreignCategoryId:foreign.id,foreignCategoryMerchantId:products.merchant_id});
  return prepared;
}

export function installCategoryFixture(vite,runtime,prepared){
  vite.middlewares.use((request,response,next)=>{
    const seed=/^\/__service\/categories\/(services-owner|products-owner|services-staff)$/.exec(request.url??'');
    const snapshot=/^\/__service\/categories\/([a-f0-9-]{36})\/snapshot$/.exec(request.url??'');
    if(!((seed&&request.method==='POST')||(snapshot&&request.method==='GET')))return next();
    void(async()=>{
      if(seed){const fixture=prepared.scenarios.get(seed[1]);if(!fixture){response.statusCode=404;response.end('unknown_owned_fixture');return;}response.setHeader('content-type','application/json');response.end(JSON.stringify(fixture));return;}
      const fixture=prepared.fixtures.get(snapshot[1]);if(!fixture){response.statusCode=404;response.end('unknown_owned_fixture');return;}
      const merchant=sql(fixture.merchant_id),value=await runtime.db.sql(`SELECT jsonb_build_object(
        'categories',coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM product_categories c WHERE merchant_id=${merchant}),'[]'::jsonb),
        'products',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM products p WHERE merchant_id=${merchant}),'[]'::jsonb),
        'variants',coalesce((SELECT jsonb_agg(to_jsonb(v) ORDER BY v.id) FROM product_variants v JOIN products p ON p.id=v.product_id WHERE p.merchant_id=${merchant}),'[]'::jsonb),
        'prices',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM product_prices r JOIN product_variants v ON v.id=r.variant_id JOIN products p ON p.id=v.product_id WHERE p.merchant_id=${merchant}),'[]'::jsonb),
        'professionals',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM service_professionals p WHERE merchant_id=${merchant}),'[]'::jsonb),
        'policy',(SELECT to_jsonb(p) FROM service_business_policies p WHERE merchant_id=${merchant}),
        'links',coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM professional_services l WHERE merchant_id=${merchant}),'[]'::jsonb),
        'rows',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM professional_availability a WHERE merchant_id=${merchant}),'[]'::jsonb),
        'exceptions',coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM availability_exceptions e WHERE merchant_id=${merchant}),'[]'::jsonb),
        'users',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'role',role) ORDER BY id) FROM merchant_users WHERE merchant_id=${merchant}),'[]'::jsonb),
        'foreignCategory',(SELECT to_jsonb(c) FROM product_categories c WHERE merchant_id=${sql(fixture.foreignCategoryMerchantId)} AND id=${sql(fixture.foreignCategoryId)}));`);
      response.setHeader('content-type','application/json');response.end(JSON.stringify(JSON.parse(value)));
    })().catch(()=>{response.statusCode=500;response.end('synthetic_category_fixture_failed');});
  });
}
