import assert from 'node:assert/strict';
import {Redis} from 'ioredis';
import {createRequire} from 'node:module';

const data=(object,field)=>object&&Object.getOwnPropertyDescriptor(object,field)?.value;
// Redis.mode is the installed SDK's public getter, not an arbitrary DI getter.
const modeGetter=Object.getOwnPropertyDescriptor(Redis.prototype,'mode')?.get;
assert.equal(typeof modeGetter,'function','journey_known_ioredis_mode_getter_required');
const SubscriptionSet=createRequire(import.meta.url)('ioredis/built/SubscriptionSet').default;
const sdkRequire=createRequire(createRequire(import.meta.url).resolve('ioredis'));
const Command=sdkRequire('./Command').default,Deque=sdkRequire('denque');
const queueValues=Object.getOwnPropertyDescriptor(Deque.prototype,'toArray')?.value;
assert.equal(typeof queueValues,'function');
const channels=Object.getOwnPropertyDescriptor(SubscriptionSet.prototype,'channels')?.value;
const isEmpty=Object.getOwnPropertyDescriptor(SubscriptionSet.prototype,'isEmpty')?.value;
assert.equal(typeof channels,'function');assert.equal(typeof isEmpty,'function');
function state(client){
  assert.ok(client instanceof Redis,'journey_actual_ioredis_client_required');
  assert.equal(Object.getOwnPropertyDescriptor(client,'mode'),undefined,'journey_redis_mode_shadow_forbidden');
  assert.equal(data(client,'status'),'ready','journey_redis_ping_client_not_ready');
  const conditionDescriptor=Object.getOwnPropertyDescriptor(client,'condition');
  assert.ok(conditionDescriptor&&'value' in conditionDescriptor,'journey_redis_condition_data_descriptor_required');
  const condition=conditionDescriptor.value;
  assert.ok(condition&&typeof condition==='object','journey_redis_connection_condition_required');
  const subscriberDescriptor=Object.getOwnPropertyDescriptor(condition,'subscriber');
  assert.ok(subscriberDescriptor&&'value' in subscriberDescriptor,'journey_redis_subscriber_data_descriptor_required');
  const subscriber=subscriberDescriptor.value,mode=modeGetter.call(client);
  assert.ok(mode==='normal'||mode==='subscriber','journey_redis_ping_mode_unsupported');
  if(mode==='normal'){
    assert.equal(subscriber,false,'journey_normal_redis_cannot_claim_subscriptions');
    return{mode,condition,subscriber,subscriptions:null};
  }
  // The actual SDK exposes its acknowledged subscription set on condition.
  // A mode label alone does not prove an active subscription.
  assert.ok(subscriber instanceof SubscriptionSet,
    'journey_actual_redis_subscription_set_required');
  for(const field of ['channels','isEmpty'])assert.equal(Object.getOwnPropertyDescriptor(subscriber,field),undefined,
    'journey_subscription_method_shadow_forbidden');
  const set=data(subscriber,'set');assert.ok(set&&typeof set==='object','journey_subscription_data_required');
  for(const kind of ['subscribe','psubscribe','ssubscribe']){
    const entries=data(set,kind);assert.ok(entries&&typeof entries==='object','journey_subscription_data_required');
    assert.ok(Object.values(Object.getOwnPropertyDescriptors(entries)).every(descriptor=>'value' in descriptor&&descriptor.value===true),
      'journey_subscription_data_descriptor_required');
  }
  assert.equal(isEmpty.call(subscriber),false,'journey_active_redis_subscription_required');
  const subscriptions=Object.fromEntries(['subscribe','psubscribe','ssubscribe'].map(kind=>{
    const names=channels.call(subscriber,kind);assert.ok(Array.isArray(names));
    assert.ok(names.every(name=>typeof name==='string'),'journey_subscription_channel_required');
    assert.equal(new Set(names).size,names.length,'journey_subscription_set_duplicate');
    return[kind,[...names].sort()];
  }));
  assert.ok(Object.values(subscriptions).some(names=>names.length>0),'journey_active_redis_subscription_required');
  return{mode,condition,subscriber,subscriptions};
}
function pendingSubscriptionAcks(client){
  const promises=new Set();
  for(const field of ['commandQueue','offlineQueue']){
    const queue=data(client,field);assert.ok(queue instanceof Deque,'journey_actual_redis_command_queue_required');
    for(const entry of queueValues.call(queue)){
      const command=data(entry,'command');assert.ok(command instanceof Command,'journey_actual_redis_command_required');
      if(!['subscribe','psubscribe','ssubscribe','unsubscribe','punsubscribe','sunsubscribe'].includes(data(command,'name')))continue;
      const promise=data(command,'promise');assert.ok(promise instanceof Promise,'journey_actual_subscription_ack_promise_required');
      promises.add(promise);
    }
  }
  return [...promises];
}

/** Same real PING and five-second budget. Only the Redis RESP representation
 * for a proven, stable subscription differs from an ordinary connection. */
export async function assertOwnedJourneyRedisPing(client){
  assert.ok(client instanceof Redis,'journey_actual_ioredis_client_required');
  const deadline=Date.now()+5000;let timer;
  const work=(async()=>{
    // connect()/ready precede SUBSCRIBE acknowledgements in ioredis. Await
    // the genuine already-issued command promises before freezing the mode.
    // No sleep, replay or additional command is introduced by this wait.
    for(let pending=pendingSubscriptionAcks(client);pending.length;pending=pendingSubscriptionAcks(client)){
      await Promise.all(pending);
      if(Date.now()>=deadline)throw Error('journey_owned_redis_ping_timeout');
    }
    if(Date.now()>=deadline)throw Error('journey_owned_redis_ping_timeout');
    const before=state(client),reply=await client.ping(),after=state(client);
    assert.equal(after.mode,before.mode,'journey_redis_mode_changed_during_ping');
    assert.equal(after.condition,before.condition,'journey_redis_condition_changed_during_ping');
    assert.equal(after.subscriber,before.subscriber,'journey_redis_subscription_identity_changed_during_ping');
    assert.deepEqual(after.subscriptions,before.subscriptions,'journey_redis_subscriptions_changed_during_ping');
    if(before.mode==='normal')assert.equal(reply,'PONG');
    else assert.deepEqual(reply,['pong',''],'journey_exact_redis_subscriber_pong_required');
    return before.mode;
  })();
  try{return await Promise.race([work,new Promise((_,reject)=>{
    timer=setTimeout(()=>reject(Error('journey_owned_redis_ping_timeout')),5000);
  })]);}finally{clearTimeout(timer);}
}
