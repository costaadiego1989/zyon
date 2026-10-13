(async () => {
  const assert = require('node:assert/strict');
  const { randomUUID, createHash } = require('node:crypto');
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
  const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
  // Do not call init/listen: no scheduler or webhook worker is started here.
  const prisma = app.get(PRISMA_CROSS_MERCHANT_CLIENT);
  const config = await prisma.whatsAppChannelConfig.findFirst({ where: { provider: 'META_CLOUD', enabled: true }, select: { id: true, merchantId: true } });
  assert.ok(config, 'sandbox_connected_merchant_required');
  const merchantId = config.merchantId;
  const runId = randomUUID(); const conversationId = 'qa_native_' + runId;
  const globalUserId = 'qa_native_buyer_' + runId;
  const deviceId = 'META_CLOUD:qa_' + runId;
  const buyer = { globalUserId, phone: '5521993001883', fullName: 'QA WhatsApp Sandbox' };
  const results = { environment: 'sandbox', deploymentId: process.env.RAILWAY_DEPLOYMENT_ID, synthetic: true, financial: false, providerMessagesSent: 0,
    runId, checks: [], cleanup: {}, externalMutationAttempts: 0 };
  const turnIds = []; const checkoutIds = new Set(); const emitted = [];
  let session; let fixtureProductId;
  try {
    const fixture = await prisma.product.create({ data: { merchantId, name: 'Native QA ' + runId, type: 'physical',
      description: 'Isolated nonfinancial WhatsApp validation fixture', contentBlocks: { create: [
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
    const soldOutVariant = fixtureVariants.find(variant => variant.sku === 'QA_EMPTY_' + runId);
    await app.get(TenantContextService).run({ merchantId, userId: globalUserId, role: 'buyer', buyerGlobalUserId: globalUserId }, async () => {
      const sessions = app.get(WHATSAPP_SESSION_REPOSITORY);
      const inbox = app.get(WHATSAPP_WEBHOOK_INBOX);
      const conversation = app.get(WHATSAPP_CONVERSATION_PORT);
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
      await turn('Ver produtos', { action: { kind: 'tool', tool: 'search_products', args: { query: runId } } });
      const productChoice = pick(action => action.kind === 'tool' && action.tool === 'get_product_details');
      await turn('Ver produto', { interactiveId: productChoice });
      results.checks.push('native_product_selection_uses_shared_authoritative_details');
      assert.ok(session.conversationState.view.blocks.some(block => block.type === 'product_content'));
      assert.equal(session.conversationState.view.choices.some(choice => /^adicionar.*carrinho$/i.test(choice.label)), false);
      assert.equal(session.conversationState.view.choices.some(choice => choice.action.kind === 'variant' && choice.action.variantId === soldOutVariant.id), false);
      await turn('Adicionar ao carrinho');
      assert.equal((await cartRead())?.items?.length ?? 0, 0);
      results.checks.push('rich_ctas_and_typed_add_cannot_guess_variant_or_bypass_sold_out_stock');
      await turn('Escolher Vermelho', { interactiveId: await choose(action => action.kind === 'variant' && action.variantId === targetVariant.id) });
      const addChoices = session.conversationState.view.choices.filter(choice => /^adicionar.*carrinho$/i.test(choice.label));
      assert.equal(addChoices.length, 1); assert.equal(addChoices[0].action.tool, 'add_item_to_cart');
      const oldAddId = await choose(storeTool('add_item_to_cart'));
      await turn('Mais Informações');
      assert.ok(session.conversationState.view.body.includes('Detalhes completos do produto de teste'));
      assert.equal(session.conversationState.selectedVariantId, targetVariant.id);
      results.checks.push('more_information_preserves_selected_variant_and_displays_real_rich_content');
      await turn('Seleção antiga', { interactiveId: oldAddId });
      assert.equal((await cartRead())?.items?.length ?? 0, 0);
      assert.ok(session.conversationState.view.body.includes('Não consegui validar'));
      results.checks.push('stale_menu_cannot_mutate_cart');
      await turn('Adicionar ao carrinho', { interactiveId: await choose(storeTool('add_item_to_cart')) });
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
      const redirect = session.conversationState.view.blocks.find(block => block.type === 'checkout_redirect');
      assert.ok(redirect); const url = new URL(redirect.data.url);
      assert.equal(url.origin, 'https://widget-v2-sandbox.up.railway.app'); assert.ok(url.searchParams.get('embedToken'));
      assert.equal(url.searchParams.get('apiBaseUrl'), 'https://api-sandbox-8146.up.railway.app/v1');
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
    results.externalMutationAttempts = outboundPosts;
    // Every deletion is constrained to this unique diagnostic namespace.
    results.cleanup.inbox = (await prisma.whatsAppWebhookInbox.deleteMany({ where: { merchantId, id: { in: turnIds } } })).count;
    if (session) results.cleanup.whatsappSession = (await prisma.whatsAppSession.deleteMany({ where: { merchantId, id: session.id, deviceId } })).count;
    results.cleanup.cart = (await prisma.storefrontCart.deleteMany({ where: { merchantId, sessionId: conversationId } })).count;
    try { results.cleanup.checkout = (await prisma.checkoutSession.deleteMany({ where: { merchantId, globalUserId, sessionId: { in: [...checkoutIds] } } })).count; }
    catch (error) { results.cleanup.checkoutError = error.code || error.name; }
    if (fixtureProductId) results.cleanup.fixtureProduct = (await prisma.product.deleteMany({ where: { merchantId, id: fixtureProductId } })).count;
    await prisma.$disconnect(); await app.close();
    console.log('ZYON_NATIVE_PROOF=' + JSON.stringify(results));
    process.exit(results.ok ? 0 : 1);
  }
})().catch(error => { console.log('ZYON_NATIVE_PROBE_ERROR=' + JSON.stringify({ name: error.name, message: error.message, stack: String(error.stack).split('\n').slice(0, 8) })); process.exit(1); });
