/** Local-only browser fixture. Real buyer JWT/ownership/metadata/private files and actual assistant handler/builder. */
import {
  Body,
  Controller,
  Get,
  Post,
  Param,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
  All,
  Res,
} from "@nestjs/common";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createFiscalFixture } from "./fiscal-fixture.js";
import { arrangeIssuance } from "./fiscal-issuance-harness.js";
import {
  fiscalXmlFixture,
  fiscalPdfFixture,
} from "./fiscal-artifact-fixtures.js";
import { BuyerJwtService } from "../src/modules/buyer-account/domain/services/buyer-jwt.service.js";
import {
  BuyerJwtAuthGuard,
  currentBuyer,
} from "../src/modules/buyer-account/presentation/http/buyer-jwt-auth.guard.js";
import {
  BuyerFiscalController,
  FISCAL_DOCUMENT_SERVICE,
} from "../src/modules/fiscal/presentation/buyer-fiscal.controller.js";
import { BuyerAccountController } from "../src/modules/buyer-account/presentation/http/buyer-account.controller.js";
import { GetBuyerPurchasesUseCase } from "../src/modules/buyer-account/application/use-cases/get-buyer-purchases.use-case.js";
import { FiscalDocumentService } from "../src/modules/fiscal/application/fiscal-document.service.js";
import { PrismaFiscalDocumentAccess } from "../src/modules/fiscal/infrastructure/prisma-fiscal-document.access.js";
import { FiscalArtifactStore } from "../src/modules/fiscal/infrastructure/fiscal-artifact.store.js";
import { FiscalReconciliationService } from "../src/modules/fiscal/application/fiscal-reconciliation.service.js";
import { FiscalCancellationService } from "../src/modules/fiscal/application/fiscal-cancellation.service.js";
import { PrismaFiscalStockCoordinator } from "../src/shared/persistence/fiscal-stock-coordination.js";
import { BuyerPurchaseHistoryAdapter } from "../src/modules/checkout/infrastructure/adapters/buyer-purchase-history.adapter.js";
import { RecordCompletedPurchaseUseCase } from "../src/modules/buyer-purchase-history/application/buyer-purchase-history.use-cases.js";
import { PrismaBuyerPurchaseHistoryRepository } from "../src/modules/buyer-purchase-history/infrastructure/prisma-buyer-purchase-history.repository.js";
import { createOrderHandlers } from "../src/modules/storefront/infrastructure/tool-handlers/order.handlers.js";
import { buildConversationBlocks } from "../src/modules/storefront/infrastructure/agents/conversation-block.builder.js";
let fixture: Awaited<ReturnType<typeof createFiscalFixture>>,
  sale: Awaited<ReturnType<typeof arrangeIssuance>>,
  documents: FiscalDocumentService;
let failure = false,
  slow = 0;
let reads = 0,
  downloads = 0,
  assistantOptions = 0;
