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
  console.info('t54_close_diagnostic',JSON.stringify({observedAt:new Date().toISOString(),pid:process.pid,error:operatorDiagnosticError(error)}));
}
