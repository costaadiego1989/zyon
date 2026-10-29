import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from "@nestjs/swagger";
import { PublicRoute } from "../../../../shared/tenant/tenant.guard.js";
import {
  DeleteAcpWebhookSubscriptionUseCase,
  ListAcpWebhookSubscriptionsUseCase,
  RegisterAcpWebhookSubscriptionUseCase,
} from "../application/acp-webhook-subscription.use-cases.js";
import type { AcpOrderEventType } from "../acp-webhook-event.types.js";
import { isAcpOrderEventType } from "../acp-webhook-event.types.js";
import {
  AcpWebhookDeleteResponseDto,
  AcpWebhookListResponseDto,
  AcpWebhookSubscriptionCreatedDto,
  AcpWebhookSubscriptionViewDto,
  CreateAcpWebhookSubscriptionDto,
} from "./dtos/acp-webhook.dtos.js";

const MERCHANT_HEADER = "x-aacp-merchant-id";
const MERCHANT_BODY_KEY = "merchant_id";
const MERCHANT_QUERY_KEY = "merchant_id";

@ApiTags("ACP Webhooks")
@Controller("acp/webhooks")
export class AcpWebhooksController {
  constructor(
    private readonly registerUseCase: RegisterAcpWebhookSubscriptionUseCase,
    private readonly listUseCase: ListAcpWebhookSubscriptionsUseCase,
    private readonly deleteUseCase: DeleteAcpWebhookSubscriptionUseCase,
  ) {}

  @Post("subscriptions")
  @PublicRoute()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: "Register an ACP webhook subscription",
    description:
      "Public endpoint used by external AI agents to subscribe to order lifecycle events. Returns the subscription_id and a one-time plaintext signing secret.",
  })
  @ApiCreatedResponse({
    description: "Subscription created",
    type: AcpWebhookSubscriptionCreatedDto,
  })
  @ApiBadRequestResponse({ description: "Invalid payload" })
  async register(
    @Body() body: CreateAcpWebhookSubscriptionDto,
    @Headers(MERCHANT_HEADER) merchantHeader?: string,
  ): Promise<AcpWebhookSubscriptionCreatedDto> {
    const merchantId = resolveMerchantId(body.merchant_id, merchantHeader);
    const events = body.events.filter(isAcpOrderEventType) as AcpOrderEventType[];
    const result = await this.registerUseCase.execute({
      merchantId,
      url: body.url,
      events,
    });
    return {
      subscription_id: result.subscription_id,
      url: result.url,
      events: result.events,
      created_at: result.created_at,
      secret: result.secret,
    };
  }

  @Get("subscriptions")
  @PublicRoute()
  @ApiOperation({
    summary: "List ACP webhook subscriptions for a merchant",
    description:
      "Returns all subscriptions registered against the supplied merchant_id. Tenant-scoped — a different merchant_id will return its own list, never the caller's.",
  })
  @ApiOkResponse({
    description: "Subscriptions list",
    type: AcpWebhookListResponseDto,
  })
  @ApiBadRequestResponse({ description: "merchant_id required" })
  async list(
    @Headers(MERCHANT_HEADER) merchantHeader?: string,
  ): Promise<AcpWebhookListResponseDto> {
    const merchantId = resolveMerchantId(undefined, merchantHeader);
    const records = await this.listUseCase.execute(merchantId);
    return {
      data: records.map(toView),
    };
  }

  @Delete("subscriptions/:id")
  @PublicRoute()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Remove an ACP webhook subscription",
    description: "Deletes a subscription by id. Tenant-scoped via merchant_id.",
  })
  @ApiParam({ name: "id", description: "Subscription id" })
  @ApiOkResponse({
    description: "Subscription removed",
    type: AcpWebhookDeleteResponseDto,
  })
  @ApiBadRequestResponse({ description: "merchant_id required" })
  async delete(
    @Param("id") id: string,
    @Headers(MERCHANT_HEADER) merchantHeader?: string,
  ): Promise<AcpWebhookDeleteResponseDto> {
    const merchantId = resolveMerchantId(undefined, merchantHeader);
    await this.deleteUseCase.execute({ merchantId, id });
    return { deleted: true, subscription_id: id };
  }
}

function resolveMerchantId(
  fromBody: string | undefined,
  fromHeader: string | undefined,
): string {
  const candidate = (fromHeader?.trim() || fromBody?.trim() || "").trim();
  if (!candidate) {
    throw new BadRequestException(
      "merchant_id_required: provide X-AACP-Merchant-Id header or merchant_id in body",
    );
  }
  return candidate;
}

function toView(record: {
  subscription_id: string;
  url: string;
  events: AcpOrderEventType[];
  created_at: string;
}): AcpWebhookSubscriptionViewDto {
  return {
    subscription_id: record.subscription_id,
    url: record.url,
    events: record.events,
    created_at: record.created_at,
  };
}

export const __testing = { resolveMerchantId, MERCHANT_HEADER, MERCHANT_BODY_KEY, MERCHANT_QUERY_KEY };
