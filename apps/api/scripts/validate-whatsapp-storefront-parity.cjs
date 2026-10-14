(async () => {
  const assert = require('node:assert/strict');
  const { randomUUID, createHash, randomInt } = require('node:crypto');
  assert.equal(process.env.RAILWAY_ENVIRONMENT_NAME, 'sandbox', 'sandbox_only_probe');
  process.env.WHATSAPP_NATIVE_ASSETS_AUTO_PROVISION = 'false';
  const originalFetch = globalThis.fetch;
  let outboundPosts = 0;
  globalThis.fetch = async (url, init) => {
    if (init?.method && !['GET', 'HEAD'].includes(init.method)) { outboundPosts++; throw new Error('nonfinancial_probe_no_external_mutations'); }
    return originalFetch(url, init);
  };
  const { NestFactory } = await import('@nestjs/core');
  const loadDist = relative => import(require('node:url').pathToFileURL(require('node:path').resolve('dist', relative)).href);
  const { AppModule } = await loadDist('app.module.js');
  const { PRISMA_CROSS_MERCHANT_CLIENT } = await loadDist('shared/persistence/persistence.module.js');
  const { TenantContextService } = await loadDist('shared/tenant/tenant-context.service.js');
  const { WHATSAPP_CONVERSATION_PORT } = await loadDist('modules/whatsapp-channel/domain/ports/whatsapp-conversation.port.js');
  const { WHATSAPP_SESSION_REPOSITORY } = await loadDist('modules/whatsapp-channel/domain/ports/whatsapp-session-repository.port.js');
  const { WHATSAPP_WEBHOOK_INBOX } = await loadDist('modules/whatsapp-channel/domain/ports/whatsapp-webhook-inbox.port.js');
  const { HandleMetaConversationUseCase } = await loadDist('modules/whatsapp-channel/application/use-cases/handle-meta-conversation.use-case.js');
  const { STOREFRONT_CONVERSATION_PORT } = await loadDist('modules/storefront/domain/ports/conversation.port.js');
  const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
  // Do not call init/listen: no scheduler or webhook worker is started here.
  const prisma = app.get(PRISMA_CROSS_MERCHANT_CLIENT);
  const config = await prisma.whatsAppChannelConfig.findFirst({ where: { provider: 'META_CLOUD', enabled: true }, select: { id: true, merchantId: true } });
  assert.ok(config, 'sandbox_connected_merchant_required');
  const merchantId = config.merchantId;
  const runId = randomUUID(); const conversationId = 'qa_native_' + runId;
  const globalUserId = 'qa_native_buyer_' + runId;
  const deviceId = 'META_CLOUD:qa_' + runId;
  const buyer = { globalUserId, phone: '551199' + randomInt(1000000, 9999999), fullName: 'QA WhatsApp Sandbox' };
  const qaEmail = 'qa-native-' + runId + '@example.invalid';
  const results = { environment: 'sandbox', deploymentId: process.env.RAILWAY_DEPLOYMENT_ID, synthetic: true, financial: false, providerMessagesSent: 0,
    runId, checks: [], cleanup: {}, externalMutationAttempts: 0 };
  const turnIds = []; const checkoutIds = new Set(); const emitted = [];
  let session; let fixtureProductId;
  const { EMAIL_SENDER_PORT } = await loadDist('modules/notifications/domain/ports/email-sender.port.js');
  const { CheckoutCustomerService } = await loadDist('modules/checkout/application/services/checkout-customer.service.js');
  const { BUYER_ACCOUNT_REPOSITORY } = await loadDist('modules/buyer-account/domain/ports/buyer-account-repository.port.js');
  const emailSender = app.get(EMAIL_SENDER_PORT), customerService = app.get(CheckoutCustomerService);
  const originalSend = emailSender.send, notifier = customerService.buyerEmailNotifier, originalNotify = notifier?.notifyCaptured;
  let capturedCode;
  emailSender.send = async input => {
    assert.equal(input.to, qaEmail, 'only_isolated_fixture_email_may_be_captured');
    assert.equal(input.requireDelivery, true);
    capturedCode = input.subject.match(/^\d{6}/)?.[0];
    assert.ok(capturedCode);
    return { status: 'sent', messageId: 'email.qa.captured' };
  };
  if (notifier) notifier.notifyCaptured = async () => {};
  try {
    const fixture = await prisma.product.create({ data: { merchantId, name: 'Native QA ' + runId, type: 'physical',
      description: 'Isolated nonfinancial WhatsApp validation fixture: cuidado facial da pele', contentBlocks: { create: [
        { type: 'button', props: { label: 'Adicionar ao carrinho', linkType: 'add_to_cart' }, order: 1 },
        { type: 'banner', props: { ctaLabel: 'Adicionar ao carrinho', ctaAction: 'add_to_cart' }, order: 2 },
        { type: 'paragraph', props: { text: 'Detalhes completos do produto de teste' }, order: 0 },
      ] }, variants: { create: [
        { sku: 'QA_BLUE_' + runId, attributes: { Cor: 'Azul' }, weightGrams: 100, lengthCm: 10, widthCm: 10, heightCm: 2,
          price: { create: { basePriceInCents: 1234 } }, stock: { create: { quantity: 10 } }, media: { create: { url: 'https://example.com/qa-product.jpg', type: 'IMAGE' } } },
        { sku: 'QA_RED_' + runId, attributes: { Cor: 'Vermelho' }, weightGrams: 100, lengthCm: 10, widthCm: 10, heightCm: 2,
          price: { create: { basePriceInCents: 1500 } }, stock: { create: { quantity: 10 } } },
        { sku: 'QA_EMPTY_' + runId, attributes: { Cor: 'Indisponível' }, weightGrams: 100, lengthCm: 10, widthCm: 10, heightCm: 2,
          price: { create: { basePriceInCents: 1900 } }, stock: { create: { quantity: 0 } } },
      ] } } });
    fixtureProductId = fixture.id;
    results.fixture = 'rich_product_with_two_available_variants_one_sold_out_and_duplicate_content_ctas';
    const fixtureVariants = await prisma.productVariant.findMany({ where: { productId: fixtureProductId, product: { merchantId } }, select: { id: true, sku: true } });
    const targetVariant = fixtureVariants.find(variant => variant.sku === 'QA_RED_' + runId);
    const blueVariant = fixtureVariants.find(variant => variant.sku === 'QA_BLUE_' + runId);
    const soldOutVariant = fixtureVariants.find(variant => variant.sku === 'QA_EMPTY_' + runId);
    await app.get(TenantContextService).run({ merchantId, userId: globalUserId, role: 'buyer', buyerGlobalUserId: globalUserId }, async () => {
      const sessions = app.get(WHATSAPP_SESSION_REPOSITORY);
      const inbox = app.get(WHATSAPP_WEBHOOK_INBOX);
      const conversation = app.get(WHATSAPP_CONVERSATION_PORT);
      const sharedStore = app.get(STOREFRONT_CONVERSATION_PORT);
      const originalAgentRun = sharedStore.agent.run;
      try {
        sharedStore.agent.run = async () => ({ message: 'Previously viewed product', blocks: [], toolsUsed: [], cartId: conversationId });
        const discovery = await sharedStore.reply({ merchantId, sessionId: conversationId, cartId: conversationId,
          userMessage: 'quero um produto para minha pele ' + runId, merchantName: 'Sandbox', history: [] });
        const products = discovery.blocks.find(block => block.type === 'product_carousel')?.data?.products;
        assert.deepEqual(products?.map(product => product.id), [fixtureProductId]);
        assert.ok(discovery.message.includes('relacionadas'));
        results.checks.push('model_no_tool_replay_uses_real_shared_contextual_catalog_without_broadening');
      } finally { sharedStore.agent.run = originalAgentRun; }
      session = await sessions.create({ merchantId, buyerPhone: buyer.phone, buyerAlias: buyer.fullName, deviceId,
        currentOptions: [], previousOptions: [], currentPage: 0, lastActivityAt: new Date(), status: 'active',
        conversationState: { version: 1, conversationId, stage: 'store', history: [], revision: '', page: 0, previousViews: [] } });
      const sender = { sendUi: async request => { emitted.push(request.uiMessage); return { status: 'sent', messageId: 'wamid.qa.' + emitted.length }; } };
      const handler = new HandleMetaConversationUseCase(conversation, sessions, inbox, sender);
      const turn = async (body, { interactiveId, action } = {}) => {
        session = await sessions.findActiveByPhone(merchantId, buyer.phone);
        assert.equal(session.deviceId, deviceId, 'probe_session_must_not_replace_existing_session');
        const id = randomUUID(); const leaseToken = randomUUID(); turnIds.push(id);
        const claim = { id, merchantId, configId: config.id, deviceId, eventId: id, dedupKey: conversationId + ':' + id, kind: 'message',
          streamKey: conversationId, payload: {}, payloadHash: createHash('sha256').update(id).digest('hex'), leaseToken, attempts: 1 };
        await prisma.whatsAppWebhookInbox.create({ data: { ...claim, status: 'processing', leaseExpiresAt: new Date(Date.now() + 300000) } });
        const input = { merchantId, provider: 'META_CLOUD', deviceId, fromNumber: buyer.phone, body, timestamp: Date.now(), interactiveId, inboxClaim: claim };
        const before = session.conversationState;
        const producer = action ? () => conversation.respondStore({ merchantId, buyer, message: body, state: before, action, messageId: id }) : undefined;
        await handler.execute(input, { whatsappSession: session, buyerData: buyer, isNew: false }, producer);
        assert.equal(await inbox.complete(claim), true);
        const row = await prisma.whatsAppWebhookInbox.findUnique({ where: { id } });
        assert.equal(row.responseState.phase, 'complete');
        assert.equal(row.responseState.sent.length, row.responseState.presentation.messages.length);
        session = await sessions.findActiveByPhone(merchantId, buyer.phone);
        // Injected producers exercise the separate post-sale input contract;
        // normal customer turns always keep exactly one discovery shortcut.
        if (!action) {
          const actions = session.conversationState.numericSelections;
          assert.equal(actions.filter(action => action.kind === 'tool' && action.tool === 'search_products' && action.args.query === '*' && !action.args.categoryId && !action.args.cursor).length, 1);
          assert.equal(actions.filter(action => action.kind === 'message' && action.message === 'Encontrar produto').length, 1);
        }
        if (session.conversationState.checkoutSessionId) checkoutIds.add(session.conversationState.checkoutSessionId);
        return session.conversationState;
      };
      const pick = predicate => {
        const selected = Object.entries(session.conversationState.selections ?? {}).find(([, action]) => predicate(action));
        assert.ok(selected, 'native_selection_required'); return selected[0];
      };
      const choose = async predicate => {
        while (session.conversationState.page > 0) await turn('Página anterior', { interactiveId: pick(action => action.kind === 'page' && action.page === session.conversationState.page - 1) });
        for (let page = 0; page < 40; page++) {
          const selected = Object.entries(session.conversationState.selections ?? {}).find(([, action]) => predicate(action));
          if (selected) return selected[0];
          const next = Object.entries(session.conversationState.selections ?? {}).find(([, action]) => action.kind === 'page' && action.page > session.conversationState.page)
            ?? Object.entries(session.conversationState.selections ?? {}).find(([, action]) => action.kind === 'tool' && action.tool === 'search_products' && action.args.cursor);
          assert.ok(next, 'requested_native_action_must_be_reachable');
          await turn('Mais opções', { interactiveId: next[0] });
        }
        throw new Error('native_navigation_page_limit');
      };
      const cartRead = () => prisma.storefrontCart.findUnique({ where: { merchantId_sessionId: { merchantId, sessionId: conversationId } } });
      const storeTool = name => action => action.kind === 'tool' && action.tool === name;
      await turn('Oi');
      assert.ok(emitted.some(message => message.type === 'interactive'));
      results.checks.push('native_welcome_and_quick_replies_persisted');
      const expectedWelcome = session.conversationState.view.choices.map(choice => JSON.stringify(choice.action)).sort();
      const visitedWelcome = [];
      for (let page = 0; page < 20; page++) {
        visitedWelcome.push(...Object.values(session.conversationState.selections).filter(action => !['page', 'back'].includes(action.kind)).map(action => JSON.stringify(action)));
        const next = Object.entries(session.conversationState.selections).find(([, action]) => action.kind === 'page' && action.page > session.conversationState.page);
        if (!next) break;
        await turn('Mais opções', { interactiveId: next[0] });
      }
      assert.deepEqual([...new Set(visitedWelcome)].sort(), expectedWelcome);
      results.checks.push('all_configured_welcome_actions_remain_reachable_across_persisted_native_pages');
      await turn('Categorias', { action: { kind: 'tool', tool: 'list_categories', args: {} } });
      assert.ok(session.conversationState.view.blocks.some(block => block.type === 'category_carousel'));
      await turn('Voltar', { interactiveId: await choose(action => action.kind === 'back') });
      assert.equal(session.conversationState.stage, 'store');
      await turn('Ofertas', { action: { kind: 'tool', tool: 'get_daily_deals', args: {} } });
      assert.equal(session.conversationState.stage, 'store');
      await turn('Menu');
      assert.ok(session.conversationState.view.choices.length);
      results.checks.push('categories_offers_back_and_menu_use_the_shared_storefront_navigation');
      await turn('Ver produtos', { action: { kind: 'tool', tool: 'search_products', args: { query: runId } } });
      const productChoice = pick(action => action.kind === 'tool' && action.tool === 'get_product_details');
      const readScope = { id: randomUUID(), merchantId, configId: config.id, deviceId, streamKey: conversationId };
      assert.ok(await inbox.findPriorSelection(readScope, session.id, productChoice));
      for (const other of [{merchantId: merchantId + '-other'}, {configId: randomUUID()}, {deviceId: deviceId + '-other'}, {streamKey: conversationId + '-other'}]) {
        assert.equal(await inbox.findPriorSelection({...readScope, ...other}, session.id, productChoice), null);
      }
      assert.equal(await inbox.findPriorSelection(readScope, randomUUID(), productChoice), null);
      results.checks.push('archived_native_selection_remains_scoped_to_merchant_config_device_stream_and_session');

      await turn('Ver produto', { interactiveId: productChoice });
      results.checks.push('native_product_selection_uses_shared_authoritative_details');
      await turn('Ver o produto pelo menu anterior', { interactiveId: productChoice });
      assert.ok(session.conversationState.view.blocks.some(block => block.type === 'product_card' && block.data.id === fixtureProductId));
      assert.ok(!session.conversationState.view.body.includes('Esse menu foi atualizado'));
      results.checks.push('older_owned_read_selection_opens_current_product_details');
      assert.ok(session.conversationState.view.blocks.some(block => block.type === 'product_content'));
      assert.equal(session.conversationState.view.choices.some(choice => /^mais informa/i.test(choice.label)), false);
      const detailBody = session.conversationState.view.body;
      const detailPage = pick(action => action.kind === 'page' && action.page === 1);
      const beforeDetailPage = emitted.length;
      await turn('Mais opções do produto', { interactiveId: detailPage });
      assert.deepEqual(emitted.slice(beforeDetailPage).map(message => message.type), ['interactive']);
      assert.equal(session.conversationState.view.body, detailBody);
      await turn('Página anterior', { interactiveId: pick(action => action.kind === 'page' && action.page === 0) });
      results.checks.push('product_menu_pagination_preserves_full_published_content_without_resending_description_or_images');
      results.checks.push('complete_product_details_do_not_offer_a_duplicate_more_information_action');
      assert.equal(session.conversationState.view.choices.some(choice => /^adicionar.*carrinho$/i.test(choice.label)), false);
      assert.equal(session.conversationState.view.choices.some(choice => choice.action.kind === 'variant' && choice.action.variantId === soldOutVariant.id), false);
      await turn('Adicionar ao carrinho');
      assert.equal((await cartRead())?.items?.length ?? 0, 0);
      results.checks.push('rich_ctas_and_typed_add_cannot_guess_variant_or_bypass_sold_out_stock');
      await turn('Escolher Vermelho', { interactiveId: await choose(action => action.kind === 'variant' && action.variantId === targetVariant.id) });
      assert.ok(session.conversationState.view.body.includes('15,00'));
      await turn('Trocar para Azul', { interactiveId: await choose(action => action.kind === 'variant' && action.variantId === blueVariant.id) });
      assert.equal(session.conversationState.selectedVariantId, blueVariant.id);
      assert.ok(session.conversationState.view.body.includes('12,34'));
      await turn('Trocar novamente para Vermelho', { interactiveId: await choose(action => action.kind === 'variant' && action.variantId === targetVariant.id) });
      assert.equal(session.conversationState.selectedVariantId, targetVariant.id);
      assert.ok(session.conversationState.view.body.includes('15,00'));
      results.checks.push('native_variant_can_be_changed_before_add_and_selected_price_follows_its_sku');
      const addChoices = session.conversationState.view.choices.filter(choice => /^adicionar.*carrinho$/i.test(choice.label));
      assert.equal(addChoices.length, 1); assert.equal(addChoices[0].action.tool, 'add_item_to_cart');
      const oldAddId = await choose(storeTool('add_item_to_cart'));
      await turn('Mais Informações');
      assert.ok(session.conversationState.view.body.includes('Detalhes completos do produto de teste'));
      assert.equal(session.conversationState.selectedVariantId, targetVariant.id);
      results.checks.push('more_information_preserves_selected_variant_and_displays_real_rich_content');
      await turn('Seleção antiga', { interactiveId: oldAddId });
      assert.equal((await cartRead())?.items?.length ?? 0, 0);
      assert.ok(session.conversationState.view.body.includes('Esse menu foi atualizado'));
      results.checks.push('stale_menu_cannot_mutate_cart');
      const nativeAddId = await choose(storeTool('add_item_to_cart'));
      const beforeAdded = emitted.length;
      await turn('Adicionar ao carrinho', { interactiveId: nativeAddId });
      assert.ok(!emitted.slice(beforeAdded).some(message => message.type === 'image'));
      assert.ok(!session.conversationState.view.blocks.some(block => block.type === 'product_card'));
      results.checks.push('successful_add_shows_cart_confirmation_without_repeating_product_photo_or_details');
      const cart = await cartRead();
      assert.equal(cart.items.length, 1); assert.equal(cart.items[0].quantity, 1); assert.equal(cart.items[0].variantId, targetVariant.id);
      assert.equal(cart.items[0].unitPriceCents, 1500);
      results.checks.push('native_add_persists_same_storefront_cart');
      const item = cart.items[0];
      await turn('Ver Carrinho');
      assert.ok(session.conversationState.view.choices.some(choice => choice.action.kind === 'tool' && choice.action.tool === 'checkout'));
      results.checks.push('view_cart_keeps_native_checkout_and_continue_shopping_reachable');
      await turn('Editar item', { interactiveId: await choose(storeTool('edit_cart_item')) });
      await turn('Adicionar uma unidade', { interactiveId: await choose(action => action.kind === 'tool' && action.tool === 'update_cart_item' && action.args.quantity === 2) });
      const edited = await cartRead();
      assert.equal(edited.items[0].quantity, 2);
      assert.ok(session.conversationState.view.blocks.some(block => block.type === 'cart_summary'));
      results.checks.push('quantity_and_native_cart_summary_match_persisted_values');
      await turn('Voltar', { interactiveId: await choose(action => action.kind === 'back') });
      assert.ok(session.conversationState.view.blocks.some(block => block.type === 'cart_summary' && block.data.items[0].quantity === 2));
      results.checks.push('back_refreshes_live_cart_instead_of_replaying_stale_quantity');
      await turn('Editar item', { interactiveId: await choose(storeTool('edit_cart_item')) });
      await turn('Retirar uma unidade', { interactiveId: await choose(action => action.kind === 'tool' && action.tool === 'update_cart_item' && action.args.quantity === 1) });
      assert.equal((await cartRead()).items[0].quantity, 1);
      await turn('Remover item', { interactiveId: await choose(storeTool('remove_cart_item')) });
      assert.equal((await cartRead()).items.length, 0);
      assert.equal(session.conversationState.view.choices.some(choice => choice.action.kind === 'tool' && choice.action.tool === 'checkout'), false);
      results.checks.push('native_decrement_and_remove_persist_and_empty_cart_is_displayed');
      await turn('Continuar Comprando');
      await turn('Ver produto', { interactiveId: await choose(action => action.kind === 'tool' && action.tool === 'get_product_details' && action.args.productId === fixtureProductId) });
      if (!session.conversationState.selectedVariantId) await turn('Escolher Vermelho', { interactiveId: await choose(action => action.kind === 'variant' && action.variantId === targetVariant.id) });
      await turn('Adicionar ao Carrinho');
      assert.equal((await cartRead()).items[0].variantId, targetVariant.id);
      results.checks.push('continue_shopping_and_typed_add_share_authoritative_native_actions');
      await turn('Ver Carrinho');
      await turn('Editar item', { interactiveId: await choose(storeTool('edit_cart_item')) });
      await turn('Adicionar uma unidade', { interactiveId: await choose(action => action.kind === 'tool' && action.tool === 'update_cart_item' && action.args.quantity === 2) });
      await turn('Finalizar compra', { interactiveId: await choose(action => action.kind === 'tool' && ['checkout', 'create_checkout_session'].includes(action.tool)) });
      const checkoutSessionId = session.conversationState.checkoutSessionId;
      assert.equal(session.conversationState.stage, 'checkout'); assert.ok(checkoutSessionId);
      const checkout = await prisma.checkoutSession.findUnique({ where: { merchantId_sessionId: { merchantId, sessionId: checkoutSessionId } } });
      assert.equal(checkout.globalUserId, globalUserId); assert.equal(checkout.customer.phone_verified, true);
      assert.equal(checkout.customer.email_verified === true, false); assert.equal(checkout.cart.items[0].quantity, 2);
      assert.match(session.conversationState.view.body, /Qual é seu email/);
      assert.equal(session.conversationState.view.blocks.some(block => block.type === 'checkout_redirect'), false);
      await turn('Menu');
      assert.equal(session.conversationState.stage, 'store');
      await turn('Voltar', { interactiveId: await choose(action => action.kind === 'back') });
      assert.equal(session.conversationState.stage, 'checkout');
      assert.equal(session.conversationState.checkoutSessionId, checkoutSessionId);
      assert.match(session.conversationState.view.body, /Qual é seu email/);
      results.checks.push('menu_back_resumes_authoritative_checkout_data_entry_and_keeps_its_binding');
      await turn(qaEmail);
      const wrongCode = capturedCode === '000000' ? '111111' : '000000';
      await turn(wrongCode);
      assert.equal((await prisma.checkoutSession.findUnique({ where: { merchantId_sessionId: { merchantId, sessionId: checkoutSessionId } } })).customer.email_verified, false);
      await turn(capturedCode);
      await turn('QA Sandbox Person');
      const verified = await prisma.checkoutSession.findUnique({ where: { merchantId_sessionId: { merchantId, sessionId: checkoutSessionId } } });
      assert.equal(verified.customer.email_verified, true);
      assert.equal(verified.customer.otp_code, '');
      assert.equal(verified.customer.fullName.toLowerCase(), 'qa sandbox person');
      results.checks.push('new_buyer_conversational_registration_uses_email_otp_and_rejects_invalid_code');
      const account = await app.get(BUYER_ACCOUNT_REPOSITORY).findByPhone(buyer.phone);
      assert.equal(account.email, qaEmail);
      const encrypted = await prisma.buyerAccount.findUnique({ where: { globalUserId: account.globalUserId }, select: { phone: true, phoneLookupHash: true } });
      assert.ok(encrypted.phone.startsWith('pii_v1:'));
      assert.equal(encrypted.phoneLookupHash.length, 64);
      results.checks.push('registered_encrypted_phone_is_found_through_keyed_index');
      const repeatBuyer = { ...buyer, globalUserId: 'qa_native_return_' + runId };
      let repeat = await conversation.respondStore({ merchantId, buyer: repeatBuyer, message: 'Finalizar compra', action: { kind: 'tool', tool: 'checkout', args: {} },
        state: { version: 1, conversationId, checkoutGeneration: 1, stage: 'store', history: [], revision: '', page: 0, previousViews: [] } });
      checkoutIds.add(repeat.state.checkoutSessionId);
      const pending = await prisma.checkoutSession.findUnique({ where: { merchantId_sessionId: { merchantId, sessionId: repeat.state.checkoutSessionId } } });
      assert.equal(pending.customer.email_verified, false);
      assert.equal(pending.customer.fullName, undefined);
      assert.equal(pending.globalUserId, repeatBuyer.globalUserId);
      assert.ok(!repeat.agentMessage.includes(qaEmail));
      repeat = await conversation.respondStore({ merchantId, buyer: repeatBuyer, message: capturedCode, state: repeat.state, messageId: randomUUID() });
      const recognized = await prisma.checkoutSession.findUnique({ where: { merchantId_sessionId: { merchantId, sessionId: repeat.state.checkoutSessionId } } });
      assert.equal(recognized.customer.email_verified, true);
      assert.equal(recognized.customer.fullName, account.displayName);
      assert.equal(recognized.globalUserId, account.globalUserId);
      results.checks.push('returning_buyer_email_challenge_precedes_profile_hydration_and_identity_binding');
      const { SendStoreMessageUseCase } = await loadDist('modules/storefront/application/use-cases/send-store-message.use-case.js');
      const store = app.get(SendStoreMessageUseCase), originalStoreExecute = store.execute;
      let shopper;
      store.execute = async function (input) { shopper = input.trusted_buyer_context; return originalStoreExecute.call(this, input); };
      try {
        const browsing = await conversation.respondStore({ merchantId, buyer: repeatBuyer, message: 'Ver carrinho', state: repeat.state, action: { kind: 'tool', tool: 'get_cart', args: {} } });
        assert.equal(browsing.state.stage, 'store');
        assert.equal(shopper.globalUserId, account.globalUserId);
        assert.equal(shopper.email, qaEmail);
      } finally { store.execute = originalStoreExecute; }
      results.checks.push('email_authenticated_identity_survives_return_to_actual_storefront_cart');
      await turn('Ver carrinho');
      assert.equal(session.conversationState.stage, 'store');
      assert.equal((await cartRead()).items[0].quantity, 2);
      assert.equal(session.conversationState.cartHasItems, true);
      assert.deepEqual(session.conversationState.numericSelections.slice(0, 2).map(action => action.kind === 'tool' ? action.tool : action.message), ['search_products', 'Encontrar produto']);
      assert.deepEqual(session.conversationState.numericSelections.slice(2, 4).map(action => action.tool), ['get_cart', 'checkout']);
      results.checks.push('persisted_nonempty_cart_pins_cart_and_finish_controls');
      await turn('Voltar', { interactiveId: await choose(action => action.kind === 'back') });
      assert.equal(session.conversationState.stage, 'checkout');
      assert.equal(session.conversationState.checkoutSessionId, checkoutSessionId);
      const returnedCheckout = await prisma.checkoutSession.findUnique({ where: { merchantId_sessionId: { merchantId, sessionId: checkoutSessionId } } });
      assert.equal(returnedCheckout.globalUserId, globalUserId);
      assert.equal(returnedCheckout.customer.email_verified, true);
      results.checks.push('cart_back_resumes_verified_checkout_without_losing_items_or_restarting_registration');
      const redirect = session.conversationState.view.blocks.find(block => block.type === 'checkout_redirect');
      assert.ok(redirect, JSON.stringify({ stage: session.conversationState.stage, viewTypes: session.conversationState.view.blocks.map(block => block.type), hasCpf: !!verified.customer.cpf, hasName: !!verified.customer.fullName, emailVerified: verified.customer.email_verified, phoneVerified: verified.customer.phone_verified, viewBody: session.conversationState.view.body.replace(/https:\/\/\S+/g, '[url]').replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]').slice(0,300) })); const url = new URL(redirect.data.url);
      assert.equal(url.origin, 'https://widget-v2-sandbox.up.railway.app'); assert.ok(url.searchParams.get('embedToken'));
      assert.equal(url.searchParams.get('apiBaseUrl'), 'https://api-sandbox-8146.up.railway.app/v1');
      assert.equal(url.searchParams.get('channel'), 'chat');
      const { EmbedAuthGuard } = await loadDist('modules/embed/presentation/http/embed-auth.guard.js');
      const { EmbedCheckoutController } = await loadDist('modules/embed/presentation/http/embed-checkout.controller.js');
      const controller = app.get(EmbedCheckoutController), guard = app.get(EmbedAuthGuard);
      const request = { headers: { authorization: 'Bearer ' + url.searchParams.get('embedToken'), origin: url.origin } };
      const context = req => ({ switchToHttp: () => ({ getRequest: () => req }), getHandler: () => controller.start, getClass: () => EmbedCheckoutController });
      assert.equal(guard.canActivate(context(request)), true);
      const resumed = await controller.start(request, { cart: { items: [] } });
      assert.equal(resumed.session_id, checkoutSessionId);
      assert.equal(resumed.experience.items[0].quantity, 2);
      const { EmbedTokenService } = await loadDist('modules/embed/domain/embed-token.service.js');
      const tokens = app.get(EmbedTokenService);
      const expired = tokens.sign({ ...tokens.verify(url.searchParams.get('embedToken')), expiresAtUnix: Math.floor(Date.now() / 1000) - 1 });
      assert.throws(() => guard.canActivate(context({ headers: { authorization: 'Bearer ' + expired, origin: url.origin } })), /embed_session_token_expired/);
      assert.throws(() => guard.canActivate(context({ headers: { authorization: 'Bearer ' + expired + 'tampered', origin: url.origin } })), /invalid_embed_session_token/);
      results.checks.push('expired_link_has_recoverable_error_without_accepting_expired_or_tampered_capabilities');
      assert.throws(() => guard.canActivate(context({ headers: { ...request.headers, origin: 'https://foreign.example' } })), /embed_origin_not_allowed/);
      await assert.rejects(controller.start(request, { session_id: 'foreign-checkout', cart: { items: [] } }), /embed_checkout_session_binding_mismatch/);
      results.checks.push('fresh_signed_handoff_passes_real_widget_bootstrap_guard_and_controller');
      results.checks.push('handoff_rejects_foreign_origin_and_checkout_session');
      if (process.env.ZYON_QA_BROWSER_PUBLIC_KEY) {
        const { randomBytes, createCipheriv, publicEncrypt } = require('node:crypto');
        const key = randomBytes(32), iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
        const encrypted = Buffer.concat([cipher.update(JSON.stringify({ url: url.href, runId })), cipher.final()]);
        console.log('ZYON_QA_BROWSER_HANDOFF=' + JSON.stringify({ key: publicEncrypt(process.env.ZYON_QA_BROWSER_PUBLIC_KEY, key).toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: encrypted.toString('base64') }));
        // Gives the real hosted desktop/mobile browser probe time to run before cleanup.
        await new Promise(resolve => setTimeout(resolve, 45000));
        results.checks.push('encrypted_fixture_handoff_available_for_hosted_browser_validation');
      }
      const intents = await prisma.paymentIntent.count({ where: { merchantId, sessionId: checkoutSessionId } });
      assert.equal(intents, 0);
      results.checks.push('checkout_preserves_buyer_phone_cart_and_email_verification');
      results.checks.push('signed_handoff_points_to_sandbox_widget_and_api');
      results.checks.push('no_payment_intent_created');
      results.messagesCaptured = emitted.length; results.turnsPersisted = turnIds.length;
      results.blockTypes = [...new Set(emitted.map(message => message.type))];
    });
    results.ok = true;
  } catch (error) {
    results.ok = false;
    results.error = { name: error.name, message: error.message, code: error.code, stack: String(error.stack).split('\n').slice(0, 5) };
  } finally {
    emailSender.send = originalSend;
    if (notifier) notifier.notifyCaptured = originalNotify;
    results.externalMutationAttempts = outboundPosts;
    // Every deletion is constrained to this unique diagnostic namespace.
    results.cleanup.inbox = (await prisma.whatsAppWebhookInbox.deleteMany({ where: { merchantId, id: { in: turnIds } } })).count;
    if (session) results.cleanup.whatsappSession = (await prisma.whatsAppSession.deleteMany({ where: { merchantId, id: session.id, deviceId } })).count;
    results.cleanup.cart = (await prisma.storefrontCart.deleteMany({ where: { merchantId, sessionId: conversationId } })).count;
    try { results.cleanup.checkout = (await prisma.checkoutSession.deleteMany({ where: { merchantId, sessionId: { in: [...checkoutIds] } } })).count; }
    catch (error) { results.cleanup.checkoutError = error.code || error.name; }
    if (fixtureProductId) results.cleanup.fixtureProduct = (await prisma.product.deleteMany({ where: { merchantId, id: fixtureProductId } })).count;
    results.cleanup.buyer = (await prisma.buyerAccount.deleteMany({ where: { globalUserId, email: qaEmail } })).count;
    await prisma.$disconnect(); await app.close();
    console.log('ZYON_NATIVE_PROOF=' + JSON.stringify(results));
    process.exit(results.ok ? 0 : 1);
  }
})().catch(error => { console.log('ZYON_NATIVE_PROBE_ERROR=' + JSON.stringify({ name: error.name, message: error.message, stack: String(error.stack).split('\n').slice(0, 8) })); process.exit(1); });
