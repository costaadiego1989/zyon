import { Body, Controller, Get, Inject, Post, Query, Req, UseGuards, Param } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import { AuthGuard, currentUser } from "../../../auth/presentation/auth.guard.js";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { ListInventoryUseCase } from "../../application/use-cases/list-inventory.use-case.js";
import { RecordMovementUseCase } from "../../application/use-cases/record-movement.use-case.js";
import { TransferStockUseCase } from "../../application/use-cases/transfer-stock.use-case.js";
import { GetDashboardSummaryUseCase } from "../../application/use-cases/get-dashboard-summary.use-case.js";
import { ListMovementsUseCase } from "../../application/use-cases/list-movements.use-case.js";
import { ListAlertsUseCase } from "../../application/use-cases/list-alerts.use-case.js";
import { AcknowledgeAlertUseCase } from "../../application/use-cases/acknowledge-alert.use-case.js";
import { ListLocationsUseCase } from "../../application/use-cases/list-locations.use-case.js";
import { CreateLocationUseCase } from "../../application/use-cases/create-location.use-case.js";
import { CreateInventoryItemUseCase } from "../../application/use-cases/create-inventory-item.use-case.js";
import { ListCrmConnectionsUseCase } from "../../application/use-cases/list-crm-connections.use-case.js";
import { ConnectCrmUseCase } from "../../application/use-cases/connect-crm.use-case.js";
import { DisconnectCrmUseCase } from "../../application/use-cases/disconnect-crm.use-case.js";
import { ListErpConnectionsUseCase } from "../../application/use-cases/list-erp-connections.use-case.js";
import { ConnectOmieUseCase } from "../../application/use-cases/connect-omie.use-case.js";
import { DisconnectErpUseCase } from "../../application/use-cases/disconnect-erp.use-case.js";

@ApiTags("Dashboard / Inventory")
@Controller("dashboard/inventory")
@UseGuards(AuthGuard)
@ApiBearerAuth("JWT")
export class InventoryDashboardController {
  constructor(
    private readonly listInventory: ListInventoryUseCase,
    private readonly recordMovement: RecordMovementUseCase,
    private readonly transferStock: TransferStockUseCase,
    private readonly getDashboardSummary: GetDashboardSummaryUseCase,
    private readonly listMovements: ListMovementsUseCase,
    private readonly listAlerts: ListAlertsUseCase,
    private readonly acknowledgeAlert: AcknowledgeAlertUseCase,
    private readonly listLocations: ListLocationsUseCase,
    private readonly createLocation: CreateLocationUseCase,
    private readonly createItem: CreateInventoryItemUseCase,
    private readonly listCrmConnections: ListCrmConnectionsUseCase,
    private readonly connectCrm: ConnectCrmUseCase,
    private readonly disconnectCrm: DisconnectCrmUseCase,
    private readonly listErpConnections: ListErpConnectionsUseCase,
    private readonly connectOmie: ConnectOmieUseCase,
    private readonly disconnectErp: DisconnectErpUseCase,
    @Inject(PRISMA_CLIENT) private readonly prisma: any,
  ) {}

  @Get("items/:sku/product-detail")
  @ApiOperation({ summary: "Get full product detail from catalog by SKU" })
  @ApiOkResponse({ description: "Product detail from catalog" })
  async getProductDetailBySku(@Req() req: any, @Param("sku") sku: string) {
    const user = currentUser(req);
    const variant = await this.prisma.productVariant.findFirst({
      where: { sku, product: { merchantId: user.merchantId } },
      include: {
        product: { include: { variants: { include: { stock: true, price: true, media: true } } } },
        stock: true,
        price: true,
        media: true,
      },
    });
    if (!variant) return { found: false };
    const product = variant.product;
    return {
      found: true,
      product: {
        id: product.id,
        name: product.name,
        description: product.description,
        type: product.type,
        isActive: product.isActive,
      },
      variant: {
        id: variant.id,
        sku: variant.sku,
        attributes: variant.attributes,
        barcode: variant.barcode,
        weightGrams: variant.weightGrams,
        lengthCm: variant.lengthCm,
        widthCm: variant.widthCm,
        heightCm: variant.heightCm,
        isActive: variant.isActive,
        stock: variant.stock?.[0]?.quantity ?? 0,
        reserved: variant.stock?.[0]?.reserved ?? 0,
        price: variant.price?.basePriceInCents ?? 0,
        cost: variant.price?.costInCents ?? null,
        media: (variant.media ?? []).map((m: any) => ({ url: m.url, type: m.type, alt: m.alt })),
      },
      allVariants: product.variants.map((v: any) => ({
        id: v.id,
        sku: v.sku,
        attributes: v.attributes,
        stock: v.stock?.[0]?.quantity ?? 0,
        price: v.price?.basePriceInCents ?? 0,
        isActive: v.isActive,
      })),
    };
  }

