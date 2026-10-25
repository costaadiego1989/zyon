import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import { AuthGuard, currentUser } from "../../../auth/presentation/auth.guard.js";
import { GetNavCountsUseCase } from "../../application/get-nav-counts.use-case.js";
import {
  MarkBadgeViewedUseCase,
  isNavBadgeKey,
} from "../../application/mark-badge-viewed.use-case.js";

export interface NavCountsResponse {
  orders: number;
  messages: number;
  cartRecovery: number;
}

@ApiTags("Dashboard")
@Controller("dashboard")
@UseGuards(AuthGuard)
@ApiBearerAuth("JWT")
export class DashboardController {
  constructor(
    private readonly getNavCounts: GetNavCountsUseCase,
    private readonly markBadgeViewed: MarkBadgeViewedUseCase,
  ) {}

  @Get("nav-counts")
  @ApiOperation({
    summary: "Get navigation badge counts (unread-only)",
    description:
      "Returns counts of NEW items since the merchant last viewed each section: pending orders, unread messages, and abandoned carts pending recovery.",
  })
  @ApiOkResponse({
    description: "Nav counts retrieved",
    schema: {
      example: { orders: 5, messages: 2, cartRecovery: 12 },
    },
  })
  async handleGetNavCounts(@Req() req: any): Promise<NavCountsResponse> {
    const user = currentUser(req);
    return this.getNavCounts.execute(user.merchantId);
  }

  @Post("nav-counts/:badgeKey/viewed")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: "Mark a nav-badge section as viewed",
    description:
      "Advances the last-viewed timestamp for a section so its badge drops to 0 until new items appear. badgeKey: orders | messages | cart-recovery.",
  })
  @ApiOkResponse({ description: "Section marked viewed" })
  async handleMarkViewed(
    @Req() req: any,
    @Param("badgeKey") badgeKey: string,
  ): Promise<void> {
    if (!isNavBadgeKey(badgeKey)) {
      throw new BadRequestException("invalid_badge_key");
    }
    const user = currentUser(req);
    await this.markBadgeViewed.execute(user.merchantId, badgeKey);
  }
}
