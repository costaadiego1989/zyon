const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../src');
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };
const plain = value => JSON.parse(JSON.stringify(value));
const financial = cartId => [
  {type:'cart_summary',data:{cartId,items:[],total:10}},
  {type:'checkout_prepared',data:{actionId:'action',cartId,shippingPreference:'fastest',paymentPreference:'pix'}},
  {type:'cross_sell',data:{products:[{id:'product'}],displayMode:'modal'}},
];

// Actual hook and handler; deterministic scheduler and deferred synthetic IO.
// This is source-level lifecycle proof, not React DOM/server/payment proof.
function runtime(options={}) {
  const modules=new Map(), storage=new Map(), creates=[], sends=[], greetings=[], captures=[], projections=[], nudges=[];
  let fireNudge;
  let current, cart={cartId:options.cartId??null,itemCount:options.cartId?1:0}, revision=0;
  const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
  const react={
    useState(initial){const owner=current,i=owner.index++; const cell=owner.hooks[i]??=( {value:typeof initial==='function'?initial():initial});
      return [cell.value,value=>{if(!owner.mounted)owner.lateWrites++;const commit=()=>{cell.value=typeof value==='function'?value(cell.value):value;};
        if(owner.deferFunctional&&typeof value==='function')owner.updates.push(commit);else commit();}];},
    useRef(value){return current.hooks[current.index++]??={current:value};},
    useCallback(fn,deps){const i=current.index++,cell=current.hooks[i];if(cell&&same(cell.deps,deps))return cell.value;current.hooks[i]={deps,value:fn};return fn;},
    useMemo(fn,deps){const i=current.index++,cell=current.hooks[i];if(cell&&same(cell.deps,deps))return cell.value;const value=fn();current.hooks[i]={deps,value};return value;},
    useEffect(fn,deps){const owner=current,i=owner.index++,cell=owner.hooks[i];if(!cell||!same(cell.deps,deps))owner.effects.push(()=>{cell?.cleanup?.();owner.hooks[i]={deps,effect:fn,cleanup:fn()};});},
  };
  const experiment={captureFromConversationStart(){},setExperimentGreeting:(...args)=>greetings.push(args),getTrackingVariantId:()=>null,getExperimentGreeting:()=>null,experiment:null};
  const api={create:async input=>{creates.push(input);return options.create?options.create(input,creates.length):{conversation_id:'conversation-'+input.merchantId};},
    sendMessage:async(id,text,input)=>{sends.push({id,text,input});return options.send?options.send(id,text,input,sends.length):{message:'confirmed',blocks:[]};}};
  const cartContext={get cart(){return cart;},clearCart(){},updateItemQuantity:async()=>{},updateFromBlocks:blocks=>{projections.push(plain(blocks));revision++;},
    captureConversationCartProjection(scope){captures.push({...scope});const captured=revision,capturedCartId=cart.cartId;return blocks=>{
      if(captured!==revision||(capturedCartId!==null&&capturedCartId!==(scope.cartId??scope.conversationId)))return false;
      const summaries=blocks.filter(b=>b.type==='cart_summary');
      if(summaries.length&&summaries[0].data.cartId!==(scope.cartId??scope.conversationId))return false;
      cartContext.updateFromBlocks(blocks);return true;
    };}};
  const context=vm.createContext({console,Date,Promise,setTimeout,clearTimeout,sessionStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},process:{env:{}}});
  const stubs={react,'@/lib/api/api-client':{checkoutApi:api},'@/lib/buyer-auth':{getValidBuyer:()=>null},
    '@/lib/conversation-access':{ConversationSessionExpiredError:class extends Error{},conversationAccessHeaders:()=>({Authorization:'Bearer synthetic-proof'}),ensureConversationAccess:async id=>options.access?.(id),conversationAccessMatchesCurrentOrigin:()=>true,forgetConversationAccess(){}},
    '@/lib/storefront-read-ui-action':{cloneStorefrontReadUiAction:value=>value,assertStorefrontReadUiAction(){}},
    '@/lib/storefront-suggested-read-actions':{parseSuggestedReadActions:()=>null},
    '@/lib/widget-config':{useWidgetConfig:()=>({config:{}})},'@/lib/cart-store':{useCart:()=>cartContext},
    '@/lib/useCheckoutExperiment':{useCheckoutExperiment:()=>experiment},
    '@/lib/intervention-tracker':{noteActivity(){},canFireTrigger(){return false;},recordTriggerFired(){}},
    '@/lib/analytics':{trackConversationStart(){}},
    '@/lib/services/conversation.service':{narrateStorefrontBlock:()=> 'updated',trackFunnelEvent(){},restoreConversation:()=>null,saveConversationState:(merchant,key,value)=>storage.set(key(merchant),JSON.stringify(value)),buildWelcomeMessage:()=>({role:'agent',text:'welcome'}),applyThemeToDOM(){},restoreChannelPreference:()=>null,saveChannelPreference(){},restoreThemePreference:()=>null,saveThemePreference(){}},
    './effects':{useNudgeTriggers(_,__,fire){fireNudge=fire;},useProactiveMode(){},useReturnOrderTracking(){}},
    './conversation-nudge.handlers':{handleFireNudge:params=>{nudges.push(params);if(!options.nudgeAdmission||options.nudgeAdmission(params,nudges.length))params.onAdmitted?.();}},
  };
  function load(file){if(modules.has(file))return modules.get(file).exports;const module={exports:{}};modules.set(file,module);
    const source=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    vm.runInContext(`(function(require,module,exports){${source}\n})`,context)(id=>{if(Object.hasOwn(stubs,id))return stubs[id];
      if(id.startsWith('@/'))return load(id.slice(2)+'.ts');throw Error('unexpected dependency '+id);},module,module.exports);return module.exports;}
  const handler=load('lib/handlers/conversation.handlers.ts');
  function mount(merchant='merchant-a') {const owner={hooks:[],effects:[],updates:[],deferFunctional:false,index:0,mounted:true,lateWrites:0,merchant};
    owner.render=(next=owner.merchant)=>{owner.merchant=next;current=owner;owner.index=0;owner.value=load('lib/viewmodels/useConversationViewModel/hook.ts').useConversationViewModel({merchantId:next,storeName:next});current=null;for(const effect of owner.effects.splice(0))effect();return owner.value;};
    owner.flushUpdates=()=>{for(const commit of owner.updates.splice(0))commit();};
    owner.replayEffects=()=>{const cells=owner.hooks.filter(cell=>cell?.effect);for(const cell of cells)cell.cleanup?.();for(const cell of cells)cell.cleanup=cell.effect();owner.render();};
    owner.unmount=()=>{for(const cell of owner.hooks)cell?.cleanup?.();owner.mounted=false;};owner.render();return owner;}
  return {handler,mount,creates,sends,greetings,captures,projections,storage,nudges,nudge:()=>fireNudge('idle_30_seconds'),setCart(value){cart=value;revision++;},settle:async()=>{for(let i=0;i<30;i++)await Promise.resolve();}};
}
function handlerFixture(f,overrides={}){let active=true;const state={messages:[],history:[],loading:[],offers:[],prepared:[],projections:[]};
 const params={trimmed:'hello',conversationId:'conversation-a',merchantId:'merchant-a',cartId:'conversation-a',history:[],setConversationId(){},clearCart(){},
 setMessages:fn=>state.messages=fn(state.messages),setHistory:value=>state.history=typeof value==='function'?value(state.history):value,setIsLoading:value=>state.loading.push(value),setInput(){},setCrossSellPending:value=>state.offers.push(value),setProductCrossSell:value=>state.offers.push(value),updateFromBlocks:blocks=>state.projections.push(blocks),noteActivity(){},onCheckoutPrepared:value=>state.prepared.push(value),isCurrent:()=>active,applyCartProjection:blocks=>{state.projections.push(blocks);return true;},...overrides};
 return {state,params,invalidate(){active=false;}};}

