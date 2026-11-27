import assert from 'node:assert/strict';
import {readdir,readlink,readFile} from 'node:fs/promises';

const invalid=()=>{throw Error('construction_native_tcp_output_invalid');};
const inode=value=>typeof value==='string'&&/^[1-9][0-9]{0,19}$/.test(value)&&BigInt(value)<=0xffffffffffffffffn;
function stableOwnedInodes(before,after){
  assert.ok(before instanceof Map&&after instanceof Map,'construction_native_tcp_fd_snapshot_required');
  const values=new Set();for(const [fd,value] of before){
    assert.ok(typeof fd==='string'&&/^\d+$/.test(fd)&&inode(value),'construction_native_tcp_fd_invalid');
    if(after.get(fd)===value)values.add(value);
  }return values;
}
function endpoint(raw){
  const match=/^([A-Fa-f0-9]{8}):([A-Fa-f0-9]{4})$/.exec(raw);if(!match)invalid();
  const bytes=Buffer.from(match[1],'hex'),port=parseInt(match[2],16);if(port<1||port>65535)invalid();
  return{address:[bytes[3],bytes[2],bytes[1],bytes[0]].join('.'),port};
}
/** /proc/self/net/tcp describes the namespace, not ownership. A row is admitted
 * only if the SAME current-process fd owns its inode before AND after the read.
 * Duplicated native rows remain duplicated so the consumer rejects ambiguity. */
export function parseOwnedLinuxTcpRows(text,before,after){
  if(typeof text!=='string'||Buffer.byteLength(text)>1_000_000||text.includes('\0'))invalid();
  const lines=text.split(/\r?\n/);if(!/^\s*sl\s+local_address\s+rem_address\s+st\s+/.test(lines.shift()??''))invalid();
  const owned=stableOwnedInodes(before,after),rows=[];
  for(const line of lines){
    if(!line.trim())continue;const fields=line.trim().split(/\s+/);
    if(fields.length<10||!/^\d+:$/.test(fields[0])||!/^[A-Fa-f0-9]{2}$/.test(fields[3])||!/^\d+$/.test(fields[9]))invalid();
    if(fields[3]!=='01'||!owned.has(fields[9]))continue;
    const local=endpoint(fields[1]),remote=endpoint(fields[2]);
    rows.push({LocalAddress:local.address,LocalPort:local.port,RemoteAddress:remote.address,RemotePort:remote.port,OwningProcess:process.pid,State:'Established'});
  }return rows;
}
async function snapshot(){
  const names=await readdir('/proc/self/fd');assert.ok(names.length<=16384,'construction_native_tcp_fd_snapshot_bound');
  const entries=[];
  for(const fd of names){if(!/^\d+$/.test(fd))continue;
    let link;try{link=await readlink('/proc/self/fd/'+fd);}catch(error){if(error?.code==='ENOENT')continue;throw error;}
    const match=/^socket:\[([^\]]+)\]$/.exec(link);if(!match)continue;
    assert.ok(inode(match[1]),'construction_native_tcp_fd_invalid');entries.push([fd,match[1]]);
  }return new Map(entries);
}
export async function readOwnedLinuxTcpRows(){
  assert.equal(process.platform,'linux','construction_native_tcp_evidence_linux_only');
  const controller=new AbortController();let timer;
  try{return await Promise.race([(async()=>{
    const before=await snapshot(),text=await readFile('/proc/self/net/tcp',{encoding:'utf8',signal:controller.signal}),after=await snapshot();
    return parseOwnedLinuxTcpRows(text,before,after);
  })(),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('construction_native_tcp_probe_failed'));},10_000);})]);}
  catch{throw Error('construction_native_tcp_probe_failed');}finally{clearTimeout(timer);}
}
