// Failure-only local diagnostics. No writer, dispatch, retry or authority change.
const statuses=new Set(['queued','pending','processing','preparing','started','accepted','delivered','read','failed','unknown','dead']);
const status=value=>statuses.has(value)?value:null;
const instant=value=>value instanceof Date&&Number.isFinite(value.getTime())?value.toISOString():null;
const integer=value=>Number.isSafeInteger(value)&&value>=0?value:null;
const tags=['handoff_fixture_cleanup_failed','service_runtime_cleanup_failed','service_app_cleanup_failed',
  'service_app_close_timeout','service_close_ack_timeout','service_worker_natural_exit_required','service_worker_exit',
  'service_provider_attempt_forbidden','journey_owned_redis_capture_failed','journey_owned_redis_cleanup_failed',
  'construction_owned_redis_close_timeout','journey_owned_redis_disconnect_close_timeout','owned_native_worker_cleanup_timeout',
  'closing_capture','closing_app','closing_owned_clients','clients_ready','http_listening'];
const names=new Set(['Error','AggregateError','AssertionError','TypeError','PrismaClientKnownRequestError','PrismaClientInitializationError']);
const codes=new Set(['ERR_ASSERTION','ETIMEDOUT','ECONNRESET','ECONNREFUSED','P2028','P2010','57P01']);
export function operatorDiagnosticError(error){
  const seen=new Set();let remaining=6;
  const visit=(value,depth)=>{
    if(!value||typeof value!=='object'||seen.has(value)||depth>3||remaining===0)return;
    seen.add(value);remaining--;
    const message=typeof value.message==='string'?value.message.slice(0,8000):'';
    const result={name:names.has(value.name)?value.name:'OtherError',...(codes.has(value.code)?{code:value.code}:{}),
      tags:tags.filter(tag=>message.includes(tag)).slice(0,6)};
    const children=[...(Array.isArray(value.errors)?value.errors.slice(0,6):[]),...(value.cause?[value.cause]:[])];
    const causes=children.map(child=>visit(child,depth+1)).filter(Boolean);if(causes.length)result.causes=causes;
    return result;
  };
  return visit(error,0)??{name:'UnknownError',tags:[]};
}
async function relayMetrics(f){
  const response=await fetch(f.runtime.apiOrigin+'/metrics',{redirect:'error',signal:AbortSignal.timeout(1500),
    headers:{authorization:'Bearer '+f.ownerAuth.access_token}});
  if(!response.ok){await response.body?.cancel();return{httpStatus:response.status};}
  const body=await response.text();if(body.length>1_000_000)return{httpStatus:response.status,bounded:false};
  const values={};
  for(const field of ['outbox_relay_ready','outbox_relay_last_dispatch_timestamp_seconds']){
    const match=body.match(new RegExp('^'+field+' ([0-9.eE+\\-]+)$','m'));
    if(match&&Number.isFinite(Number(match[1])))values[field]=Number(match[1]);
  }
  return{httpStatus:response.status,...values};
}
export async function operatorTerminalDiagnostic(f,messageId){
  const diagnostic={stage:'terminal_wait_failed',observedAt:new Date().toISOString(),pid:process.pid};
  // Parameterized exact message scope; only non-sensitive projections leave SQL.
  try{
    const rows=await f.raw.$queryRaw`SELECT clock_timestamp() AS now,pg_backend_pid() AS pid,
      m.metadata->'delivery'->>'status' AS message_status,m.metadata->'delivery'->>'revision' AS revision,
      d.state AS receipt_state,d.response->'delivery'->>'status' AS receipt_status,
      d.response->'submission'->>'phase' AS submission_phase,d.created_at AS receipt_created_at,d.updated_at AS receipt_updated_at,
      o.status AS outbox_status,o.attempts,o.next_attempt_at,o.lease_expires_at,o.created_at AS outbox_created_at,o.delivered_at,
      (SELECT count(*)::int FROM outbox_handler_executions e WHERE e.event_id=o.event_id) AS processed_handlers
      FROM support_ticket_messages m JOIN support_tickets t ON t.id=m.ticket_id
      LEFT JOIN whatsapp_deliveries d ON d.id=${'support_message:'+messageId} AND d.merchant_id=t.merchant_id
      LEFT JOIN outbox_messages o ON o.causation_id=m.id AND o.merchant_id=t.merchant_id AND o.event_type='whatsapp.support.message.requested'
      WHERE m.id=${messageId} ORDER BY o.created_at LIMIT 4`;
    diagnostic.rows=rows.map(row=>({dbNow:instant(row.now),dbPid:integer(row.pid),messageStatus:status(row.message_status),
      revision:typeof row.revision==='string'&&/^\d{1,9}$/.test(row.revision)?Number(row.revision):null,
      receiptState:status(row.receipt_state),receiptStatus:status(row.receipt_status),submissionPhase:status(row.submission_phase),
      receiptCreatedAt:instant(row.receipt_created_at),receiptUpdatedAt:instant(row.receipt_updated_at),outboxStatus:status(row.outbox_status),
      attempts:integer(row.attempts),nextAttemptAt:instant(row.next_attempt_at),leaseExpiresAt:instant(row.lease_expires_at),
      outboxCreatedAt:instant(row.outbox_created_at),deliveredAt:instant(row.delivered_at),processedHandlers:integer(row.processed_handlers)}));
  }catch(error){diagnostic.sqlError=operatorDiagnosticError(error);}
  try{diagnostic.relay=await relayMetrics(f);}catch(error){diagnostic.metricsError=operatorDiagnosticError(error);}
  console.info('t54_terminal_diagnostic',JSON.stringify(diagnostic));
}
export function operatorCloseDiagnostic(error){
  try{observeProviderTrapFailure(error);}catch{}
  console.info('t54_close_diagnostic',JSON.stringify({observedAt:new Date().toISOString(),pid:process.pid,error:operatorDiagnosticError(error)}));
}