let storeSlug = "fiscal-original";
const jwt = new BuyerJwtService("fiscal-browser-private-buyer-secret");
function recordRecovery(value: Record<string, unknown>) {
  appendFileSync(fileURLToPath(new URL("../../../.specs/features/fiscal-invoicing/t57-browser-recovery.jsonl", import.meta.url)),
    JSON.stringify({ at: new Date().toISOString(), ...value }) + "\n");
}
function browserArtifactStore() {
  const store = new FiscalArtifactStore(fixture.prisma), capture = store.capture.bind(store);
  store.capture = async (...args) => {
    const started = performance.now();
    try {
      const result = await capture(...args);
      recordRecovery({ operation: "capture", documentId: args[1], kind: args[3], elapsedMs: Math.round(performance.now() - started), outcome: "accepted" });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      recordRecovery({ operation: "capture", documentId: args[1], kind: args[3], elapsedMs: Math.round(performance.now() - started), outcome: "failed",
        reasonCode: /^fiscal_[a-z0-9_]{1,100}$/.test(message) ? message : "fiscal_artifact_recovery_failed" });
      throw error;
    }
  };
  return store;
}
@Controller()
class FixtureController {
  @Get("__health") health() {
    return { ok: true };
  }
  @Post("__scenario") async scenario(@Body() body: { mode?: string }) {
    sale = await arrangeIssuance(fixture);
    storeSlug = "fiscal-original-" + sale.sale.merchantId.slice(-12);
    await sale.run();
    if (body.mode !== "processing") {
      sale.setRemote("authorized");
      await new FiscalReconciliationService(
        sale.store,
        sale.factory,
        { read: async () => ({ found: false, reasonCode: "none" }) },
        new PrismaFiscalStockCoordinator(fixture.prisma)
      ).reconcile(sale.scope, sale.sale.intent.id);
    }
    await fixture.prisma.merchant.update({
      where: { id: sale.sale.orderMerchantId },
      data: { name: "Loja comercial original", storeSlug },
    });
    sale.setArtifacts({
      xml: fiscalXmlFixture(sale.sale.connection.issuerTaxId),
      ...(body.mode !== "document_pending"
        ? { pdf: await fiscalPdfFixture() }
        : {}),
    });
    documents = new FiscalDocumentService(
      new PrismaFiscalDocumentAccess(fixture.prisma),
      browserArtifactStore(),
      sale.store,
      sale.factory
    );
    if (body.mode !== "processing")
      await documents.recover(sale.scope, sale.sale.intent.id);
    if (body.mode === "cancelled") {
      const cancellation = new FiscalCancellationService(
        fixture.prisma,
        sale.store,
        sale.factory
      );
      await cancellation.commercialChange(sale.scope, sale.sale.intent.id, {
        id: "synthetic_confirmed_refund",
        kind: "refund",
      });
      const review =
        await fixture.prisma.fiscalCancellationReview.findFirstOrThrow({
          where: { ...sale.scope, document: { intentId: sale.sale.intent.id } },
        });
      await cancellation.request(
        sale.scope,
        review.id,
        {
          merchantId: sale.sale.merchantId,
          actorId: "synthetic_owner",
          permissions: ["fiscal.cancel"],
        },
        {
          confirmed: true,
          justification: "Cancelamento sintetico confirmado pelo lojista local",
        }
      );
      sale.setRemote("cancelled");
      await cancellation.reconcile(sale.scope, review.id);
    }
    if (body.mode === "disconnected")
      await fixture.prisma.fiscalConnection.update({
        where: { id: sale.sale.connection.id },
        data: { disconnectedAt: new Date() },
      });
    const history = new BuyerPurchaseHistoryAdapter(
      new RecordCompletedPurchaseUseCase(
        new PrismaBuyerPurchaseHistoryRepository(fixture.prisma),
        { record: async () => {} }
      )
    );
    for (let index = 0; index < 12; index++)
      await history.recordCheckoutPurchase({
        merchantId: sale.sale.orderMerchantId,
        sessionId: sale.sale.completedOrder.sessionId,
        globalUserId: fixture.tag + "_buyer",
        orderId:
          index === 11
            ? sale.sale.orderId
            : `recent_${sale.sale.orderId}_${index}`,
        currency: "BRL",
        totalAmount: 21.01,
        discountAmount: 1.01,
        completedAt:
          index === 11
            ? sale.sale.completedOrder.completedAt.toISOString()
            : new Date(Date.now() + index * 1000).toISOString(),
        items: [
          {
            sku: "shirt",
            title: "Camiseta original",
            quantity: 2,
            unitPrice: 10,
            discountAmount: 1.01,
          },
        ],
      });
    failure = body.mode === "failure";
    slow = body.mode === "loading" ? 900 : 0;
    reads = 0;
    downloads = 0;
    assistantOptions = 0;
    const token = jwt.sign({
      globalUserId: fixture.tag + "_buyer",
      email: "buyer@example.invalid",
      merchantId: sale.sale.orderMerchantId,
    });
    return {
      token,
      slug: storeSlug,
      foreignToken: jwt.sign({
        globalUserId: fixture.tag + "_foreign",
        email: "buyer@example.invalid",
        merchantId: sale.sale.orderMerchantId,
      }),
      buyerId: fixture.tag + "_buyer",
      host: sale.sale.orderMerchantId,
      seller: sale.sale.merchantId,
      orderId: sale.sale.orderId,
      intentId: sale.sale.intent.id,
      xmlHash: createHash("sha256")
        .update(fiscalXmlFixture(sale.sale.connection.issuerTaxId))
        .digest("hex"),
      pdfHash:
        body.mode !== "document_pending"
          ? createHash("sha256")
              .update(await fiscalPdfFixture())
              .digest("hex")
          : null,
    };
  }
  @Post("__recover") async recover() {
    failure = false;
    slow = 0;
    sale.setArtifacts({
      xml: fiscalXmlFixture(sale.sale.connection.issuerTaxId),
      pdf: await fiscalPdfFixture(),
    });
    const started = performance.now();
    const result = await documents.recover(sale.scope, sale.sale.intent.id);
    recordRecovery({ operation: "recover", intentId: sale.sale.intent.id, elapsedMs: Math.round(performance.now() - started), ...result });
    return result;
  }
  @Get("__state") async state() {
    return {
      reads,
      downloads,
      assistantOptions,
      providerWrites: sale.writes().length,
      sellerPurchaseRows: await fixture.prisma.buyerPurchaseRecord.count({
        where: { merchantId: sale.sale.merchantId },
      }),
    };
  }
  @Get("storefront/:slug/config") config() {
    return {
      merchantId: sale?.sale.orderMerchantId,
      id: sale?.sale.orderMerchantId,
      name: "Loja comercial original",
      slug: storeSlug,
      stories: [],
      theme: {
        accentColor: "#0f766e",
        fontFamily: "system-ui",
        backgroundColor: "#edf0ee",
        textColor: "#17201b",
        mode: "light",
      },
      agentMode: "manual_only",
      storeSettings: {},
    };
  }
  @Get("storefront/:slug/stories") stories() {
    return { categories: [] };
  }
  @Post("buyer/email/send") send() {
    return { sent: true };
  }
  @Post("buyer/email/login/verify") login(@Body() body: { code: string }) {
    if (body.code !== "123456") throw new UnauthorizedException();
    return {
      globalUserId: fixture.tag + "_buyer",
      email: "buyer@example.invalid",
      accessToken: jwt.sign({
        globalUserId: fixture.tag + "_buyer",
        email: "buyer@example.invalid",
        merchantId: sale.sale.orderMerchantId,
      }),
      expiresIn: 3600,
    };
  }
  @Get("buyer/me") @UseGuards(BuyerJwtAuthGuard) profile(
    @Req() r: { user?: unknown }
  ) {
    const b = currentBuyer(r);
    return {
      global_user_id: b.globalUserId,
      display_name: "Comprador local",
      email: b.email,
    };
  }
  @Get("buyer/me/purchases") @UseGuards(BuyerJwtAuthGuard) async purchases(
    @Req() r: { user?: unknown },
    @Query("merchant_id") merchantId: string,
    @Query("cursor") cursor: string,
    @Query("limit") limit: string
  ) {
    return BuyerAccountController.prototype.getPurchaseHistory.call(
      { getPurchases: new GetBuyerPurchasesUseCase(fixture.prisma) } as any,
      r,
      merchantId,
      undefined,
      undefined,
      limit,
      cursor
    );
  }
  @Post("storefront/conversations") conversation() {
    const payload = Buffer.from(
      JSON.stringify({
        aiUserId: fixture.tag + "_visitor",
        expiresAt: Date.now() / 1000 + 3600,
      })
    ).toString("base64url");
    return {
      conversation_id: "fiscal_conversation",
      conversation_token: payload + ".synthetic",
      cart: { id: "fiscal_conversation", items: [], total: 0, currency: "BRL" },
      message: "Como posso ajudar?",
    };
  }
  @Post("storefront/conversations/:id/messages") async message(
    @Req() r: { headers: Record<string, string> },
    @Body() body: { user_message: string }
  ) {
    const token = (r.headers["x-buyer-authorization"] ?? "").replace(
      /^Bearer /,
      ""
    );
    let buyer;
    try {
      buyer = jwt.verify(token);
    } catch {
      buyer = undefined;
    }
    const result = await createOrderHandlers(
      {
        prisma: fixture.prisma,
        fiscal: { documents, environment: "homologation" },
      },
      {
        merchantId: sale.sale.orderMerchantId,
        sessionId: sale.sale.completedOrder.sessionId,
        ...(buyer ? { buyer: { globalUserId: buyer.globalUserId } } : {}),
      }
    ).getInvoice({ orderId: sale.sale.orderId });
    const built = buildConversationBlocks({
      toolResults: { get_invoice: result },
      userMessage: body.user_message,
      finalContent: result.message,
      merchantId: sale.sale.orderMerchantId,
    });
    assistantOptions = built.blocks.filter(
      (b) => b.type === "fiscal_invoices"
    ).length;
    return {
      conversation_id: "fiscal_conversation",
      message: result.message,
      blocks: built.blocks,
    };
  }
  @All("*") fallback(@Req() r: { url: string }, @Res() res: any) {
    if (r.url.includes("widget-config"))
      return res.json({
        enabledTriggers: [],
        advancedRules: [],
        maxInterventionsPerSession: 0,
      });
    if (r.url.includes("cart/"))
      return res.json({
        id: "fiscal_conversation",
        items: [],
        total: 0,
        currency: "BRL",
      });
    return res.json({ items: [], messages: [], enabled: false });
  }
}
fixture = await createFiscalFixture({
  controllers: [BuyerFiscalController, FixtureController],
  providers: [
    { provide: BuyerJwtService, useValue: jwt },
    BuyerJwtAuthGuard,
    {
      provide: FISCAL_DOCUMENT_SERVICE,
      useValue: {
        forOrder: async (
          ...args: Parameters<FiscalDocumentService["forOrder"]>
        ) => {
          reads++;
          if (slow) await new Promise((r) => setTimeout(r, slow));
          if (failure) throw Error("synthetic_unavailable");
          return documents.forOrder(...args);
        },
        download: async (
          ...args: Parameters<FiscalDocumentService["download"]>
        ) => {
          downloads++;
          return documents.download(...args);
        },
      },
    },
  ],
});
const evidenceDirectory = fileURLToPath(
  new URL("../../../.specs/features/fiscal-invoicing/", import.meta.url)
);
mkdirSync(evidenceDirectory, { recursive: true });
appendFileSync(
  evidenceDirectory + "t50-owned-browser-schemas.jsonl",
  JSON.stringify({
    pid: process.pid,
    schema: fixture.schema,
    createdAt: new Date().toISOString(),
  }) + "\n"
);
let dataClosed: Promise<void> | undefined;
function closeData() {
  return (dataClosed ??= fixture.close());
}
const proxy = createServer(async (req, res) => {
  const path = req.url?.startsWith("/v1/") ? req.url : "/v1" + (req.url ?? "/");
  if (req.method === "POST" && path === "/v1/__close") {
    try {
      await closeData();
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ closed: true, schema: fixture.schema }));
      setTimeout(() => {
        void cleanup();
      }, 50);
    } catch {
      res.writeHead(500);
      res.end();
    }
    return;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  try {
    const response = await fetch(fixture.first.url + path, {
      method: req.method,
      headers: req.headers as Record<string, string>,
      ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
    });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    res.writeHead(503);
    res.end();
  }
});
await new Promise<void>((resolve) => proxy.listen(3024, "127.0.0.1", resolve));
let closing = false;
async function cleanup() {
  if (closing) return;
  closing = true;
  proxy.closeAllConnections();
  await new Promise<void>((resolve) => proxy.close(() => resolve()));
  await closeData();
  process.exit(0);
}
process.stdin.on("end", () => {
  void cleanup();
});
process.stdin.resume();
process.on("SIGTERM", () => {
  void cleanup();
});
process.on("SIGINT", () => {
  void cleanup();
});
console.log("FISCAL_BUYER_BROWSER_READY");
