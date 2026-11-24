import assert from 'node:assert/strict';
const record=value=>value&&typeof value==='object'&&!Array.isArray(value);
const text=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.length<=max;
const list=(value,max,length)=>Array.isArray(value)&&value.length>=1&&value.length<=length&&value.every(item=>text(item,max));
const allowed={list_categories:[],compare_products:['productId','productIds','productName','productNames','includeSimilar'],get_reviews:['productId','filter','limit','cursor']};
/** Private selection/envelope only. Original advertised tool Zod schema and
 * original executable/canonical tenant read remain the fact authority. */
export function validateProductReadToolCall(raw){
  assert.ok(record(raw)&&Object.keys(raw).every(key=>['name','args','contextText'].includes(key)));
  assert.ok(Object.hasOwn(allowed,raw.name)&&record(raw.args)&&text(raw.contextText,500));
  assert.ok(Object.keys(raw.args).every(key=>allowed[raw.name].includes(key)));const a=raw.args;
  if(raw.name==='get_reviews')assert.ok(text(a.productId,191));
  for(const key of ['productId'])if(a[key]!==undefined)assert.ok(text(a[key],191));
  if(a.productIds!==undefined)assert.ok(list(a.productIds,191,5));
  if(a.productName!==undefined)assert.ok(text(a.productName,500));if(a.productNames!==undefined)assert.ok(list(a.productNames,500,5));
  if(a.includeSimilar!==undefined)assert.equal(typeof a.includeSimilar,'boolean');
  if(a.filter!==undefined)assert.ok(['positive','negative','recent'].includes(a.filter));
  if(a.limit!==undefined)assert.ok(Number.isInteger(a.limit)&&a.limit>=1&&a.limit<=50);
  if(a.cursor!==undefined)assert.ok(typeof a.cursor==='string'&&a.cursor.length<=2048);
  return structuredClone(raw);
}
export function createProductReadWireMessage(raw,body){
  const call=validateProductReadToolCall(raw);
  assert.ok((body.tools??[]).some(tool=>tool.type==='function'&&tool.function?.name===call.name&&tool.function.parameters?.type==='object'),'product_read_tool_must_be_announced');
  assert.ok((body.messages??[]).some(message=>['user','assistant'].includes(message.role)&&typeof message.content==='string'&&message.content.includes(call.contextText)),'product_read_context_required');
  return{role:'assistant',content:null,tool_calls:[{id:'synthetic-product-read',type:'function',function:{name:call.name,arguments:JSON.stringify(call.args)}}]};
}