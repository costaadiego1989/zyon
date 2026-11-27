import { HandleMetaConversationUseCase } from "../../whatsapp-channel/application/use-cases/handle-meta-conversation.use-case.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { marketingTestFixture } from "../marketing-test-fixture.js";
import { MarketingContactsService } from "../application/marketing-contacts.service.js";
import { MarketingConversationsService } from "../application/marketing-conversations.service.js";
import { MarketingRelationshipAdapter } from "./marketing-relationship.adapter.js";
import { MarketingEventsHandler } from "./marketing-events.handler.js";
import { MarketingObservability } from "./marketing-observability.js";
import { MetricsService } from "../../../shared/observability/metrics.service.js";
import {
  MARKETING_ACCEPT,
  MARKETING_DECLINE,
  type MerchantMarketingMessaging,
} from "../../../shared/contracts/marketing.js";
import {
  HandleIncomingMessageUseCase,
  type IncomingMessageInput,
} from "../../whatsapp-channel/application/use-cases/handle-incoming-message.use-case.js";
import { SendWhatsAppResponseUseCase } from "../../whatsapp-channel/application/use-cases/send-whatsapp-response.use-case.js";
import { WhatsAppWebhookController } from "../../whatsapp-channel/presentation/http/whatsapp-webhook.controller.js";

async function setup() {
  const f = marketingTestFixture();
  const clock = { now: () => new Date(f.now) };
  const contacts = new MarketingContactsService(
    f.repository,
    {
      plan: async () => "growth",
      buyer: async () => null,
      verifiedAccount: async () => null,
      blockedByPreference: async () => false,
    },
    clock
  );
  const sent: Array<{ kind: string; text: string }> = [];
  const messaging: MerchantMarketingMessaging = {
    sendOpening: async (i) => {
      sent.push({ kind: "opening", text: i.text });
      return { status: "accepted", messageId: "opening-id" };
    },
    sendFreeform: async (i) => {
      sent.push({ kind: "agent", text: i.text });
      return { status: "accepted", messageId: "agent-id" };
    },
    sendCampaign: async () => ({ status: "failed" }),
    submitTemplate: async () => ({
      name: "",
      status: "not_submitted",
      wabaId: null,
    }),
    checkTemplate: async () => false,
  };
  const conversations = new MarketingConversationsService(
    f.repository,
    contacts,
    messaging,
    clock
  );
  const metrics = new MetricsService();
  const observability = new MarketingObservability(metrics, {
    log: () => {},
    warn: () => {},
  });
  const events = new MarketingEventsHandler(
    { publish: async () => {}, subscribe: () => {}, handlersFor: () => [] },
    f.repository,
    contacts,
    { session: async () => null, order: async () => null },
    { pending: async () => false },
    { classify: async () => null },
    observability
  );
  const port = new MarketingRelationshipAdapter(
    contacts,
    conversations,
    events,
    observability,
    f.repository,
    clock
  );
  const prompts: Array<{
    message: string;
    attachmentContext?:string;
    requestId?: string;
    humanContext?: Array<{ role: string; content: string }>;
  }> = [];
  const engine = {
    respond: async (i: (typeof prompts)[number]) => {
      prompts.push(i);
      return { agentMessage: "Vamos escolher seu tênis", quickReplies: [] };
    },
  };
  const session = {
    id: "wa-session",
    checkoutSessionId: "checkout",
    currentOptions: [],
    previousOptions: [],
    currentPage: 0,
    conversationState:{version:1,conversationId:"checkout",stage:"store",history:[],revision:"",page:0,previousViews:[]},
  };
  const send = new SendWhatsAppResponseUseCase({
    sendText: async (i) => {
      sent.push({ kind: "service", text: i.uiMessage?.type === "text" ? i.uiMessage.text.body : i.text });
      return { status: "sent", messageId: "service-id" };
    },
  });
  const responses=new Map<string,Record<string,unknown>>();
  const sessions={updateMenuState:async()=>{},update:async(_id:string,data:any)=>{Object.assign(session,data);return session;}};
  const nativeEngine={respondStore:async(i:any)=>{
    const reply=await engine.respond({message:i.message,requestId:i.messageId,humanContext:i.state.history,attachmentContext:i.attachmentContext});
    return {...reply,blocks:[],merchantName:"Loja",state:{...i.state,history:[...i.state.history,{role:"user",content:i.message},{role:"assistant",content:reply.agentMessage}]}};
  }};
  const media={interpret:async(..._args:any[]):Promise<any>=>undefined};
  const native=new HandleMetaConversationUseCase(nativeEngine as never,sessions as never,
    {saveResponse:async(claim:any,response:any)=>{responses.set(claim.id,structuredClone(response));return true;}} as never,send,
    undefined,media as never,undefined,undefined,port,messaging);
  const incoming = new HandleIncomingMessageUseCase(
    { execute: async () => ({ whatsappSession: session }) } as never,
    send,
    sessions as never,
    engine,
    undefined,
    native,
    undefined,
    port,
    messaging
  );
  const input = (body:string,id:string):IncomingMessageInput=>{
    const payload={merchantId:f.merchantId,deviceId:"META_CLOUD:config",provider:"META_CLOUD",fromNumber:"5511999991234",body,
      messageType:"text",timestamp:Date.parse(f.now),providerTimestampVerified:true,providerMessageId:id};
    return {...payload,inboxClaim:{id,eventId:id,dedupKey:id,kind:"message",merchantId:f.merchantId,configId:"config",deviceId:payload.deviceId,
      streamKey:"local",payloadHash:"local",payload,leaseToken:"lease",attempts:1,responseState:responses.get(id)}};
  };
  return {
    ...f,
    contacts,
    conversations,
    port,
    prompts,
    sent,
    incoming,
    input,
    messaging,
    clock,
    engine,
    session,
    responses,
    media,
    cleanup: async () => {
      metrics.registry.clear();
      await f.cleanup();
    },
  };
}

