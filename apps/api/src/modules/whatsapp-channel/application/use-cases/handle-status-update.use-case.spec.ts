import test from 'node:test';
import assert from 'node:assert/strict';
import { HandleStatusUpdateUseCase } from './handle-status-update.use-case.js';

test('failed media receipt retains only a numeric provider code and stays scoped to the known message', async () => {
  const saved: any = {phase:'complete',presentation:{messages:[{type:'image'}]},sent:[{index:0,messageId:'wamid.known'}]};
  let writes=0;
  const tx: any = {$queryRaw: async(sql:any)=> { assert.ok(sql.values.includes('merchant')); assert.ok(sql.values.includes('config')); return [{response_state:saved,status:'completed'}]; },
    $executeRaw:async(sql:any)=>{writes++;const json=sql.values.find((v:any)=>typeof v==='string'&&v.startsWith('{'));assert.equal(JSON.parse(json).receipts[0].errorCode,131053);return 1;}};
  const uc = new HandleStatusUpdateUseCase({$transaction:async(fn:any)=>fn(tx)} as any);
  const input={merchantId:'merchant',configId:'config',messageId:'wamid.known',status:'failed',correlationId:'zyon:turn:0',timestamp:'123',errorCode:131053};
  await uc.receiveMetaReceipt(input);assert.equal(writes,1);assert.deepEqual(saved.receipts[0],{messageId:'wamid.known',status:'failed',timestamp:'123',errorCode:131053});
  await uc.receiveMetaReceipt({...input,messageId:'wamid.foreign'});assert.equal(writes,1);
});

test('a failed media receipt cannot recover an uncertain send or authorize dispatch continuation', async () => {
  const saved:any={phase:'dispatching',dispatchingIndex:0,presentation:{messages:[{type:'image'}]},sent:[]};
  const uc=new HandleStatusUpdateUseCase({$transaction:async(fn:any)=>fn({$queryRaw:async()=>[{response_state:saved,status:'dead'}],$executeRaw:async()=>1})} as any);
  await uc.receiveMetaReceipt({merchantId:'merchant',configId:'config',messageId:'wamid',status:'failed',correlationId:'zyon:turn:0',errorCode:131053});
  assert.equal(saved.phase,'dispatching');assert.deepEqual(saved.sent,[]);
});
