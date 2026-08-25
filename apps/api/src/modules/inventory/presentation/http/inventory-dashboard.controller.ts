import { Body, Controller, Get, Post, Req, UseGuards } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import { AuthGuard, currentUser } from "../../../auth/presentation/auth.guard.js";
import { ListInventoryUseCase } from "../../application/use-cases/list-inventory.use-case.js";
import { RecordMovementUseCase } from "../../application/use-cases/record-movement.use-case.js";
import { TransferStockUseCase } from "../../application/use-cases/transfer-stock.use-case.js";
import { GetDashboardSummaryUseCase } from "../../application/use-cases/get-dashboard-summary.use-case.js";
import { ListMovementsUseCase } from "../../application/use-cases/list-movements.use-case.js";
import { ListAlertsUseCase } from "../../application/use-cases/list-alerts.use-case.js";
import { AcknowledgeAlertUseCase } from "../../application/use-cases/acknowledge-alert.use-case.js";
import { ListLocationsUseCase } from "../../application/use-cases/list-locations.use-case.js";
import { CreateLocationUseCase } from "../../application/use-cases/create-location.use-case.js";

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
  ) {}

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
    @Body() body?: { status?: string; locationId?: string; search?: string; page?: number; pageSize?: number },
  ) {
    const user = currentUser(req);
    return this.listInventory.execute({
      merchantId: user.merchantId,
      status: body?.status as any,
      locationId: body?.locationId,
      search: body?.search,
      page: body?.page,
      pageSize: body?.pageSize,
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
    @Body() body?: { itemId?: string; kind?: string; from?: string; to?: string; page?: number; pageSize?: number },
  ) {
    const user = currentUser(req);
    return this.listMovements.execute({
      merchantId: user.merchantId,
      itemId: body?.itemId,
      kind: body?.kind,
      from: body?.from ? new Date(body.from) : undefined,
      to: body?.to ? new Date(body.to) : undefined,
      page: body?.page,
      pageSize: body?.pageSize,
    });
  }

  @Get("alerts")
  @ApiOperation({ summary: "List inventory alerts" })
  @ApiOkResponse({ description: "Alerts" })
  async listStockAlerts(
    @Req() req: any,
    @Body() body?: { acknowledged?: boolean },
  ) {
    const user = currentUser(req);
    return this.listAlerts.execute(user.merchantId, body?.acknowledged);
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
}