test("release native Meta identifies the phone before a checkout session exists", async () => {
  const f=await setup();
  try {
    delete (f.session as {checkoutSessionId?:string}).checkoutSessionId;
    await f.incoming.execute(f.input("Quero tênis","native-first"));
    const contact=(await f.contacts.list(f.merchantId,{limit:10,offset:0})).items[0];
    assert.equal(contact.phone,"5511999991234");
    assert.equal(contact.name,null);
    assert.equal(f.prompts.length,0);
    assert.equal(f.sent[0].kind,"opening");
    await f.incoming.execute(f.input(MARKETING_DECLINE,"native-choice"));
    assert.equal(f.prompts[0].message,"Quero tênis");
    assert.equal(f.sent.filter(m=>m.kind === "service").length,1);
  } finally {await f.cleanup();}
});

test("release native opening retains an interpreted attachment as reference across the buyer choice",async()=>{
  const f=await setup();
  try {
    f.media.interpret=async()=>({kind:"attachment_context",context:"Referência do anexo: tênis azul"});
    const first=f.input("Procuro o produto desta foto","photo-first");
    first.metaMedia={id:"photo-id",mimeType:"image/jpeg"};
    const {inboxClaim:_,...payload}=first;first.inboxClaim!.payload=payload;
    await f.incoming.execute(first);
    assert.equal(f.prompts.length,0);
    await f.incoming.execute(f.input(MARKETING_DECLINE,"photo-choice"));
    assert.equal(f.prompts[0].message,"Procuro o produto desta foto");
    assert.equal(f.prompts[0].attachmentContext,"Referência do anexo: tênis azul");
    assert.equal(f.session.conversationState.marketingPendingAttachment,undefined);
  } finally {await f.cleanup();}
});

test("release native Meta blocks a generated response when an agent takes over before delivery", async () => {
  const f=await setup();
  try {
    await f.incoming.execute(f.input("Quero tênis","late-first"));
    await f.incoming.execute(f.input(MARKETING_DECLINE,"late-choice"));
    const count=f.sent.length;
    f.engine.respond=async()=>{
      const c=(await f.conversations.list(f.merchantId)).items[0];
      await f.conversations.ownership(f.merchantId,c.id,"agent","claim",c.version);
      return {agentMessage:"Resposta que chegou tarde",quickReplies:[]};
    };
    await f.incoming.execute(f.input("E o tamanho?","late-turn"));
    assert.equal(f.sent.length,count);
    await f.incoming.execute(f.input("E o tamanho?","late-turn"));
    assert.equal(f.sent.length,count);
    const c=(await f.conversations.list(f.merchantId)).items[0];
    const detail=await f.conversations.detail(f.merchantId,c.id);
    assert.equal(detail.conversation.mode,"human");
    assert.equal(detail.messages.some(m=>m.role === "ai" && m.content === "Resposta que chegou tarde"),false);
  } finally {await f.cleanup();}
});