// Additive failure-only parent projection of the existing bounded worker suffix.
const MARKER='service_provider_attempt_forbidden:';
const MAX_CODE=8192,MAX_ITEM=4096,MAX_ATTEMPTS=3,MAX_FRAMES=6;

function frameLocation(value){
  if(typeof value!=='string'||value.length>1500)return;
  const frame=value.trim().replaceAll('\\','/'),result={};
  const prefix=frame.match(/^at (?:(?:async|new) )?([A-Za-z_$][A-Za-z0-9_$.]{0,95})(?: \(|$)/);
  if(prefix)result.function=prefix[1];
  const root='/apps/api/dist/',index=frame.lastIndexOf(root);
  if(index>=0){
    const location=frame.slice(index+root.length).replace(/\)$/,'');
    const match=location.match(/^([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*\.js):([1-9]\d{0,5})(?::\d{1,5})?$/);
    if(match&&match[1].split('/').every(segment=>segment!=='.'&&segment!=='..')){
      result.path='dist/'+match[1];result.line=Number(match[2]);
    }
  }
  return Object.keys(result).length?result:undefined;
}

function attempt(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||!['fetch','socket'].includes(value.kind)||!Array.isArray(value.frames))return;
  return{kind:value.kind,frames:value.frames.slice(0,MAX_FRAMES).map(frameLocation).filter(Boolean)};
}

function parseProviderTrapCode(code){
  try{
    if(typeof code!=='string')return[];
    const source=code.slice(0,MAX_CODE),marker=source.indexOf(MARKER);
    if(marker<0)return[];
    let begin=marker+MARKER.length;
    while(begin<source.length&&/\s/.test(source[begin]))begin++;
    if(source[begin]!=='[')return[];
    const result=[];let arrays=1,objects=0,start=-1,quoted=false,escaped=false;
    for(let index=begin+1;index<source.length&&result.length<MAX_ATTEMPTS;index++){
      const char=source[index];
      if(quoted){if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char==='"')quoted=false;continue;}
      if(char==='"'){quoted=true;continue;}
      if(char==='['){arrays++;continue;}
      if(char===']'){if(--arrays===0)break;continue;}
      if(char==='{'){if(objects===0&&arrays===1)start=index;objects++;continue;}
      if(char==='}'){
        if(--objects<0)break;
        if(objects===0&&start>=0){
          if(index-start+1<=MAX_ITEM){
            try{const parsed=attempt(JSON.parse(source.slice(start,index+1)));if(parsed)result.push(parsed);}catch{}
          }
          start=-1;
        }
      }
    }
    return result;
  }catch{return[];}
}

function providerTrapData(value){
  try{
    const messages=[],seen=new Set();let remaining=6;
    const visit=(item,depth)=>{
      if(remaining===0||depth>3||item==null)return;
      if(typeof item==='string'){remaining--;messages.push(item.slice(0,MAX_CODE));return;}
      if(typeof item!=='object'||seen.has(item))return;
      remaining--;seen.add(item);
      const children=[...(Array.isArray(item.errors)?item.errors.slice(0,6):[]),...(item.cause?[item.cause]:[])];
      for(const child of children)visit(child,depth+1);
      if(typeof item.message==='string')messages.push(item.message.slice(0,MAX_CODE));
    };
    visit(value,0);let matched=false;
    for(const message of messages){
      if(!message.includes(MARKER))continue;matched=true;
      const diagnostics=parseProviderTrapCode(message);if(diagnostics.length)return{matched,diagnostics};
    }
    return{matched,diagnostics:[]};
  }catch{return{matched:false,diagnostics:[]};}
}
export function extractProviderTrapFailure(value){
  try{return providerTrapData(value).diagnostics;}catch{return[];}
}
export function observeProviderTrapFailure(value){
  try{
    const result=providerTrapData(value);
    if(result.matched)console.info('t54_provider_trap_diagnostic',JSON.stringify(result.diagnostics));
  }catch{}
}
