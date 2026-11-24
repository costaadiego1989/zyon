const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createRequire} = require('node:module');
const sourceRoot = path.resolve(process.env.SERVICE_PRESENTATION_SOURCE_ROOT || path.join(__dirname, '../src'));
const baseRoot = path.resolve(process.env.SERVICE_PRESENTATION_BASE_ROOT || sourceRoot);
const requireApi = createRequire(path.resolve(baseRoot, '../../api/package.json'));
const ts = requireApi('typescript');
const read = relative => {
  const target = path.join(sourceRoot, relative);
  return fs.readFileSync(fs.existsSync(target) ? target : path.join(baseRoot, relative), 'utf8');
};
const unexpected = () => { throw Error('welcome_must_not_dispatch_auth_or_commerce'); };
const compile = (relative, dependencies) => {
  const source = ts.transpileModule(read(relative), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module = {exports:{}};
  new Function('require', 'module', 'exports', source)(name => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    throw Error('unexpected_welcome_dependency:' + name);
  }, module, module.exports);
  return module.exports;
};
const service = compile('lib/services/conversation.service.ts', {
  '@zyon/shared-types':{merchantThemeTokens:unexpected},
  '@/components/conversation/theme-tokens':{THEME_TOKENS:{}},
  '@/lib/conversation-access':{conversationFetch:unexpected},
});
const PRODUCT_REPLIES = ['Ver Produtos','Encontrar Produto','Categorias','Prazo de Entrega','Trocas e Devolu\u00e7\u00f5es','Rastrear Pedido','Meus Dados','Ofertas'];
const PRODUCT_NOTICE = 'Tamb\u00e9m entendo imagens e listas de compras. Envie uma foto para encontrar produtos semelhantes ou uma lista para eu ajudar a montar seu pedido.';
const PRODUCT_GREETING = 'Oi! Sou Lia, sua vendedora pessoal aqui na Minha Loja. \ud83d\udc9a Me conta o que voc\u00ea procura \u2014 eu encontro o produto ideal, garanto o melhor pre\u00e7o com cupons, calculo o frete e fecho seu pedido em segundos, tudo por aqui. Bora come\u00e7ar?';
const SERVICE_REPLIES = ['Quais servi\u00e7os voc\u00eas oferecem?','Quais profissionais e hor\u00e1rios est\u00e3o dispon\u00edveis?','Meus Dados','Falar com Humano'];
const defaults = mode => service.getStorefrontWelcomeDefaults(mode);
const welcome = extra => service.buildWelcomeMessage({agent:'Lia',storeName:'Minha Loja',...extra});
const replies = message => message.blocks[0].data.options;
const assertServiceCopy = text => {
  assert.match(text, /servi\u00e7os/iu);
  assert.doesNotMatch(text, /produtos?|frete|cupons?|promo\u00e7\u00f5es|entrega|vendedora|listas de compras/iu);
};
function actualViewModel(props, experiment = null) {
  const cells = [];
  const noop = () => {};
  const react = {useEffect:noop,useCallback:fn=>fn,useMemo:fn=>fn(),useRef:value=>({current:value}),
    useState:initial=>{const cell={value:typeof initial==='function'?initial():initial};cells.push(cell);return[cell.value,value=>{cell.value=typeof value==='function'?value(cell.value):value;}];}};
  class Session { current(){ return false; } }
  const vm = compile('lib/viewmodels/useConversationViewModel/hook.ts', {
    react,
    '@/lib/storefront-read-ui-action':{assertStorefrontReadUiAction:unexpected},
    '@/lib/widget-config':{useWidgetConfig:()=>({config:{}})},
    '@/lib/cart-store':{useCart:()=>({cart:{cartId:null,itemCount:0},updateFromBlocks:unexpected,
      captureConversationCartProjection:unexpected,updateItemQuantity:unexpected,clearCart:unexpected})},
    '@/lib/api/api-client':{checkoutApi:{create:unexpected}},
    '@/lib/scoped-conversation':{ScopedConversationSession:Session,ScopedConversationUnavailable:class extends Error{}},
    '@/lib/prepare-conversation-turn':{prepareConversationTurn:unexpected},
    '@/lib/conversation-access':{ConversationSessionExpiredError:class extends Error{},conversationAccessHeaders:unexpected,
      conversationAccessMatchesCurrentOrigin:unexpected,forgetConversationAccess:unexpected,ensureConversationAccess:unexpected},
    '@/lib/intervention-tracker':{canFireTrigger:unexpected,recordTriggerFired:unexpected,noteActivity:unexpected},
    '@/lib/analytics':{trackConversationStart:unexpected},
    './effects':{useNudgeTriggers:noop,useProactiveMode:noop,useReturnOrderTracking:noop},
    '@/lib/services/conversation.service':service,
    '@/lib/handlers/conversation.handlers':{handleSendMessage:unexpected,handleQuickReply:unexpected,
      handleUpdateQuantity:unexpected,handleFireNudge:unexpected,initConversation:unexpected},
    '@/lib/useCheckoutExperiment':{useCheckoutExperiment:()=>({getExperimentGreeting:()=>experiment})},
  }).useConversationViewModel({storeName:'Minha Loja',merchantId:'merchant-services',agentName:'Lia',...props});
  vm.selectChannel('chat');
  const result = cells.map(cell=>cell.value).find(value=>Array.isArray(value)&&value[0]?.id==='welcome');
  assert.ok(result,'actual channel selection must publish its welcome');
  return result[0];
}
test('product and missing or unknown legacy mode keep the original welcome and eight shortcuts verbatim', () => {
  for (const businessMode of ['products',undefined,'unknown']) {
    const message=welcome({businessMode});
    assert.equal(message.text,PRODUCT_GREETING+'\n\n'+PRODUCT_NOTICE);
    assert.deepEqual(replies(message),PRODUCT_REPLIES);
  }
});
test('canonical services welcome offers read-only services and availability without product shipping copy', () => {
  const message=welcome({businessMode:'services'});
  assertServiceCopy(message.text);
  assert.match(message.text,/profissional/iu);assert.match(message.text,/hor\u00e1rios/iu);
  assert.deepEqual(replies(message),SERVICE_REPLIES);
});
test('merchant greeting and configured shortcuts are preserved in both canonical modes and legacy mode', () => {
  for(const businessMode of ['services','products',undefined]) {
    const message=welcome({businessMode,agentGreeting:'Mensagem exata da empresa',quickReplies:['Atalho publicado']});
    assert.ok(message.text.startsWith('Mensagem exata da empresa\n\n'));
    assert.deepEqual(replies(message),['Atalho publicado']);
  }
});
test('experiment greeting and experiment shortcuts retain their precedence over merchant customization', () => {
  for(const businessMode of ['services','products',undefined]) {
    const message=welcome({businessMode,agentGreeting:'Empresa',quickReplies:['Empresa'],expGreetingMessage:'Experimento',expSuggestedNext:['Experimental']});
    assert.ok(message.text.startsWith('Experimento\n\n'));assert.deepEqual(replies(message),['Experimental']);
  }
});
test('an explicitly empty configured or experimental shortcut list stays empty', () => {
  assert.deepEqual(replies(welcome({businessMode:'services',quickReplies:[]})),[]);
  assert.deepEqual(replies(welcome({businessMode:'services',quickReplies:['Empresa'],expSuggestedNext:[]})),[]);
});
test('service intro, empty-chat greeting and attachment example are service-specific while product copy stays verbatim', () => {
  const services=defaults('services');
  assertServiceCopy(services.introDescription+' '+services.chatGreeting+' '+services.attachmentPrompt);
  assert.match(services.channelPrompt,/conversar/iu);
  assert.doesNotMatch(services.attachmentNotice,/produtos?|frete|compras/iu);
  for(const businessMode of ['products',undefined,'unknown']) {
    const product=defaults(businessMode);
    assert.equal(product.roleLabel,'Gerente de vendas da');
    assert.equal(product.introDescription,'Eu cuido da sua compra do in\u00edcio ao fim. Acho a melhor op\u00e7\u00e3o, aplico promo\u00e7\u00f5es, organizo a entrega e finalizo o pagamento com voc\u00ea, passo a passo.');
    assert.equal(product.channelPrompt,'Como voc\u00ea prefere comprar?');
    assert.equal(product.chatGreeting,'A partir de agora serei sua assistente de vendas e irei te ajudar a encontrar produtos, aplicar cupons, calcular frete e finalizar sua compra. Vamos come\u00e7ar!');
    assert.equal(product.attachmentNotice,PRODUCT_NOTICE);
    assert.equal(product.attachmentPrompt,'Analise este anexo, encontre produtos iguais ou semelhantes dispon\u00edveis e me pergunte antes de adicionar qualquer item ao carrinho.');
    assert.deepEqual(product.quickReplies,PRODUCT_REPLIES);
  }
});
test('actual view model forwards canonical service mode into the welcome without auth, payment or cart dispatch', () => {
  const message=actualViewModel({businessMode:'services'});
  assertServiceCopy(message.text);assert.deepEqual(replies(message),SERVICE_REPLIES);
});
test('actual view model keeps legacy product welcome and merchant or experiment precedence', () => {
  assert.equal(actualViewModel({businessMode:'products'}).text,PRODUCT_GREETING+'\n\n'+PRODUCT_NOTICE);
  assert.equal(actualViewModel({}).text,PRODUCT_GREETING+'\n\n'+PRODUCT_NOTICE);
  const custom=actualViewModel({businessMode:'services',agentGreeting:'Publicado',quickReplies:['Privado personalizado']});
  assert.ok(custom.text.startsWith('Publicado\n\n'));assert.deepEqual(replies(custom),['Privado personalizado']);
  const experiment=actualViewModel({businessMode:'services',agentGreeting:'Publicado'}, {message:'Experimento atual',suggestedNext:['Escolha atual']});
  assert.ok(experiment.text.startsWith('Experimento atual\n\n'));assert.deepEqual(replies(experiment),['Escolha atual']);
});
