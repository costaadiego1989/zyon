import {test} from 'node:test';
import assert from 'node:assert/strict';
import {campaignName} from './campaign-name.js';
import {normalizeCampaignDraft} from './campaign-draft.js';

const product={name:'Fone sem fio'};
test('campaign names identify product objective and destination in plain language',()=>{
 const goals={paid_sales:'Mais vendas',cost_per_purchase:'Menor custo por compra',roas:'Retorno em vendas',contribution:'Resultado da loja'} as const;
 for(const priority of Object.keys(goals) as Array<keyof typeof goals>)for(const destination of ['store','whatsapp'] as const){
  assert.equal(campaignName({products:[product],priority,destination}),`Fone sem fio · ${goals[priority]} · ${destination==='store'?'Loja':'WhatsApp'}`);
 }
});
test('custom and previously saved generic campaign names are preserved',()=>{
 for(const name of ['Oferta escolhida pelo cliente','Campanha da loja'])assert.equal(campaignName({name,products:[product],priority:'paid_sales',destination:'store'}),name);
});
test('empty names use a product based name and multiple products stay identifiable',()=>{
 assert.equal(campaignName({name:'  ',products:[product,{name:'Câmera'},{name:'Adaptador'}],priority:'roas',destination:'store'}),'Fone sem fio + 2 produtos · Retorno em vendas · Loja');
});
test('generated Unicode campaign names fit the canonical draft name limit',()=>{
 const suffix=' · Mais vendas · WhatsApp',prefix='🧳'.repeat(200);
 const name=campaignName({products:[{name:prefix}],priority:'paid_sales',destination:'whatsapp'});
 assert.equal(name,'🧳'.repeat(Math.floor((120-suffix.length-1)/2))+'…'+suffix);
 assert.equal(normalizeCampaignDraft({name,destination:'whatsapp',priority:'paid_sales',variantIds:['v1'],budget:null,mediaIds:[],headline:'Mochila',primaryText:'Conheça o produto',country:'BR'}).name,name);
});
test('an automatic campaign name requires an identified product',()=>{
 assert.throws(()=>campaignName({products:[],priority:'paid_sales',destination:'store'}),{code:'campaign_products_required'});
});
