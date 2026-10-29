import { ArgumentsHost, Body, Catch, Controller, ExceptionFilter, Get, Header, Inject, Param, Patch, Post, Put, Query, Req, UseFilters, UseGuards } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import { RateLimit } from "../../../shared/rate-limit/rate-limit.decorators.js";
import { BuyerJwtAuthGuard, currentBuyer } from "../../buyer-account/presentation/http/buyer-jwt-auth.guard.js";
import type { ProductRepositoryPort } from "../../catalog/domain/ports/product-repository.port.js";
import { ShoppingError } from "../domain/shopping-agent.js";
import { ShoppingAgentService } from "../application/shopping-agent.service.js";

@Catch(ShoppingError)
export class ShoppingErrorFilter implements ExceptionFilter {
  catch(error: ShoppingError, host: ArgumentsHost) {
    host.switchToHttp().getResponse().status(error.status).json({ code: error.code, message: error.code });
  }
}
interface BuyerRequest { user?: unknown; headers: { origin?: string } }
@Controller("buyer/me/stores/:merchantId/shopping-agent")
@UseGuards(BuyerJwtAuthGuard)
@UseFilters(ShoppingErrorFilter)
@RateLimit(40, 60_000)
export class ShoppingAgentController {
  constructor(private readonly agent: ShoppingAgentService,
    @Inject("ProductRepositoryPort") private readonly products: ProductRepositoryPort,
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}
  private buyer(request: BuyerRequest, merchantId: string) {
    if (!/^[\w-]{1,160}$/.test(merchantId)) throw new ShoppingError("agent_not_found", 404);
    const buyer = currentBuyer(request);
    if (buyer.merchantId && buyer.merchantId !== merchantId) throw new ShoppingError("agent_not_found", 404);
    return buyer.globalUserId;
  }
  @Get()
  @Header("Cache-Control", "no-store")
  get(@Req() request: BuyerRequest, @Param("merchantId") merchantId: string) { return this.agent.get(this.buyer(request, merchantId), merchantId); }
  @Put()
  configure(@Req() request: BuyerRequest, @Param("merchantId") merchantId: string, @Body() body: unknown) { return this.agent.configure(this.buyer(request, merchantId), merchantId, body); }
  @Get("catalog")
  async catalog(@Req() request: BuyerRequest, @Param("merchantId") merchantId: string, @Query("query") query?: string) {
    this.buyer(request, merchantId);
    await this.agent.requirePlan(merchantId);
    if (query !== undefined && (typeof query !== "string" || query.length > 120)) throw new ShoppingError("agent_invalid_query");
    const result = await this.products.search({ merchantId, query, isActiveOnly: true, limit: 30 });
    return { items: result.products.filter(p => p.isActive && ["physical", "digital"].includes(p.type)).map(product => ({
      id: product.id, name: product.name, type: product.type,
      variants: product.variants.filter(v => v.isActive && v.currency === "BRL").map(v => ({ id: v.id, label: Object.values(v.attributes).join(" / ") || v.sku, priceCents: v.basePriceInCents,
        available: product.hasStock && (product.type === "digital" || v.stockQuantity - v.stockReserved > 0) })) })) };
  }
  @Get("suggestions")
  async suggestions(@Req() request: BuyerRequest, @Param("merchantId") merchantId: string) {
    const buyerId = this.buyer(request, merchantId);
    await this.agent.requirePlan(merchantId);
    const orders = await this.prisma.buyerPurchaseRecord.findMany({ where: { merchantId, globalUserId: buyerId }, orderBy: { completedAt: "desc" }, take: 20 });
    const seen = new Map<string, { name: string; sku: string; quantity: number; dates: number[] }>();
    for (const order of orders) {
      const items = Array.isArray(order.items) ? order.items : [];
      for (const item of items) {
        if (!item || typeof item !== "object" || Array.isArray(item) || typeof item.sku !== "string") continue;
        const existing = seen.get(item.sku);
        if (existing) { if (!existing.dates.includes(order.completedAt.getTime())) existing.dates.push(order.completedAt.getTime()); }
        else seen.set(item.sku, { name: typeof item.name === "string" ? item.name : item.sku, sku: item.sku, quantity: Number.isSafeInteger(item.quantity) ? Math.max(1, Math.min(100, Number(item.quantity))) : 1, dates: [order.completedAt.getTime()] });
      }
    }
    const variants = await this.prisma.productVariant.findMany({ where: { sku: { in: [...seen.keys()] }, isActive: true, product: { merchantId, isActive: true, deletedAt: null, type: { in: ["physical", "digital"] } } }, select: { id: true, sku: true, productId: true } });
    return { items: variants.slice(0, 10).map(v => {
      const history = seen.get(v.sku)!;
      const gaps = history.dates.slice(1).map((date, index) => Math.round((history.dates[index]! - date) / 86_400_000)).filter(days => days > 0).sort((a, b) => a - b);
      return { productId: v.productId, variantId: v.id, name: history.name, quantity: history.quantity, intervalDays: gaps.length ? Math.min(365, gaps[Math.floor(gaps.length / 2)]!) : 30, basedOnPurchases: history.dates.length };
    }) };
  }
  @Post("tasks")
  @RateLimit(10, 60_000)
  create(@Req() request: BuyerRequest, @Param("merchantId") merchantId: string, @Body() body: { config?: unknown; requestKey?: unknown }) {
    return this.agent.createTask(this.buyer(request, merchantId), merchantId, body?.config, typeof body?.requestKey === "string" ? body.requestKey : "");
  }
  @Patch("tasks/:taskId")
  change(@Req() request: BuyerRequest, @Param("merchantId") merchantId: string, @Param("taskId") taskId: string, @Body() body: { action?: unknown; revision?: unknown; config?: unknown }) {
    return this.agent.changeTask(this.buyer(request, merchantId), merchantId, taskId, body ?? {});
  }
  @Post("activities/:activityId/:action")
  decide(@Req() request: BuyerRequest, @Param("merchantId") merchantId: string, @Param("activityId") activityId: string, @Param("action") action: string) {
    return this.agent.decide(this.buyer(request, merchantId), merchantId, activityId, action, request.headers.origin ?? "");
  }
}