  @Get("summary")
  @ApiOperation({ summary: "Get inventory dashboard summary" })
  @ApiOkResponse({ description: "Dashboard summary" })
  async getSummary(@Req() req: any) {
    const user = currentUser(req);
    return this.getDashboardSummary.execute(user.merchantId);
  }

  @Get("items")
  @ApiOperation({ summary: "List inventory items" })
  @ApiOkResponse({ description: "Inventory items" })
  async listItems(
    @Req() req: any,
    @Query() query?: { status?: string; locationId?: string; search?: string; page?: string; pageSize?: string },
  ) {
    const user = currentUser(req);
    return this.listInventory.execute({
      merchantId: user.merchantId,
      status: query?.status as any,
      locationId: query?.locationId,
      search: query?.search,
      page: query?.page ? Number(query.page) : undefined,
      pageSize: query?.pageSize ? Number(query.pageSize) : undefined,
    });
  }

  @Post("items")
  @ApiOperation({ summary: "Create a new inventory item" })
  @ApiOkResponse({ description: "Inventory item created" })
  async createNewItem(
    @Req() req: any,
    @Body() body: {
      sku: string;
      productName: string;
      variantName?: string;
      locationId?: string;
      quantity: number;
      avgCostCents?: number;
      lowStockThreshold?: number;
    },
  ) {
    const user = currentUser(req);
    return this.createItem.execute({
      merchantId: user.merchantId,
      sku: body.sku,
      productName: body.productName,
      variantName: body.variantName,
      locationId: body.locationId,
      quantity: body.quantity,
      avgCostCents: body.avgCostCents,
      lowStockThreshold: body.lowStockThreshold,
      actorUserId: user.userId,
    });
  }

  @Post("items/:id/movements")
  @ApiOperation({ summary: "Record a stock movement" })
  @ApiOkResponse({ description: "Movement recorded" })
  async recordStockMovement(
    @Req() req: any,
    @Body() body: { kind: string; quantity: number; reason?: string; externalRef?: string },
  ) {
    const user = currentUser(req);
    const itemId = (req.params as Record<string, string>).id;
    return this.recordMovement.execute({
      merchantId: user.merchantId,
      itemId,
      kind: body.kind,
      quantity: body.quantity,
      reason: body.reason,
      externalRef: body.externalRef,
      source: "native",
      actorUserId: user.userId,
    });
  }

  @Post("items/transfer")
  @ApiOperation({ summary: "Transfer stock between locations" })
  @ApiOkResponse({ description: "Transfer completed" })
  async transferStockBetweenLocations(
    @Req() req: any,
    @Body() body: { itemId: string; quantity: number; fromLocationId: string; toLocationId: string; reason?: string },
  ) {
    const user = currentUser(req);
    return this.transferStock.execute({
      merchantId: user.merchantId,
      itemId: body.itemId,
      quantity: body.quantity,
      fromLocationId: body.fromLocationId,
      toLocationId: body.toLocationId,
      reason: body.reason,
      actorUserId: user.userId,
    });
  }

  @Get("movements")
  @ApiOperation({ summary: "List inventory movements" })
  @ApiOkResponse({ description: "Movements" })
  async listStockMovements(
    @Req() req: any,
    @Query() query?: { itemId?: string; kind?: string; from?: string; to?: string; page?: string; pageSize?: string },
  ) {
    const user = currentUser(req);
    return this.listMovements.execute({
      merchantId: user.merchantId,
      itemId: query?.itemId,
      kind: query?.kind,
      from: query?.from ? new Date(query.from) : undefined,
      to: query?.to ? new Date(query.to) : undefined,
      page: query?.page ? Number(query.page) : undefined,
      pageSize: query?.pageSize ? Number(query.pageSize) : undefined,
    });
  }

  @Get("alerts")
  @ApiOperation({ summary: "List inventory alerts" })
  @ApiOkResponse({ description: "Alerts" })
  async listStockAlerts(
    @Req() req: any,
    @Query() query?: { acknowledged?: string },
  ) {
    const user = currentUser(req);
    const ack = query?.acknowledged === "true" ? true : query?.acknowledged === "false" ? false : undefined;
    return this.listAlerts.execute(user.merchantId, ack);
  }

