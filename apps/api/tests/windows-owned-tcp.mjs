import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {isIP} from 'node:net';
import {win32} from 'node:path';

const invalid=()=>{throw Error('construction_native_tcp_output_invalid');};
function endpoint(value){
  const match=value.startsWith('[')?/^\[([^\]]+)\]:(\d{1,5})$/.exec(value):/^([^:]+):(\d{1,5})$/.exec(value);
  if(!match)invalid();
  const address=match[1],port=Number(match[2]),scoped=address.split('%');
  if(!Number.isInteger(port)||port<1||port>65535||scoped.length>2||scoped.length===2&&!/^\d+$/.test(scoped[1])
    ||isIP(scoped[0])!==(value.startsWith('[')?6:4)||scoped.length===2&&!value.startsWith('['))invalid();
  return{address,port};
}

/** Current-process established rows only. No mapped-address coercion, cached
 * output or duplicate suppression can supply a missing ownership proof. */
export function parseCurrentProcessEstablishedTcp(text){
  if(typeof text!=='string'||Buffer.byteLength(text,'utf8')>1_000_000||text.includes('\0'))invalid();
  const rows=[];
  for(const line of text.split(/\r?\n/)){
    const fields=line.trim().split(/\s+/);
    if(fields[0]!=='TCP')continue;
    if(fields.length!==5||!/^\d+$/.test(fields[4])||!Number.isSafeInteger(Number(fields[4]))||Number(fields[4])>0xffff_ffff)invalid();
    if(fields[4]!==String(process.pid))continue;
    if(fields[3]!=='ESTABLISHED')continue;
    const local=endpoint(fields[1]),remote=endpoint(fields[2]);
    rows.push({LocalAddress:local.address,LocalPort:local.port,RemoteAddress:remote.address,RemotePort:remote.port,
      OwningProcess:process.pid,State:'Established'});
  }
  return rows;
}

/** One fresh native numeric snapshot under the original CIM deadline. The
 * optional runner is for contract tests; the actual proof always uses execFile.
 * Error output is discarded because it can include unrelated OS connections. */
export async function readOwnedWindowsTcpRows(run=promisify(execFile)){
  assert.equal(process.platform,'win32','construction_native_tcp_evidence_windows_only');
  const root=process.env.SystemRoot??process.env.WINDIR;
  assert.ok(typeof root==='string'&&/^[A-Za-z]:[\\/]/.test(root)&&!/[\0\r\n]/.test(root),'construction_native_tcp_system_directory_required');
  let result;
  try{
    result=await run(win32.join(root,'System32','netstat.exe'),['-ano'],
      {windowsHide:true,shell:false,timeout:10_000,maxBuffer:1_000_000,encoding:'utf8'});
  }catch(cause){
    const error=Error('construction_native_tcp_probe_failed');
    if(typeof cause?.code==='string'&&/^[A-Za-z0-9_]{1,60}$/.test(cause.code))error.code=cause.code;
    error.killed=cause?.killed===true;
    if(['SIGTERM','SIGKILL'].includes(cause?.signal))error.signal=cause.signal;
    throw error;
  }
  return parseCurrentProcessEstablishedTcp(result?.stdout);
}
