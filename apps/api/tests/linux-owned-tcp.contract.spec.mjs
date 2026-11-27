import assert from 'node:assert/strict';
import test from 'node:test';
import {parseOwnedLinuxTcpRows} from './linux-owned-tcp.mjs';

const header='  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt uid timeout inode\n';
const row=' 0: 0100007F:C001 0100007F:18EB 01 00000000:00000000 00:00000000 00000000 1000 0 9001';
const owned=new Map([['12','9001']]);
test('Linux TCP proof requires stable current-process fd/inode ownership and exact established tuple',()=>{
  assert.deepEqual(parseOwnedLinuxTcpRows(header+row,owned,owned),[{LocalAddress:'127.0.0.1',LocalPort:49153,RemoteAddress:'127.0.0.1',RemotePort:6379,OwningProcess:process.pid,State:'Established'}]);
});
test('Linux TCP proof cannot borrow a foreign namespace row or a moved/reused fd',()=>{
  for(const after of [new Map(),new Map([['13','9001']]),new Map([['12','9002']])])assert.deepEqual(parseOwnedLinuxTcpRows(header+row,owned,after),[]);
  assert.deepEqual(parseOwnedLinuxTcpRows(header+row.replace('9001','9002'),owned,owned),[]);
});
test('Linux TCP proof preserves duplicate rows and excludes listening/closed states',()=>{
  assert.equal(parseOwnedLinuxTcpRows(header+row+'\n'+row,owned,owned).length,2);
  for(const state of ['0A','06','08'])assert.deepEqual(parseOwnedLinuxTcpRows(header+row.replace(' 01 ',' '+state+' '),owned,owned),[]);
});
test('Linux TCP proof refuses malformed bytes, tuples, bounds and ownership snapshots',()=>{
  for(const value of ['',header+row.replace('0100007F:C001','wrong'),header+row.replace('0100007F:C001','0100007F:0000'),header+'\0',header+'x'.repeat(1_000_001)])
    assert.throws(()=>parseOwnedLinuxTcpRows(value,owned,owned));
  assert.throws(()=>parseOwnedLinuxTcpRows(header+row,new Map([['../12','9001']]),owned));
});