for(const failure of [false,true])test(`late ${failure?'error':'success'} cannot project transcript/loading/offers after scope replacement`,async()=>{
 const barrier=deferred(),f=runtime({send:()=>barrier.promise}),h=handlerFixture(f);const pending=f.handler.handleSendMessage(h.params);await f.settle();assert.equal(f.sends.length,1);h.invalidate();
 const before=plain(h.state);failure?barrier.reject(Error('synthetic')):barrier.resolve({message:'late',blocks:financial('cart-a')});await pending;
 assert.deepEqual(plain(h.state),before);
});
test('stale cart projection filters financial blocks but preserves current transcript/history',async()=>{
 const f=runtime({send:async()=>({message:'legitimate',blocks:[...financial('conversation-a'),{type:'product_card',data:{id:'p'}}]})}),h=handlerFixture(f,{applyCartProjection:()=>false});
 const result=await f.handler.handleSendMessage(h.params);assert.equal(h.state.messages.at(-1).text,'legitimate');assert.equal(h.state.history.at(-1).content,'legitimate');
 assert.deepEqual(plain(result.blocks).map(b=>b.type),['product_card']);assert.equal(h.state.offers.length,0);assert.equal(h.state.prepared.length,0);assert.equal(h.state.projections.length,0);
});
test('missing projection capability cannot fall back to unguarded cart updates',async()=>{
 const f=runtime({send:async()=>({message:'text',blocks:financial('conversation-a')})}),h=handlerFixture(f,{applyCartProjection:undefined});await f.handler.handleSendMessage(h.params);
 assert.equal(h.state.projections.length,0);assert.equal(h.state.offers.length,0);assert.equal(h.state.prepared.length,0);assert.equal(h.state.messages.at(-1).text,'text');
});
test('own accepted cart summary keeps transcript, prepared checkout and history',async()=>{
 const f=runtime({send:async()=>({message:'confirmed',blocks:financial('conversation-a')})}),h=handlerFixture(f);await f.handler.handleSendMessage(h.params);
 assert.equal(h.state.projections.length,1);assert.equal(h.state.prepared.length,1);assert.equal(h.state.offers.length,1);assert.equal(h.state.messages.at(-1).text,'confirmed');assert.equal(h.state.history.at(-1).content,'confirmed');
});
test('late bootstrap adoption after merchant replacement is ignored',async()=>{
 const first=deferred(),f=runtime({create:(input)=>input.merchantId==='merchant-a'?first.promise:Promise.resolve({conversation_id:'conversation-b'})});const owner=f.mount();owner.render('merchant-b');await f.settle();
 first.resolve({conversation_id:'conversation-a',experiment:{system_prompt:'synthetic'}});await f.settle();const state=owner.render();assert.equal(state.conversationId,'conversation-b');assert.equal(f.sends.length,0);owner.unmount();
});
test('late greeting after merchant replacement cannot update the new experiment',async()=>{
 const greeting=deferred(),f=runtime({create:async input=>({conversation_id:input.merchantId,experiment:{system_prompt:'synthetic'}}),send:()=>greeting.promise});const owner=f.mount();await f.settle();owner.render('merchant-b');await f.settle();
 greeting.resolve({message:'late greeting'});await f.settle();assert.equal(f.greetings.length,1,'only the current merchant greeting is admitted');owner.unmount();
});
test('unmount ignores late bootstrap and does not start a greeting',async()=>{
 const start=deferred(),f=runtime({create:()=>start.promise}),owner=f.mount();owner.unmount();start.resolve({conversation_id:'late',experiment:{system_prompt:'synthetic'}});await f.settle();assert.equal(owner.lateWrites,0);assert.equal(f.sends.length,0);
});
test('hook captures public conversation identity but never dispatches a mismatched latest cart',async()=>{
 const start=deferred(),f=runtime({create:()=>start.promise,send:async()=>({message:'confirmed',blocks:financial('cart-b')})}),owner=f.mount();const pending=owner.value.sendMessage('buy');
 f.setCart({cartId:'cart-b',itemCount:1});owner.render();start.resolve({conversation_id:'conversation-a'});await pending;await f.settle();
 assert.deepEqual(f.captures,[]);assert.equal(f.sends.length,0);
 assert.equal(f.projections.length,0);assert.ok(!owner.render().messages.some(message=>message.text==='confirmed'));owner.unmount();
});

