const checks=new Set([
  'journey_owned_redis_ended_without_open_socket_required',
  'construction_redis_socket_identity_required',
  'construction_redis_socket_ownership_required',
  'journey_bounded_owned_disconnect_required',
  'journey_owned_redis_disconnect_close_timeout',
  'journey_owned_redis_disconnect_failed',
  'construction_owned_redis_close_timeout',
]);
const data=(object,key)=>object&&(typeof object==='object'||typeof object==='function')
  ?Object.getOwnPropertyDescriptor(object,key)?.value:undefined;

/** Failure-only static identifiers. Never serialize the original message,
 * assertion values, arbitrary getters or a caller-defined diagnostic field. */
export function journeyCleanupDiagnostic(error){
  const message=data(error,'message'),code=data(error,'code');
  const prefix=typeof message==='string'?message.match(/^([a-z_]+)(?=$|[\s:])/):null;
  return {...(prefix&&checks.has(prefix[1])?{checkCode:prefix[1]}:{}),
    ...(code==='ERR_ASSERTION'?{assertionCode:'ERR_ASSERTION'}:{})};
}
