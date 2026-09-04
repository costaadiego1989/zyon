import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiCookieAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { currentTenantPrincipal } from "../../../../../shared/auth/tenant-principal.js";
import { Idempotent } from "../../../../../shared/http/idempotency/idempotent.decorator.js";
import { ResponseEnvelopeInterceptor } from "../../../../../shared/http/response-envelope.interceptor.js";
import { SendOrderConfirmationUseCase } from "../../../../notifications/application/use-cases/send-order-confirmation.use-case.js";
import { SendOrderShippedUseCase } from "../../../../notifications/application/use-cases/send-order-shipped.use-case.js";
import { SendOrderDeliveredUseCase } from "../../../../notifications/application/use-cases/send-order-delivered.use-case.js";
import { SendReturnApprovedUseCase } from "../../../../notifications/application/use-cases/send-return-approved.use-case.js";
import { RequireTenantAccess } from "../../../../integrations/presentation/http/tenant-access.decorator.js";
import { TenantAccessGuard } from "../../../../integrations/presentation/http/tenant-access.guard.js";
import { TenantCredentialGuard } from "../../../../integrations/presentation/http/tenant-credential.guard.js";
import { NotificationEntityMapper } from "../../application/mappers/notification-entity.mapper.js";
import {
  SendOrderConfirmationDto,
  SendOrderShippedDto,
  SendOrderDeliveredDto,
  SendReturnApprovedDto,
  NotificationSentResponse,
} from "./dtos/notification.dtos.js";

@ApiTags("Notifications")
@ApiBearerAuth("service_api_key")
@ApiCookieAuth("console_session")
@Controller("notifications")
@UseInterceptors(ResponseEnvelopeInterceptor)
@UseGuards(TenantCredentialGuard, TenantAccessGuard)
export class NotificationsV1Controller {
  constructor(
    private readonly sendOrderConfirmation: SendOrderConfirmationUseCase,
    private readonly sendOrderShipped: SendOrderShippedUseCase,
    private readonly sendOrderDelivered: SendOrderDeliveredUseCase,
    private readonly sendReturnApproved: SendReturnApprovedUseCase,
  ) {}

  @Post("order-confirmation")
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @RequireTenantAccess({ serviceScopes: ["orders:read"] })
  @ApiOperation({ summary: "Send order confirmation notification" })
  @ApiBody({ type: SendOrderConfirmationDto })
  @ApiResponse({ status: 200, description: "Notification sent", type: NotificationSentResponse })
  @ApiResponse({ status: 400, description: "Invalid request" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  @ApiResponse({ status: 403, description: "Forbidden" })
  async orderConfirmation(
    @Req() request: any,
    @Body() body: SendOrderConfirmationDto,
  ) {
    const merchantId = currentTenantPrincipal(request).tenantId;
    const event = NotificationEntityMapper.toOrderConfirmationEvent(merchantId, body);
    await this.sendOrderConfirmation.execute(event);
    return NotificationEntityMapper.toSentResponse("order_confirmation", body.order_id);
  }

  @Post("order-shipped")
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @RequireTenantAccess({ serviceScopes: ["orders:read"] })
  @ApiOperation({ summary: "Send order shipped notification" })
  @ApiBody({ type: SendOrderShippedDto })
  @ApiResponse({ status: 200, description: "Notification sent", type: NotificationSentResponse })
  @ApiResponse({ status: 400, description: "Invalid request" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  @ApiResponse({ status: 403, description: "Forbidden" })
  async orderShipped(
    @Req() request: any,
    @Body() body: SendOrderShippedDto,
  ) {
    const merchantId = currentTenantPrincipal(request).tenantId;
    const event = NotificationEntityMapper.toOrderShippedEvent(merchantId, body);
    await this.sendOrderShipped.execute(event);
    return NotificationEntityMapper.toSentResponse("order_shipped", body.order_id);
  }

  @Post("order-delivered")
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @RequireTenantAccess({ serviceScopes: ["orders:read"] })
  @ApiOperation({ summary: "Send order delivered notification" })
  @ApiBody({ type: SendOrderDeliveredDto })
  @ApiResponse({ status: 200, description: "Notification sent", type: NotificationSentResponse })
  @ApiResponse({ status: 400, description: "Invalid request" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  @ApiResponse({ status: 403, description: "Forbidden" })
  async orderDelivered(
    @Req() request: any,
    @Body() body: SendOrderDeliveredDto,
  ) {
    const merchantId = currentTenantPrincipal(request).tenantId;
    const event = NotificationEntityMapper.toOrderDeliveredEvent(merchantId, body);
    await this.sendOrderDelivered.execute(event);
    return NotificationEntityMapper.toSentResponse("order_delivered", body.order_id);
  }

  @Post("return-approved")
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @RequireTenantAccess({ serviceScopes: ["orders:read"] })
  @ApiOperation({ summary: "Send return approved notification" })
  @ApiBody({ type: SendReturnApprovedDto })
  @ApiResponse({ status: 200, description: "Notification sent", type: NotificationSentResponse })
  @ApiResponse({ status: 400, description: "Invalid request" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  @ApiResponse({ status: 403, description: "Forbidden" })
  async returnApproved(
    @Req() request: any,
    @Body() body: SendReturnApprovedDto,
  ) {
    const merchantId = currentTenantPrincipal(request).tenantId;
    const event = NotificationEntityMapper.toReturnApprovedEvent(merchantId, body);
    await this.sendReturnApproved.execute(event);
    return NotificationEntityMapper.toSentResponse("return_approved", body.order_id);
  }
}