test('a cart replaced during access renewal cannot acquire the pending buyer draft',async()=>{
 const access=deferred(),f=runtime({access:()=>access.promise}),owner=f.mount();await f.settle();owner.render();
 const turn=owner.value.sendMessage('pending private draft');await f.settle();assert.equal(f.sends.length,0);
 f.setCart({cartId:'other-cart',itemCount:1});owner.render();access.resolve();await turn;
 assert.equal(f.sends.length,0);assert.equal(f.projections.length,0);assert.ok(!owner.render().messages.some(message=>message.role==='user'));owner.unmount();
});
test('old send completion cannot release the newer merchant send token',async()=>{
 const a=deferred(),b=deferred(),f=runtime({send:(id)=>id.endsWith('merchant-a')?a.promise:b.promise}),owner=f.mount();await f.settle();owner.render();const old=owner.value.sendMessage('old');await f.settle();
 owner.render('merchant-b');await f.settle();owner.render();const next=owner.value.sendMessage('new');await f.settle();a.resolve({message:'obsolete',blocks:[]});await old;
 assert.equal(await owner.render().sendMessage('duplicate'),null);assert.equal(f.sends.length,2);b.resolve({message:'current',blocks:[]});await next;assert.equal(owner.render().messages.at(-1).text,'current');owner.unmount();
});
test('old init finally cannot release newer pending initialization',async()=>{
 const a=deferred(),b=deferred(),f=runtime({create:input=>input.merchantId==='merchant-a'?a.promise:b.promise}),owner=f.mount();owner.render('merchant-b');await f.settle();a.resolve({conversation_id:'a'});await f.settle();owner.render();const waiting=owner.value.ensureConversation();await f.settle();
 assert.equal(f.creates.length,2);b.resolve({conversation_id:'b'});assert.equal(await waiting,'b');owner.unmount();
});
test('unmounted pending send ignores success and loading finalizer',async()=>{
 const pending=deferred(),f=runtime({send:()=>pending.promise}),owner=f.mount();await f.settle();owner.render();const turn=owner.value.sendMessage('hello');await f.settle();owner.unmount();pending.resolve({message:'late',blocks:financial('cart-a')});await turn;assert.equal(owner.lateWrites,0);assert.equal(f.projections.length,0);
});
test('merchant switch cannot persist previous transcript under the new merchant',async()=>{
 const f=runtime(),owner=f.mount();await f.settle();owner.render();await owner.value.sendMessage('secret-a');owner.render();owner.render('merchant-b');await f.settle();owner.render();
 assert.ok(!String(f.storage.get('zyon_conversation_state_merchant-b')).includes('secret-a'));assert.equal(owner.value.messages.length,0);owner.unmount();
});
test('deferred React functional updaters remain valid after the owning send finally',async()=>{
 const f=runtime({cartId:'conversation-merchant-a',send:async()=>({message:'confirmed',blocks:financial('conversation-merchant-a')})}),owner=f.mount();await f.settle();owner.render();owner.deferFunctional=true;
 assert.ok(await owner.value.sendMessage('buy'));assert.ok(owner.updates.length>=4);assert.equal(owner.render().isLoading,false);
 owner.flushUpdates();const result=owner.render();assert.deepEqual(plain(result.messages).map(message=>message.text),['buy','confirmed']);assert.equal(result.preparedCheckout.actionId,'action');
 const saved=JSON.parse(f.storage.get('zyon_conversation_state_merchant-a'));assert.deepEqual(saved.messages.map(message=>message.text),['buy','confirmed']);assert.equal(f.projections.length,1);owner.unmount();
});
test('deferred React updaters captured before merchant replacement cannot leak afterward',async()=>{
 const f=runtime(),owner=f.mount();await f.settle();owner.render();owner.deferFunctional=true;await owner.value.sendMessage('private-a');
 owner.render('merchant-b');await f.settle();owner.flushUpdates();const result=owner.render();assert.deepEqual(plain(result.messages),[]);assert.ok(!String(f.storage.get('zyon_conversation_state_merchant-b')).includes('private-a'));owner.unmount();
});
test('StrictMode cleanup/setup does not reactivate a late initializer or release the new token',async()=>{
 const old=deferred(),fresh=deferred(),f=runtime({create:(_,index)=>index===1?old.promise:fresh.promise}),owner=f.mount();owner.replayEffects();assert.equal(f.creates.length,2);
 old.resolve({conversation_id:'detached',experiment:{system_prompt:'synthetic'}});await f.settle();const wait=owner.render().ensureConversation();await f.settle();assert.equal(f.creates.length,2);assert.equal(f.sends.length,0);
 fresh.resolve({conversation_id:'current'});assert.equal(await wait,'current');assert.equal(owner.render().conversationId,'current');assert.equal(f.storage.get('zyon_conversation_id'),'current');owner.unmount();
});
test('StrictMode preserves the created identity without replaying an uncertain greeting',async()=>{
 const old=deferred(),fresh=deferred(),f=runtime({create:async(_,index)=>({conversation_id:'conversation-'+index,experiment:{system_prompt:'synthetic'}}),send:(_,__,___,index)=>index===1?old.promise:fresh.promise}),owner=f.mount();await f.settle();owner.replayEffects();await f.settle();
 assert.equal(f.creates.length,1);assert.equal(f.sends.length,1,'effect replay cannot repeat an uncertain greeting POST');
 old.resolve({message:'detached greeting'});await f.settle();assert.equal(f.greetings.length,0);fresh.resolve({message:'not dispatched'});await f.settle();assert.equal(f.greetings.length,0);assert.equal(owner.render().conversationId,'conversation-1');owner.unmount();
});
test('merchant ABA cannot revive first-generation initialization',async()=>{
 const old=deferred(),f=runtime({create:(input,index)=>index===1?old.promise:Promise.resolve({conversation_id:'current-'+input.merchantId})}),owner=f.mount();owner.render('merchant-b');owner.render('merchant-a');await f.settle();
 old.resolve({conversation_id:'obsolete-a',experiment:{system_prompt:'synthetic'}});await f.settle();assert.equal(owner.render().conversationId,'current-merchant-a');assert.equal(f.sends.length,0);owner.unmount();
});
test('late handler fallback create cannot adopt or send into a replaced scope',async()=>{
 const start=deferred(),f=runtime({create:()=>start.promise}),h=handlerFixture(f,{conversationId:null,cartId:null});let adopted=0;h.params.setConversationId=()=>adopted++;
 const turn=f.handler.handleSendMessage(h.params);h.invalidate();const before=plain(h.state);start.resolve({conversation_id:'late'});assert.equal(await turn,null);assert.equal(adopted,0);assert.equal(f.sends.length,0);assert.deepEqual(plain(h.state),before);
});
test('external cart revision while send is pending filters finances but retains current reply',async()=>{
 const pending=deferred(),id='conversation-merchant-a',f=runtime({cartId:id,send:()=>pending.promise}),owner=f.mount();await f.settle();owner.render();const turn=owner.value.sendMessage('buy');await f.settle();
 f.setCart({cartId:id,itemCount:2});owner.render();pending.resolve({message:'legitimate response',blocks:financial(id)});await turn;const result=owner.render();assert.equal(result.messages.at(-1).text,'legitimate response');assert.deepEqual(plain(result.messages.at(-1).blocks),[]);assert.equal(result.preparedCheckout,null);assert.equal(result.crossSellPending,null);assert.equal(f.projections.length,0);owner.unmount();
});
test('new send invalidates old nudge, including after sending finally returns to idle',async()=>{
 const pending=deferred(),f=runtime({send:()=>pending.promise}),owner=f.mount();await f.settle();owner.render();f.nudge();const first=f.nudges[0];assert.equal(first.isCurrent(),true);
 const turn=owner.value.sendMessage('buy');await f.settle();assert.equal(first.isCurrent(),false);assert.equal(owner.render().isLoading,true);f.nudge();assert.equal(f.nudges.length,1,'no new nudge while a buyer turn owns loading');
 pending.resolve({message:'confirmed',blocks:[]});await turn;assert.equal(first.isCurrent(),false,'idle ABA cannot reactivate an old nudge');f.nudge();assert.equal(f.nudges[1].isCurrent(),true);owner.unmount();assert.equal(f.nudges[1].isCurrent(),false);
});
test('new nudge and merchant replacement invalidate earlier nudge tokens',async()=>{
 const f=runtime(),owner=f.mount();await f.settle();owner.render();f.nudge();f.nudge();assert.equal(f.nudges[0].isCurrent(),false);assert.equal(f.nudges[1].isCurrent(),true);
 owner.render('merchant-b');assert.equal(f.nudges[1].isCurrent(),false);await f.settle();owner.render();f.nudge();assert.equal(f.nudges[2].isCurrent(),true);owner.unmount();assert.equal(f.nudges[2].isCurrent(),false);
});
for(const reason of ['manual_only','cooldown','missing_fallback'])test(`refused ${reason} nudge cannot invalidate the prior admitted pending nudge`,async()=>{
 const f=runtime({nudgeAdmission:(_,index)=>index===1}),owner=f.mount();await f.settle();owner.render();f.nudge();const first=f.nudges[0];assert.equal(first.isCurrent(),true);
 f.nudge();assert.equal(f.nudges.length,2);assert.equal(first.isCurrent(),true,'refused admission must leave the prior token owner intact');
 const turn=owner.value.sendMessage('hello');await f.settle();assert.equal(first.isCurrent(),false,'a real buyer send still revokes the pending nudge');await turn;assert.equal(first.isCurrent(),false);owner.unmount();
});

for(const label of ['FAQ','Falar com Humano','Reportar Problema','Status do Pedido','Rastrear Pedido','Suporte'])test(`sales nudge stays suppressed after support navigation: ${label}`,async()=>{
 const f=runtime(),owner=f.mount();await f.settle();owner.render();
 await owner.value.sendMessage(label);owner.render();f.nudge();assert.equal(f.nudges.length,0);
 await owner.value.sendMessage('Ver Produtos');owner.render();f.nudge();assert.equal(f.nudges.length,1);
 owner.unmount();
});
test('opening profile or support suppresses a pending nudge and prevents a new one',async()=>{
 const f=runtime(),owner=f.mount();await f.settle();owner.render();f.nudge();const initial=f.nudges[0];
 owner.value.setBuyerHubOpen(true);owner.render();assert.equal(initial.isCurrent(),false);f.nudge();assert.equal(f.nudges.length,1);
 owner.value.setBuyerHubOpen(false);owner.value.setSupportOpen(true);owner.render();f.nudge();assert.equal(f.nudges.length,1);
 owner.unmount();
});