test("MKT-02/1 WhatsApp pipeline asks once before service and resumes the original request after decline", async () => {
  const f = await setup();
  try {
    await f.incoming.execute(f.input("Preciso de tênis", "first"));
    await f.incoming.execute(f.input("Preciso de tênis", "first"));
    assert.equal(f.sent.length, 1);
    assert.equal(f.sent[0].kind, "opening");
    assert.equal(f.prompts.length, 0);
    await f.incoming.execute(f.input(MARKETING_DECLINE, "choice"));
    assert.equal(f.prompts[0].message, "Preciso de tênis");
    assert.equal(f.prompts[0].requestId, "first");
    assert.equal(f.sent.at(-1)?.kind, "service");
    await f.incoming.execute(f.input(MARKETING_DECLINE, "choice"));
    await f.incoming.execute(f.input("Preciso de tênis", "first"));
    assert.equal(f.sent.filter((m) => m.kind === "service").length, 1);
    const contact = (
      await f.contacts.list(f.merchantId, { limit: 10, offset: 0 })
    ).items[0];
    const detail = await f.contacts.detail(f.merchantId, contact.id);
    assert.equal(detail.contact.name, null);
    assert.equal(detail.consent?.status, "declined");
    const history = await f.port.history(f.merchantId, "whatsapp", "checkout");
    assert.deepEqual(
      history?.map((m) => m.role),
      ["buyer", "system", "buyer", "ai"]
    );
  } finally {
    await f.cleanup();
  }
});

test("MKT-03/4 WhatsApp human mode receives the buyer without invoking AI and release restores human context", async () => {
  const f = await setup();
  try {
    await f.incoming.execute(f.input("Quero tênis", "first"));
    await f.incoming.execute(f.input(MARKETING_ACCEPT, "accept"));
    const page = await f.conversations.list(f.merchantId);
    const claimed = await f.conversations.ownership(
      f.merchantId,
      page.items[0].id,
      "agent",
      "claim",
      page.items[0].version
    );
    await f.incoming.execute(f.input("Qual é o tamanho?", "human-buyer"));
    assert.equal(f.prompts.length, 1);
    let detail = await f.conversations.detail(f.merchantId, claimed.id);
    const reply = await f.conversations.reply(
      f.merchantId,
      claimed.id,
      "agent",
      "O tamanho disponível é 38",
      "agent-reply",
      detail.conversation.version
    );
    await f.conversations.ownership(
      f.merchantId,
      claimed.id,
      "agent",
      "release",
      reply.conversation.version
    );
    await f.incoming.execute(f.input("Pode continuar", "resume"));
    assert.equal(f.prompts.length, 2);
    assert.ok(
      f.prompts[1].humanContext?.some(
        (m) =>
          m.role === "assistant" && m.content === "O tamanho disponível é 38"
      )
    );
    detail = await f.conversations.detail(f.merchantId, claimed.id);
    assert.ok(
      detail.messages.some(
        (m) => m.role === "buyer" && m.content === "Qual é o tamanho?"
      )
    );
    assert.equal(detail.conversation.mode, "ai");
  } finally {
    await f.cleanup();
  }
});

test("MKT-06/4 the outgoing marker survives a final-transaction rollback after provider acceptance", async () => {
  const f = await setup();
  try {
    const r = await f.contacts.inbound({
      merchantId: f.merchantId,
      channel: "whatsapp",
      conversationKey: "durable",
      messageId: "inbound",
      verifiedPhone: "5511999991234",
      text: "Olá",
      receivedAt: f.now,
      consentChoice: "declined",
    });
    const c = await f.conversations.ownership(
      f.merchantId,
      r.conversationId,
      "agent",
      "claim",
      0
    );
    let calls = 0,
      failCommit = true;
    f.messaging.sendFreeform = async () => {
      calls++;
      const markers = await f.db.$queryRawUnsafe<
        Array<{ data: { status: string } }>
      >(
        "SELECT data FROM marketing_messages WHERE merchant_id=$1 AND data->>'role'='agent'",
        f.merchantId
      );
      assert.equal(markers[0].data.status, "sending");
      return { status: "accepted", messageId: "accepted-before-crash" };
    };
    const repository: typeof f.repository = Object.create(f.repository);
    repository.transaction = (merchant, resource, operation, options) =>
      f.repository.transaction(
        merchant,
        resource,
        async (tx) => {
          const result = await operation(tx);
          if (
            failCommit &&
            result &&
            typeof result === "object" &&
            "attempted" in result &&
            result.attempted === true
          ) {
            failCommit = false;
            throw new Error("simulated_commit_failure");
          }
          return result;
        },
        options
      );
    const service = new MarketingConversationsService(
      repository,
      f.contacts,
      f.messaging,
      f.clock
    );
    await assert.rejects(
      service.reply(
        f.merchantId,
        c.id,
        "agent",
        "Olá",
        "one-attempt",
        c.version
      ),
      /simulated_commit_failure/
    );
    const replay = await service.reply(
      f.merchantId,
      c.id,
      "agent",
      "Olá",
      "one-attempt",
      c.version
    );
    assert.equal(replay.message.status, "unknown");
    assert.equal(calls, 1);
  } finally {
    await f.cleanup();
  }
});