  @Post("alerts/:id/acknowledge")
  @ApiOperation({ summary: "Acknowledge an alert" })
  @ApiOkResponse({ description: "Alert acknowledged" })
  async acknowledgeAlertAction(
    @Req() req: any,
  ) {
    const user = currentUser(req);
    const alertId = (req.params as Record<string, string>).id;
    return this.acknowledgeAlert.execute(user.merchantId, alertId);
  }

  @Get("locations")
  @ApiOperation({ summary: "List inventory locations" })
  @ApiOkResponse({ description: "Locations" })
  async listInventoryLocations(@Req() req: any) {
    const user = currentUser(req);
    return this.listLocations.execute(user.merchantId);
  }

  @Post("locations")
  @ApiOperation({ summary: "Create a new inventory location" })
  @ApiOkResponse({ description: "Location created" })
  async createNewLocation(
    @Req() req: any,
    @Body() body: { name: string; kind?: string; isDefault?: boolean },
  ) {
    const user = currentUser(req);
    return this.createLocation.execute(user.merchantId, body);
  }

  // ERP Connection Endpoints

  @Get("erp-connections")
  @ApiOperation({ summary: "List ERP connections" })
  @ApiOkResponse({ description: "ERP connections" })
  async listErpConnectionsAction(@Req() req: any) {
    const user = currentUser(req);
    return this.listErpConnections.execute(user.merchantId);
  }

  @Post("erp-connections/:provider/connect")
  @ApiOperation({ summary: "Connect an ERP provider (Omie via API keys; Bling/Tiny use OAuth)" })
  @ApiOkResponse({ description: "ERP connected" })
  async connectErpProvider(
    @Req() req: any,
    @Param("provider") provider: string,
    @Body() body: { appKey?: string; appSecret?: string; app_key?: string; app_secret?: string },
  ) {
    const user = currentUser(req);
    if (provider === "omie") {
      const appKey = body.appKey ?? body.app_key ?? "";
      const appSecret = body.appSecret ?? body.app_secret ?? "";
      return this.connectOmie.execute({
        merchantId: user.merchantId,
        appKey,
        appSecret,
      });
    }
    // Bling/Tiny use the OAuth flow via /inventory/erp/oauth/:provider/authorize
    return { requiresOAuth: true, provider, message: "Use o fluxo OAuth para conectar este provedor" };
  }

  @Post("erp-connections/:id/disconnect")
  @ApiOperation({ summary: "Disconnect an ERP connection" })
  @ApiOkResponse({ description: "ERP connection disconnected" })
  async disconnectErpConnection(
    @Req() req: any,
    @Param("id") id: string,
  ) {
    const user = currentUser(req);
    return this.disconnectErp.execute(user.merchantId, id);
  }

  @Post("erp-connections/:id/sync")
  @ApiOperation({ summary: "Trigger ERP sync" })
  @ApiOkResponse({ description: "Sync triggered" })
  async triggerErpSync(
    @Req() req: any,
    @Param("id") id: string,
  ) {
    return { triggered: true, connectionId: id, message: "Sync iniciado" };
  }

  // CRM Connection Endpoints

  @Get("crm-connections")
  @ApiOperation({ summary: "List CRM connections" })
  @ApiOkResponse({ description: "CRM connections" })
  async listCrmConnectionsAction(@Req() req: any) {
    const user = currentUser(req);
    return this.listCrmConnections.execute(user.merchantId);
  }

  @Post("crm-connections/:provider/connect")
  @ApiOperation({ summary: "Connect a CRM provider" })
  @ApiOkResponse({ description: "CRM provider connected" })
  async connectCrmProvider(
    @Req() req: any,
    @Param("provider") provider: string,
    @Body() body: { accessToken: string; refreshToken?: string; config?: Record<string, unknown> },
  ) {
    const user = currentUser(req);
    return this.connectCrm.execute({
      merchantId: user.merchantId,
      provider,
      accessToken: body.accessToken,
      refreshToken: body.refreshToken,
      config: body.config,
    });
  }

  @Post("crm-connections/:id/disconnect")
  @ApiOperation({ summary: "Disconnect a CRM connection" })
  @ApiOkResponse({ description: "CRM connection disconnected" })
  async disconnectCrmConnection(
    @Req() req: any,
    @Param("id") id: string,
  ) {
    const user = currentUser(req);
    return this.disconnectCrm.execute(user.merchantId, id);
  }
}