test("MKT-02/5 explicit WhatsApp PARAR records a revocation with the inbound message as evidence", async () => {
  const f = await setup();
  try {
    await f.incoming.execute(f.input("Quero tênis", "first"));
    await f.incoming.execute(f.input(MARKETING_ACCEPT, "accept"));
    await f.incoming.execute(f.input("PARAR", "opt-out"));
    const c = (await f.contacts.list(f.merchantId, { limit: 10, offset: 0 }))
      .items[0];
    const detail = await f.contacts.detail(f.merchantId, c.id);
    assert.equal(detail.consent?.status, "revoked");
    assert.equal(detail.consent?.source, "whatsapp_buyer_opt_out");
    assert.equal(detail.consent?.evidenceId, "opt-out");
  } finally {
    await f.cleanup();
  }
});

test("MKT-06/5 only a signed Meta callback updates the scoped message and native button ID is preserved", async (t) => {
  const f = await setup();
  const previousSecret = process.env.META_APP_SECRET;
  process.env.META_APP_SECRET = "local-marketing-callback-secret";
  t.after(() => {
    if (previousSecret === undefined) delete process.env.META_APP_SECRET;
    else process.env.META_APP_SECRET = previousSecret;
  });
  try {
    await f.incoming.execute(f.input("Quero tênis", "first"));
    await f.incoming.execute(f.input(MARKETING_ACCEPT, "accept"));
    let choice: unknown;
    const controller = new WhatsAppWebhookController(
      {
        findByMetaPhoneNumberId: async () => ({
          merchantId: f.merchantId,
          enabled: true,
          id:"config",provider:"META_CLOUD",
        }),
      } as never,
      {
        messageForAuthenticatedConfig: async (
          _c: unknown,
          _s: unknown,
          _i: unknown,
          input: unknown
        ) => {
          choice = input;
        },
      } as never,
      { reconcileMeta: async () => {} } as never,
      {receiveMetaReceipt:async()=>{}} as never,
      { fromMeta: async () => {} } as never,
      undefined,
      f.port
    );
    const payload = {
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: "phone-id" },
                statuses: [{ id: "service-id", status: "read" }],
                messages: [
                  {
                    id: "native-choice",
                    from: "5511999991234",
                    type: "interactive",
                    interactive: {
                      button_reply: {
                        id: MARKETING_DECLINE,
                        title: "Agora não",
                      },
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const rawBody = Buffer.from(JSON.stringify(payload));
    await assert.rejects(
      controller.receiveMetaWebhook("sha256=invalid", payload, {
        rawBody,
      } as never),
      /invalid_meta_signature/
    );
    assert.equal(
      (await f.port.history(f.merchantId, "whatsapp", "checkout"))?.at(-1)
        ?.status,
      "accepted"
    );
    const signature = `sha256=${createHmac(
      "sha256",
      process.env.META_APP_SECRET!
    )
      .update(rawBody)
      .digest("hex")}`;
    await controller.receiveMetaWebhook(signature, payload, {
      rawBody,
    } as never);
    assert.equal(
      (await f.port.history(f.merchantId, "whatsapp", "checkout"))?.at(-1)
        ?.status,
      "read"
    );
    assert.equal((choice as { body: string }).body, MARKETING_DECLINE);
  } finally {
    await f.cleanup();
  }
});
